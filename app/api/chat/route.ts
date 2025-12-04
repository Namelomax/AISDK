import { google, createGoogleGenerativeAI } from '@ai-sdk/google';
import { 
  streamText, 
  UIMessage, 
  convertToModelMessages, 
  Output, 
  smoothStream,
  createUIMessageStream,
  JsonToSseTransformStream,
} from 'ai';
import { z } from 'zod';
import { getPrompt, updatePrompt, saveConversation, createPromptForUser, updateConversation } from '@/lib/getPromt';


export const maxDuration = 90;
export const runtime = 'nodejs';
const googleWithProxy = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY!,
  baseURL: 'https://purple-wildflower-18a.namelomaxer.workers.dev',
});
const model = google('gemini-2.5-flash');


let cachedPrompt: string | null = null;


async function ensurePrompt() {
  console.log(cachedPrompt,"cachedPrompt")
  
  if (!cachedPrompt) cachedPrompt = await getPrompt();
  return cachedPrompt;
}


// Serp агент
async function serpAgent(messages: UIMessage[], systemPrompt: string) {
  const normalizedMessages: UIMessage[] = messages.map((m: any) => {
    const text =
      m.parts?.find((p: any) => p.type === 'text')?.text ||
      (typeof m.content === 'string' ? m.content : '') ||
      '';

    return {
      id: m.id || crypto.randomUUID(),
      role: m.role || 'user',
      parts: [{ type: 'text' as const, text }],
    };
  });

  const last = normalizedMessages
    .slice()
    .reverse()
    .find((m) => m.role === 'user');

  const query = last?.parts?.find((p) => p.type === 'text')?.text?.trim() || '';

  // Поиск через SerpAPI
  const resp = await fetch(
    `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${process.env.SERP_API_KEY}`
  );

  const json = await resp.json();

  const results =
    json.organic_results?.slice(0, 3).map((r: any) => ({
      title: r.title,
      link: r.link,
      snippet: r.snippet,
    })) ?? [];

  const extendedMessages: UIMessage[] = [
    ...normalizedMessages,
    {
      id: crypto.randomUUID(),
      role: 'user',
      parts: [
        {
          type: 'text' as const,
          text: `Результаты поиска: ${JSON.stringify(results, null, 2)}\nСформулируй краткий и понятный ответ на основе этих данных.`,
        },
      ],
    },
  ];

  return streamText({
    model,
    providerOptions: {
      google: {
        baseURL: 'https://purple-wildflower-18a.namelomaxer.workers.dev',
        stream: true,
        thinkingConfig: {
          thinkingBudget: -1,
          includeThoughts: true,
        },
      },
    },
    messages: convertToModelMessages(extendedMessages),
    
    system: systemPrompt + '\nТы — ассистент, который формулирует краткий и понятный ответ на основе результатов поиска.',
    experimental_output: Output.object({
      schema: z.object({
        text: z.string(),
        results: z.array(
          z.object({
            title: z.string(),
            link: z.string(),
            snippet: z.string(),
          })
        ).optional(),
      }),
    }),
    experimental_transform: smoothStream(),
});
}

