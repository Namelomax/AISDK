import { google, createGoogleGenerativeAI } from '@ai-sdk/google';
import { 
  streamText, 
  UIMessage, 
  convertToModelMessages, 
  Output, 
  smoothStream,
  createUIMessageStream,
  JsonToSseTransformStream,
  wrapLanguageModel,
} from 'ai';
import { z } from 'zod';
import { getPrompt, updatePrompt } from '@/lib/getPromt';
import {LanguageModel } from 'ai';

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

// Схема для документа
const documentSchema = z.object({
  title: z.string().describe('Заголовок документа'),
  content: z.string().describe('Содержимое документа в Markdown'),
});

// Document agent - теперь с dataStream
// Document agent - теперь с учётом текущего документа
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
      Верни JSON с двумя полями: 
      - "title" — краткое название документа (без кавычек)
      - "content" — содержимое документа (используй Markdown-разметку: #, ##, -, * и т.д.).`
    : `Ты — интеллектуальный текстовый редактор. 
      Текущий документ называется "${currentDocument?.title}" и выглядит так:
      ---
      ${currentDocument?.content}
      ---
      Инструкция пользователя: ${userRequest}

      Твоя задача — внести только нужные правки в существующий документ:
      - Разрешено изменять название документа (title), если пользователь просит.
      - Можно добавлять, редактировать или удалять разделы.
      - Если просят "добавить блок", добавь его как отдельный markdown-раздел (например, начинающийся с ##).
      - Не повторяй уже существующий текст, не создавай копий разделов.
      - Верни JSON с двумя полями:
        "title" — новое название (если изменено)
        "content" — итоговый текст в Markdown (без обёрток вроде \`\`\`markdown).`;

  const { object } = await (await import('ai')).generateObject({
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
      title: z.string().describe('Название документа'),
      content: z.string().describe('Markdown контент документа'),
    }),
    prompt,
  });

  // Стрим заголовка (если изменён)
  dataStream.write({ type: 'data-clear', data: null });
  dataStream.write({
    type: 'data-title',
    data: object.title || currentDocument?.title || 'Без названия',
  });

  // Стрим контента
  const text = object.content.replace(/\\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  const words = text.split(' ');
  for (const [i, word] of words.entries()) {
    const chunk = word + (i < words.length - 1 ? ' ' : '');
    dataStream.write({ type: 'data-documentDelta', data: chunk });
    await new Promise((r) => setTimeout(r, 8));
  }

  dataStream.write({ type: 'data-finish', data: null });

  // UI сообщение
  dataStream.write({ type: 'text-start', id: 'doc-finish' });
  dataStream.write({
    type: 'text-delta',
    id: 'doc-finish',
    delta: isNew
      ? `Документ "${object.title}" создан и доступен в правой панели.`
      : `Документ "${object.title}" обновлён и доступен в правой панели.`,
  });
  dataStream.write({ type: 'text-end', id: 'doc-finish' });
}

