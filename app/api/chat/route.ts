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

export const maxDuration = 30;
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
  const { messages, newSystemPrompt } = await req.json();
    console.log(cachedPrompt,"cachedPrompt")
const currentDocument = messages.at(-1)?.metadata?.currentDocument;
console.log(currentDocument,"currentDocument")
console.log(messages.at(-1),"message")
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

  // Классифицируем намерение пользователя
  const { object: intent } = await (await import('ai')).generateObject({
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
    schema: z.object({
      type: z.enum(['chat', 'document', 'search']),
    }),
    
    prompt: `
Ты — классификатор пользовательских сообщений.

Задача: определить тип запроса пользователя по тексту ниже.

Сообщение:
"""
${lastText}
"""

Варианты классов:
- **document** — если пользователь хочет создать, изменить, удалить, переименовать или проанализировать документ.  
  Примеры:
  - "Создай документ с названием Отчёт"
  - "Добавь раздел про нейронные сети"
  - "Удали часть про цели проекта"
  - "Сделай документ короче"
- **search** — если пользователь просит найти или получить информацию из интернета.  
  Примеры:
  - "Найди последние новости про ИИ"
  - "Покажи статистику по продажам 2024"
  - "Кто основатель компании OpenAI"
- **chat** — любое другое сообщение, не связанное напрямую с документом или поиском.  
  Примеры:
  - "Привет, как дела?"
  - "Объясни, как работают нейроны"
  - "Что ты можешь сделать?"
Не отвечай chat если пользователь напрямую не задает вопрос, скорее всего имеллось в виду что-то сделать с документом
Ответь **только одним словом** из списка:
document | search | chat
`

  });

  // Для document используем UIMessageStream чтобы передавать данные в DocumentPanel
  if (intent.type === 'document') {
    const stream = createUIMessageStream({
      originalMessages: messages,
      execute: async ({ writer: dataStream }) => {
        try {
          await documentAgent(messages, systemPrompt, dataStream, currentDocument);

          // Агент сам отправит все необходимые данные через dataStream
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
      system: systemPrompt,
      experimental_output: Output.object({
        schema: z.object({
          text: z.string().describe('Текстовый ответ пользователю'),
        }),
      }),
      experimental_transform: smoothStream(),
    });
  }

  return stream.toUIMessageStreamResponse();
}