// Основной POST
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  let { messages, newSystemPrompt, userId } = body as any;
  // Extract conversationId early for persistence
  let conversationId: string | null = null;
  try {
    const url = new URL(req.url);
    conversationId = body.conversationId || url.searchParams.get('conversationId');
  } catch {}
  // Ensure messages is always an array to avoid runtime errors when callers omit it
  if (!Array.isArray(messages)) {
    messages = [];
  }

  // Build a normalized messages array to use for model calls and intent detection.
  // If the client didn't send a messages array, but sent `text` or `message` in the body,
  // create a single user message so downstream code has a non-empty history.
  const normalizedMessages: any[] = Array.isArray(messages) && messages.length > 0
    ? messages
    : (body && (body.text || body.message)
      ? [{
          id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
          role: 'user',
          parts: [{ type: 'text', text: String(body.text ?? body.message ?? '') }],
          content: String(body.text ?? body.message ?? ''),
        }]
      : []);

  // Also accept userId via query param (so client can include it in transport API)
  try {
    const url = new URL(req.url);
    const qp = url.searchParams.get('userId');
    if (!userId && qp) userId = qp;
  } catch (e) {
    // ignore
  }

  const currentDocument = normalizedMessages.length ? normalizedMessages.at(-1)?.metadata?.currentDocument : undefined;
  console.log(currentDocument, 'currentDocument');
  console.log(normalizedMessages.length ? normalizedMessages.at(-1) : undefined, 'message');

  if (newSystemPrompt) {
    // If userId provided, save prompt for user; otherwise update global default
    try {
      if (userId) {
        const title = (newSystemPrompt || '').slice(0, 60) || 'User Prompt';
        await createPromptForUser(userId, title, newSystemPrompt);
      } else {
        await updatePrompt(newSystemPrompt);
      }
      cachedPrompt = newSystemPrompt;
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    } catch (err) {
      console.error('Error saving prompt for user:', err);
      return new Response(JSON.stringify({ success: false }), { status: 500 });
    }
  }

  const systemPrompt = await ensurePrompt();

  const lastUserMessage = normalizedMessages[normalizedMessages.length - 1];
  const lastText =
    lastUserMessage?.content ||
    lastUserMessage?.parts?.find((p: any) => p.type === 'text')?.text ||
    '';
  
  const extendedMessages: UIMessage[] = normalizedMessages as UIMessage[];

  // Определяем этап диалога
  function determineConversationStage(messages: any[]): ConversationStage {
    const userMessages = messages.filter((m) => m.role === 'user');
    const count = userMessages.length;

    if (count === 1) return 'start';
    if (count <= 3) return 'general_info';
    if (count <= 6) return 'process_overview';
    if (count <= 10) return 'step_details';
    if (count <= 15) return 'scenario_analysis';
    return 'completion_ready';
  }

  const conversationStage = determineConversationStage(messages);

  console.log('Conversation stage:', conversationStage);
  console.log('🔍 Debug Info:', {
    totalMessages: messages.length,
    lastUserMessage: lastText.substring(0, 150),
    conversationStage,
  });

  // If userId provided, save or update conversation in background.
  // Some clients may not send `messages` as an array; build a sensible fallback.
  if (userId) {
    try {
      const convId = (body && body.conversationId) || (() => {
        try { const u = new URL(req.url); return u.searchParams.get('conversationId'); } catch { return null; }
      })();

      const msgsToSave: any[] = Array.isArray(messages) && messages.length > 0
        ? messages
        : (lastUserMessage ? [lastUserMessage] : (body && (body.text || body.message) ? [{
            id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
            role: 'user',
            parts: [{ type: 'text', text: String(body.text ?? body.message ?? '') }],
            content: String(body.text ?? body.message ?? ''),
          }] : []));

      if (msgsToSave.length > 0) {
        if (convId) {
          try {
            const mod = await import('@/lib/getPromt');
            void mod.updateConversation(convId, msgsToSave);
          } catch (e) {
            console.error('Failed to update conversation:', e);
          }
        } else {
          try {
            const mod = await import('@/lib/getPromt');
            void mod.saveConversation(userId, msgsToSave);
          } catch (e) {
            console.error('Failed to create conversation:', e);
          }
        }
      }
    } catch (err) {
      console.error('Failed to save conversation:', err);
    }
  }

  // Определяем намерение пользователя
  const { object: intent } = await (await import('ai')).generateObject({
    model,
    system: systemPrompt,
    providerOptions: {
      google: {
        baseURL: 'https://purple-wildflower-18a.namelomaxer.workers.dev',
        stream: true,
        thinkingConfig: { thinkingBudget: -1, includeThoughts: true },
      },
    },
    schema: z.object({
      type: z.enum(['chat', 'document', 'search', 'generate_regulation', 'casual']),
    }),
    prompt: `
Ты — классификатор пользовательских сообщений.

Этап диалога: ${conversationStage}
Сообщение пользователя:
"""
${lastText}
"""

Варианты:
- generate_regulation — завершение, формирование регламента
- document — редактирование промежуточного документа
- search — запрос на поиск информации
- chat — обычное продолжение диалога
- casual — общение, комментарии, анализ, пояснения, если пользователь просит объяснение, резюме, краткое содержание или просто ответ (включая "выведи, что в файлах")
Ответь только одним словом из списка выше.
`,
  });

  console.log('Detected intent:', intent.type);

  // === Роутинг по агентам ===
  if (intent.type === 'generate_regulation') {
    const stream = createUIMessageStream({
      originalMessages: messages,
      execute: async ({ writer }) => {
        try {
          await generateFinalRegulation(messages, systemPrompt, writer);
        } catch (error) {
          console.error('Regulation generation error:', error);
          writer.write({ type: 'text-start', id: 'error' });
          writer.write({
            type: 'text-delta',
            id: 'error',
            delta: 'Произошла ошибка при формировании регламента. Попробуйте снова.',
          });
          writer.write({ type: 'text-end', id: 'error' });
        }
      },
      onFinish: async ({ messages: finished }) => {
        if (userId) {
          try {
            if (conversationId) {
              await updateConversation(conversationId, finished);
            } else {
              await saveConversation(userId, finished);
            }
          } catch (e) {
            console.error('generate_regulation persistence failed', e);
          }
        }
      }
    });
    const readable = stream.pipeThrough(new JsonToSseTransformStream());
    return wrapReadableWithSessionSave(readable, userId);
  }

  if (intent.type === 'document') {
    if (conversationStage === 'completion_ready') {
      const stream = createUIMessageStream({
        originalMessages: messages,
        execute: async ({ writer }) => {
          try {
            await generateFinalRegulation(messages, systemPrompt, writer);
          } catch (error) {
            console.error('Document intent -> regulation error:', error);
            writer.write({ type: 'text-start', id: 'doc-error' });
            writer.write({
              type: 'text-delta',
              id: 'doc-error',
              delta: 'Не удалось сформировать регламент. Попробуйте ещё раз чуть позже.',
            });
            writer.write({ type: 'text-end', id: 'doc-error' });
          }
        },
        onFinish: async ({ messages: finished }) => {
          if (userId) {
            try {
              if (conversationId) {
                await updateConversation(conversationId, finished);
              } else {
                await saveConversation(userId, finished);
              }
            } catch (e) {
              console.error('document->regulation persistence failed', e);
            }
          }
        }
      });
      const readable = stream.pipeThrough(new JsonToSseTransformStream());
      return wrapReadableWithSessionSave(readable, userId);
    }

    const stream = createUIMessageStream({
      originalMessages: messages,
      execute: async ({ writer }) => {
        writer.write({ type: 'data-clear', data: null });
        writer.write({ type: 'data-title', data: '' });
        writer.write({ type: 'data-finish', data: null });

        const holdId = `doc-hold-${crypto.randomUUID()}`;
        const guidance = getDocumentStageGuidance(conversationStage as ConversationStage);

        writer.write({ type: 'text-start', id: holdId });
        writer.write({ type: 'text-delta', id: holdId, delta: `ℹ️ ${guidance.heading}\n\n${guidance.actions}` });
        writer.write({ type: 'text-end', id: holdId });
      },
      onFinish: async ({ messages: finished }) => {
        if (userId) {
          try {
            if (conversationId) {
              await updateConversation(conversationId, finished);
            } else {
              await saveConversation(userId, finished);
            }
          } catch (e) {
            console.error('document persistence failed', e);
          }
        }
      }
    });
    const readable = stream.pipeThrough(new JsonToSseTransformStream());
    return wrapReadableWithSessionSave(readable, userId);
  }

  if (intent.type === 'search') {
    const stream = await serpAgent(messages, systemPrompt);
    const resp = stream.toUIMessageStreamResponse({
      originalMessages: messages,
      onFinish: async ({ messages: finished }) => {
        if (userId) {
          try {
            if (conversationId) {
              await updateConversation(conversationId, finished);
            } else {
              await saveConversation(userId, finished);
            }
          } catch (e) {
            console.error('search onFinish persistence failed', e);
          }
        }
      }
    });
    return wrapResponseWithSessionSave(resp, userId);
  }

  if (intent.type === 'casual') {
    const stream = streamText({
      model,
      providerOptions: {
        google: {
          baseURL: 'https://purple-wildflower-18a.namelomaxer.workers.dev',
          stream: true,
          thinkingConfig: { thinkingBudget: -1, includeThoughts: true },
        },
      },
      messages: convertToModelMessages(messages),
      system:
        systemPrompt +
        `
Ты — дружелюбный ассистент. Отвечай просто и понятно. Если есть дополнительная информация, используй её.
`,
      experimental_output: Output.object({
        schema: z.object({
          text: z.string().describe('Короткий ответ пользователю.'),
        }),
      }),
      experimental_transform: smoothStream(),
    });
    const resp = stream.toUIMessageStreamResponse({
      originalMessages: messages,
      onFinish: async ({ messages: finished }) => {
        if (userId) {
          try {
            if (conversationId) {
              await updateConversation(conversationId, finished);
            } else {
              await saveConversation(userId, finished);
            }
          } catch (e) {
            console.error('casual onFinish persistence failed', e);
          }
        }
      }
    });
    return wrapResponseWithSessionSave(resp, userId);
  }

  // Основной диалог
  const stageSpecificPrompt = getStageSpecificPrompt(conversationStage);
  const stream = streamText({
    model,
    providerOptions: {
      google: {
        baseURL: 'https://purple-wildflower-18a.namelomaxer.workers.dev',
        stream: true,
        thinkingConfig: { thinkingBudget: -1, includeThoughts: true },
      },
    },
    messages: convertToModelMessages(extendedMessages),
    system: systemPrompt + stageSpecificPrompt,
    experimental_output: Output.object({
      schema: z.object({
        text: z.string().describe('Ответ пользователю для продолжения диалога'),
      }),
    }),
    experimental_transform: smoothStream(),
  });
  const resp = stream.toUIMessageStreamResponse({
    originalMessages: messages,
    onFinish: async ({ messages: finished }) => {
      if (userId) {
        try {
          if (conversationId) {
            await updateConversation(conversationId, finished);
          } else {
            await saveConversation(userId, finished);
          }
        } catch (e) {
          console.error('main chat onFinish persistence failed', e);
        }
      }
    }
  });
  return wrapResponseWithSessionSave(resp, userId);
}

