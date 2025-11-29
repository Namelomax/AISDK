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

// Document agent (streams markdown so UI updates in real time)
async function documentAgent(
  messages: any[],
  systemPrompt: string,
  dataStream: any,
  currentDocument?: { title: string; content: string }
) {
  const lastUserMessage = messages[messages.length - 1];
  const userRequest =
    lastUserMessage?.content ||
    lastUserMessage?.parts?.find((p: any) => p.type === 'text')?.text ||
    '';

  const isNew = !currentDocument?.content?.trim();

  const prompt = isNew
    ? `Создай новый документ в формате Markdown на основе запроса: "${userRequest}".
      Требования:
      - первая строка должна быть заголовком формата "# Название";
      - далее выведи содержание с использованием Markdown (##, ###, списки и т.д.);
      - не окружай результат тройными кавычками;
      - избегай лишних вступлений.`
    : `Ты — интеллектуальный редактор документов.
      Текущий документ называется "${currentDocument?.title || 'Без названия'}" и выглядит так:
      ---
      ${currentDocument?.content ?? ''}
      ---
      Инструкция пользователя: ${userRequest}

      Требования к ответу:
      - внеси только необходимые правки в текст;
      - если нужно, измени заголовок документа;
      - первая строка ответа — актуальный заголовок формата "# Название";
      - далее выведи итоговый Markdown без лишних комментариев.`;

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
        content: prompt,
      },
    ],
    experimental_transform: smoothStream(),
  });

  dataStream.write({ type: 'data-clear', data: null });
  const progressId = `doc-progress-${crypto.randomUUID()}`;
  dataStream.write({ type: 'text-start', id: progressId });
  dataStream.write({
    type: 'text-delta',
    id: progressId,
    delta: isNew
      ? '✳️ Создаю новый документ, он появится в правой панели по мере генерации\n\n'
      : '✳️ Обновляю документ, изменения появятся справа по мере генерации\n\n',
  });

  let accumulated = '';
  let bodyBuffer = '';
  let emittedTitle = false;
  let finalTitle = currentDocument?.title || 'Документ';

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
          bodyBuffer += remainder;
        }
        accumulated = '';
      }
      continue;
    }

    dataStream.write({ type: 'data-documentDelta', data: chunk });
    bodyBuffer += chunk;
  }

  if (!emittedTitle) {
    dataStream.write({ type: 'data-title', data: finalTitle });
    if (accumulated) {
      dataStream.write({ type: 'data-documentDelta', data: accumulated });
      bodyBuffer += accumulated;
    }
  }

  dataStream.write({ type: 'data-finish', data: null });
  dataStream.write({
    type: 'text-delta',
    id: progressId,
    delta: `\n\n✅ Документ "${finalTitle}" ${isNew ? 'создан' : 'обновлён'} и отображается справа.`,
  });
  dataStream.write({ type: 'text-end', id: progressId });
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
    const stream = createUIMessageStream({
      originalMessages: messages,
      execute: async ({ writer }) => {
        try {
          await documentAgent(messages, systemPrompt, writer, currentDocument);
        } catch (error) {
          console.error('Document agent error:', error);
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

// Функция для формирования финального регламента
async function generateFinalRegulation(
  messages: any[], 
  systemPrompt: string,
  dataStream: any
) {
  // Собираем всю информацию из истории диалога
  const conversationContext = messages
    .map(msg => {
      const text = msg.content || msg.parts?.find((p: any) => p.type === 'text')?.text || '';
      return `${msg.role}: ${text}`;
    })
    .join('\n');

  const { object: regulation } = await (await import('ai')).generateObject({
    model,
  
    system: systemPrompt + `
    
    КРИТИЧЕСКИ ВАЖНО ДЛЯ ФОРМИРОВАНИЯ РЕГЛАМЕНТА:
    
    1. Ты должен проанализировать ВСЮ историю диалога выше
    2. Извлечь ВСЕ подтвержденные данные ({{validated}})
    3. Сформировать ПОЛНЫЙ регламент СТРОГО по целевой структуре:
    
    **1. Общие положения**
        1.1. Официальное название компании и область деятельности.
        1.2. Назначение регламента и область применения
        1.3. Используемые документы
        1.4. Термины и определения
        
    **2. Общее описание процесса**
        2.1. Наименование процесса
        2.2. Владелец процесса
        2.3. Цель процесса, ценный конечный продукт и потребитель продукта процесса
        2.4. Требования к продукту
        2.5. Границы процесса
        2.6. Участники процесса и их функции
        2.7. Количественные характеристики процесса
        
    **3. Детальное описание шагов процесса**
        3.1. Диаграмма цепочек кооперации (описательно)
        3.2. Детальное описание каждого шага
        3.3. Типы сценариев выполнения
        
    **4. Управление процессом**
        4.1. Показатели эффективности процесса (KPI)
        4.2. Мониторинг и контроль
        4.3. Ответственность за отклонения
        4.4. Проектирование процесса и процедура внесения изменений
    
    4. Использовать ТОЛЬКО информацию из диалога - ничего не выдумывать
    5. Вернуть результат в формате JSON с полями title и content
    `,
    providerOptions: {
      google: {
        baseURL: 'https://purple-wildflower-18a.namelomaxer.workers.dev',
        stream: true,
        thinkingConfig: { thinkingBudget: -1, includeThoughts: true },
      },
    },
    schema: z.object({
      title: z.string().describe('Официальное название регламента'),
      content: z.string().describe('Полный регламент в Markdown формате согласно целевой структуре'),
    }),
    prompt: `На основе всей истории диалога сформируй финальный регламент. Используй ТОЛЬКО информацию из диалога:\n\n${conversationContext}`
  });

  // Стриминг в документ
  dataStream.write({ type: 'data-clear', data: null });
  dataStream.write({
    type: 'data-title', 
    data: regulation.title || 'Регламент процесса'
  });

  const content = regulation.content.replace(/\\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  const words = content.split(' ');
  
  for (const [i, word] of words.entries()) {
    const chunk = word + (i < words.length - 1 ? ' ' : '');
    dataStream.write({ type: 'data-documentDelta', data: chunk });
    await new Promise((r) => setTimeout(r, 8));
  }

  dataStream.write({ type: 'data-finish', data: null });

  // Сообщение пользователю
  dataStream.write({ type: 'text-start', id: 'regulation-complete' });
  dataStream.write({
    type: 'text-delta',
    id: 'regulation-complete',
    delta: `✅ Регламент "${regulation.title}" успешно сформирован! Проверьте его в правой панели. Если нужно что-то исправить - просто скажите об этом.`,
  });
  dataStream.write({ type: 'text-end', id: 'regulation-complete' });
}