// Схема для регламента
const regulationSchema = z.object({
  title: z.string().describe('Официальное название регламента'),
  content: z.string().describe('Полный регламент в Markdown формате согласно целевой структуре'),
  status: z.enum(['draft', 'final']).describe('Статус регламента'),
});

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
// Определяем этап диалога на основе истории
function determineConversationStage(messages: any[]): string {
  const lastUserMessage = messages[messages.length - 1];
  const messageCount = messages.filter(m => m.role === 'user').length;
  
  if (messageCount === 1) return 'start';
  if (messageCount <= 3) return 'general_info';
  if (messageCount <= 8) return 'process_details';
  if (messageCount <= 12) return 'step_analysis';
  return 'finalization';
}
// Основной POST
export async function POST(req: Request) {
  const { messages, newSystemPrompt } = await req.json();
  console.log(cachedPrompt, "cachedPrompt");
  
  const currentDocument = messages.at(-1)?.metadata?.currentDocument;
  console.log(currentDocument, "currentDocument");
  console.log(messages.at(-1), "message");
  
  if (newSystemPrompt) {
    await updatePrompt(newSystemPrompt);
    cachedPrompt = newSystemPrompt;
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }

  const systemPrompt = await ensurePrompt();
  const lastUserMessage = messages[messages.length - 1];
  const lastText =
    lastUserMessage?.content ||
    lastUserMessage?.parts?.find((p: any) => p.type === 'text')?.text ||
    '';

  // Определяем этап диалога на основе истории
function determineConversationStage(messages: any[]): ConversationStage {
  const userMessages = messages.filter(m => m.role === 'user');
  const messageCount = userMessages.length;
  
  if (messageCount === 1) return 'start';
  if (messageCount <= 3) return 'general_info';
  if (messageCount <= 6) return 'process_overview';
  if (messageCount <= 10) return 'step_details';
  if (messageCount <= 15) return 'scenario_analysis';
  return 'completion_ready';
}

  const conversationStage = determineConversationStage(messages);
  console.log('Conversation stage:', conversationStage);
console.log('🔍 Debug Info:', {
  totalMessages: messages.length,
  userMessages: messages.filter((m: { role: string; }) => m.role === 'user').length,
  lastUserMessage: lastText.substring(0, 200),
  conversationStage,
  cachedPromptLength: cachedPrompt?.length
});
  // Классифицируем намерение пользователя с учетом этапа диалога
  const { object: intent } = await (await import('ai')).generateObject({
    model,
    system: systemPrompt,
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
    schema: z.object({
      type: z.enum(['chat', 'document', 'search', 'generate_regulation']),
    }),
    
    prompt: `
Ты — классификатор пользовательских сообщений.

ТЕКУЩИЙ ЭТАП ДИАЛОГА: ${conversationStage}
СООБЩЕНИЕ ПОЛЬЗОВАТЕЛЯ:
"""
${lastText}
"""

Варианты классов:
- **generate_regulation** - если пользователь явно говорит "завершить", "сформировать регламент", "все готово", "приступай к формированию", ИЛИ если диалог естественно завершен
- **document** — если пользователь хочет создать, изменить, удалить, переименовать промежуточный документ  
- **search** — если пользователь просит найти или получить информацию из интернета  
- **chat** — продолжение диалога по сбору информации для регламента

ОСОБОЕ ВНИМАНИЕ: 
- На этапе "completion_ready" склоняйся к generate_regulation если сообщение похоже на завершение
- НЕ используй document для формирования финального регламента - только generate_regulation

Ответь только одним словом из списка:
generate_regulation | document | search | chat
`
  });

  console.log('Detected intent:', intent.type);

  // Если нужно сгенерировать регламент - используем специальный агент
  if (intent.type === 'generate_regulation') {
    const stream = createUIMessageStream({
      originalMessages: messages,
      execute: async ({ writer: dataStream }) => {
        try {
          await generateFinalRegulation(messages, systemPrompt, dataStream);
        } catch (error) {
          console.error('Regulation generation error:', error);
          dataStream.write({ type: 'text-start', id: 'error' });
          dataStream.write({
            type: 'text-delta', 
            id: 'error',
            delta: 'Произошла ошибка при формировании регламента. Пожалуйста, попробуйте еще раз.'
          });
          dataStream.write({ type: 'text-end', id: 'error' });
        }
      },
    });

    return new Response(stream.pipeThrough(new JsonToSseTransformStream()));
  }

  // Для document используем UIMessageStream чтобы передавать данные в DocumentPanel
  if (intent.type === 'document') {
    const stream = createUIMessageStream({
      originalMessages: messages,
      execute: async ({ writer: dataStream }) => {
        try {
          await documentAgent(messages, systemPrompt, dataStream, currentDocument);
        } catch (error) {
          console.error('Document agent error:', error);
        }
      },
    });

    return new Response(stream.pipeThrough(new JsonToSseTransformStream()));
  }

  // Для search и chat используем обычный стриминг
  let stream;

  if (intent.type === 'search') {
    stream = await serpAgent(messages, systemPrompt);
  } else {
    // Основной диалог - продолжаем сбор информации с учетом этапа
    const stageSpecificPrompt = getStageSpecificPrompt(conversationStage);
    
    stream = streamText({
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
      messages: convertToModelMessages(messages),
      system: systemPrompt + stageSpecificPrompt,
      experimental_output: Output.object({
        schema: z.object({
          text: z.string().describe('Текстовый ответ пользователю для продолжения диалога'),
        }),
      }),
      experimental_transform: smoothStream(),
    });
  }

  return stream.toUIMessageStreamResponse();
}

// Функция для получения промпта в зависимости от этапа
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

  // Стриминг регламента в документ
  dataStream.write({ type: 'data-clear', data: null });
  dataStream.write({
    type: 'data-title', 
    data: regulation.title || 'Регламент процесса'
  });

  // Стриминг контента
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