// Helper to wrap a ReadableStream (SSE)
function wrapReadableWithSessionSave(readable: ReadableStream, userId?: string | null) {
  const wrapped = new ReadableStream({
    async start(controller) {
      const reader = readable.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
      // no-op: we no longer persist session info here
    }
  });

  return new Response(wrapped, { headers: { 'Content-Type': 'text/event-stream' } });
}

// Helper to wrap an existing Response (from stream.toUIMessageStreamResponse())
function wrapResponseWithSessionSave(resp: Response, userId?: string | null) {
  const body = resp.body;
  if (!body) return resp;
  const wrapped = new ReadableStream({
    async start(controller) {
      const reader = body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
      // no-op: session persistence disabled
    }
  });

  // copy headers
  const headers: Record<string,string> = {};
  resp.headers.forEach((v,k) => headers[k]=v);
  return new Response(wrapped, { status: resp.status, headers });
}

type ConversationStage = 
  | 'start' 
  | 'general_info' 
  | 'process_overview' 
  | 'step_details' 
  | 'scenario_analysis' 
  | 'completion_ready';

function getStageSpecificPrompt(stage: string): string {
  const prompts: Record<ConversationStage, string> = {
    start: `
СЕЙЧАС: ЭТАП 1 - СТАРТ И ОБЩИЕ ПОЛОЖЕНИЯ
Твоя задача: 
- Поприветствовать пользователя и представиться
- Собрать общую информацию о компании, должности, процессе
- Попросить загрузить документы если есть
- Начать сбор информации для Раздела 1 "Общие положения"

ВАЖНО: Не переходи к следующим этапам пока не соберешь базовую информацию!
`,
    general_info: `
СЕЙЧАС: ЭТАП 1 - ПРОДОЛЖЕНИЕ СБОРА ОБЩЕЙ ИНФОРМАЦИИ
Твоя задача:
- Уточнить детали компании и процесса
- Проанализировать загруженные документы если есть
- Собрать информацию для Раздела 1 и начальных пунктов Раздела 2
- Выяснить назначение регламента, термины, используемые документы

Продолжай задавать уточняющие вопросы!
`,
    process_overview: `
СЕЙЧАС: ЭТАП 2 - ОБЩЕЕ ОПИСАНИЕ ПРОЦЕССА
Твоя задача:
- Собрать информацию о владельце процесса
- Определить цель процесса и ценный конечный продукт
- Выяснить границы процесса (начало/окончание)
- Определить участников процесса и их функции

Фокус на Разделе 2 целевой структуры!
`,
    step_details: `
СЕЙЧАС: ЭТАП 3 - ДЕТАЛЬНОЕ ОПИСАНИЕ ШАГОВ
Твоя задача:
- Детально описать каждый шаг процесса
- Выяснить для каждого шага: исполнитель, продукт, смежник, требования
- Собрать информацию о средствах, инструментах, порядке действий
- Уточнить количественные характеристики

Фокус на Разделе 3 целевой структуры!
`,
    scenario_analysis: `
СЕЙЧАС: ЭТАП 3 - АНАЛИЗ СЦЕНАРИЕВ ВЫПОЛНЕНИЯ
Твоя задача:
- Выяснить альтернативные сценарии выполнения
- Определить условия ветвления и обработки исключений
- Уточнить параллельные и циклические сценарии если есть
- Завершить описание всех шагов процесса

Завершай сбор информации для Раздела 3!
`,
    completion_ready: `
СЕЙЧАС: ЗАВЕРШЕНИЕ СБОРА ИНФОРМАЦИИ
Твоя задача:
- Собрать информацию по управлению процессом (Раздел 4)
- Уточнить показатели эффективности, мониторинг, ответственность
- ПРЕДЛОЖИТЬ пользователю сформировать финальный регламент
- Спросить: "Кажется, мы собрали всю информацию. Хотите, чтобы я сформировал финальный регламент?"

ГОТОВЬСЯ К ФОРМИРОВАНИЮ РЕГЛАМЕНТА!
`
  };

  return prompts[stage as ConversationStage] || '';
}

function getDocumentStageGuidance(stage: ConversationStage): { heading: string; actions: string } {
  const map: Record<ConversationStage, { heading: string; actions: string }> = {
    start: {
      heading: 'Начнём с базовых сведений, чтобы собрать раздел «Общие положения».',
      actions:
        '- Коротко опишите компанию и сферу деятельности.\n- Как называется процесс, для которого нужен регламент?\n- Зачем он нужен и для кого (отдел, роль)?',
    },
    general_info: {
      heading: 'Соберём детали для раздела 1: назначения, документы, термины.',
      actions:
        '- Уточните цель процесса и область применения регламента.\n- Перечислите связанные документы/инструкции.\n- Дайте определения ключевых терминов или ролей.',
    },
    process_overview: {
      heading: 'Теперь нужен общий контур процесса (раздел 2).',
      actions:
        '- Кто владелец процесса и какие участники задействованы?\n- Какой продукт должен получиться на выходе и кто его потребитель?\n- Где начинается и заканчивается процесс?',
    },
    step_details: {
      heading: 'Пора расписать последовательность шагов (раздел 3).',
      actions:
        '- Перечислите шаги по порядку.\n- Для каждого шага назовите исполнителя, вход, выход и инструменты.\n- Укажите требования или ограничения, если они есть.',
    },
    scenario_analysis: {
      heading: 'Нужно описать альтернативные сценарии и исключения.',
      actions:
        '- Есть ли параллельные ветки, нестандартные ситуации или эскалации?\n- Кто принимает решения при отклонениях?\n- Какие условия запускают альтернативные шаги?',
    },
    completion_ready: {
      heading: 'Все данные почти собраны. Скажите «Сформируй регламент», чтобы выполнить финальный проход.',
      actions:
        '- Могу уже выпускать финальный документ, если подтвердите.\n- При необходимости уточните ещё KPI, мониторинг или ответственность.',
    },
  };

  return map[stage] ?? {
    heading: 'Нужно ещё немного информации, прежде чем формировать документ.',
    actions: '- Добавьте любую недостающую деталь процесса или отправьте файлы с пояснениями.',
  };
}

// Функция для формирования финального регламента (стримится в реальном времени)
async function generateFinalRegulation(
  messages: any[], 
  systemPrompt: string,
  dataStream: any
) {
  const conversationContext = messages
    .map((msg) => {
      const text = msg.content || msg.parts?.find((p: any) => p.type === 'text')?.text || '';
      return `${msg.role}: ${text}`;
    })
    .join('\n');

  const directive = `На основе всей истории диалога ниже сформируй итоговый регламент. Используй ТОЛЬКО подтверждённые факты из переписки.

Структура обязательна и должна быть ровно такой (Markdown):

# Название регламента

**1. Общие положения**
    1.1. ... (и так далее)

**2. Общее описание процесса**
    ...

**3. Детальное описание шагов процесса**
    ...

**4. Управление процессом**
    ...

Если данных нет — пиши «*Информация не предоставлена в диалоге.*». Никаких пояснений вне структуры.

История диалога:
${conversationContext}`;

  const stream = await streamText({
    model,
    providerOptions: {
      google: {
        baseURL: 'https://purple-wildflower-18a.namelomaxer.workers.dev',
        stream: true,
        thinkingConfig: { thinkingBudget: -1, includeThoughts: true },
      },
    },
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: directive,
      },
    ],
    experimental_transform: smoothStream(),
  });

  dataStream.write({ type: 'data-clear', data: null });
  const progressId = `regulation-${crypto.randomUUID()}`;
  dataStream.write({ type: 'text-start', id: progressId });
  dataStream.write({
    type: 'text-delta',
    id: progressId,
    delta: '📄 Формирую финальный регламент. Изменения будут появляться справа по мере генерации.\n\n',
  });

  let accumulated = '';
  let emittedTitle = false;
  let finalTitle = 'Регламент процесса';

  for await (const part of stream.fullStream) {
    if (part.type !== 'text-delta') continue;
    const chunk = part.text.replace(/\r/g, '');

    if (!emittedTitle) {
      accumulated += chunk;
      const match = accumulated.match(/#\s*(.+?)(?:\n|$)/);
      if (match) {
        finalTitle = match[1].trim() || finalTitle;
        dataStream.write({ type: 'data-title', data: finalTitle });
        emittedTitle = true;
        const remainder = accumulated.slice(match.index! + match[0].length);
        if (remainder) {
          dataStream.write({ type: 'data-documentDelta', data: remainder });
        }
        accumulated = '';
      }
      continue;
    }

    dataStream.write({ type: 'data-documentDelta', data: chunk });
  }

  if (!emittedTitle) {
    dataStream.write({ type: 'data-title', data: finalTitle });
    if (accumulated) {
      dataStream.write({ type: 'data-documentDelta', data: accumulated });
    }
  }

  dataStream.write({ type: 'data-finish', data: null });
  dataStream.write({
    type: 'text-delta',
    id: progressId,
    delta: `\n\n✅ Регламент "${finalTitle}" сформирован. При необходимости попросите меня внести изменения.`,
  });
  dataStream.write({ type: 'text-end', id: progressId });
}