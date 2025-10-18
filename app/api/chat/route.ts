import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { 
  streamText, 
  convertToModelMessages, 
  stepCountIs,
  createUIMessageStream,
  JsonToSseTransformStream,
  smoothStream,
  type UIMessageStreamWriter
} from 'ai';
import { tool } from 'ai';
import { z } from 'zod';
import type { ChatUIMessage, Document } from '@/lib/types';

export const maxDuration = 30;
export const runtime = 'nodejs';
let systemPrompt = 'Ты полезный AI-ассистент. Используй инструменты для поиска информации и создания документов по запросу пользователя.';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY2!,
});

// Глобальный объект документа
const document: Document = { title: '', content: '' };

// ---- Serp Tool ----
const createSerpTool = () => tool({
  description: 'Поиск информации через SerpAPI (Google Search)',
  inputSchema: z.object({
    q: z.string().describe('Поисковый запрос'),
  }),
  execute: async ({ q }) => {
    const resp = await fetch(
      `https://serpapi.com/search.json?q=${encodeURIComponent(q)}&api_key=${process.env.SERP_API_KEY}`
    );

    if (!resp.ok) {
      throw new Error(`SerpAPI error: ${resp.status} ${await resp.text()}`);
    }

    const json = await resp.json();

    const results =
      json.organic_results?.slice(0, 3).map((r: any) => ({
        title: r.title,
        link: r.link,
        snippet: r.snippet, 
      })) ?? [];

    return { query: q, results };
  },
});
  
// ---- Create Document Tool ----
const createDocumentTool = (
  dataStream: UIMessageStreamWriter<ChatUIMessage>,
  model: any
) => tool({
  name: 'createDocument',
  description: 'Создать документ. Этот инструмент генерирует содержимое документа на основе заголовка и описания.',
  inputSchema: z.object({
    title: z.string().describe('Заголовок документа'),
    description: z.string().describe('Краткое описание и требования к документу'),
  }),
  execute: async ({ title, description }) => {

    document.title = title;
    dataStream.write({
      type: 'data-title',
      data: title,
    });

    dataStream.write({
      type: 'data-clear',
      data: null,
    });

    let draftContent = '';
    const { fullStream } = streamText({
      model,
      temperature: 0,
      system: 'Создайте документ на основе предоставленного заголовка и описания. Используйте Markdown для структурирования текста. Включайте заголовки, где это необходимо.',
      experimental_transform: smoothStream({ chunking: 'word' }),
      prompt: `${title}\n\n${description}`,
    });

    for await (const delta of fullStream) {
      if (delta.type === 'text-delta') {
        draftContent += delta.text;
        dataStream.write({
          type: 'data-documentDelta',
          data: delta.text,
        });
      }
    }

    document.content = draftContent;

    // Завершаем создание документа
    dataStream.write({ 
      type: 'data-finish', 
      data: null,
    });

    return {
      title,
      content: 'Документ создан и теперь доступен пользователю',
    };
  },
});

// ---- Update Document Tool ----
const createUpdateDocumentTool = (
  dataStream: UIMessageStreamWriter<ChatUIMessage>,
  model: any
) => tool({
  name: 'updateDocument',
  description: 'Обновить существующий документ с заданным описанием изменений.',
  inputSchema: z.object({
    description: z.string().describe('Описание изменений для документа'),
  }),
  execute: async ({ description }) => {
    if (!document.content) {
      return {
        error: 'Нет документа для обновления. Сначала создайте документ.',
      };
    }

    // Очищаем для обновления
    dataStream.write({
      type: 'data-clear',
      data: null,
    });

    // Обновляем содержимое
    let draftContent = '';
    const { fullStream } = streamText({
      model,
      temperature: 0,
      system: `Ты — ассистент ИИ, который обновляет документ в формате Markdown. Твоя задача — применить изменения к существующему содержимому документа на основе запроса пользователя и вернуть **только** полный, обновленный документ в формате Markdown. Не добавляйте никаких комментариев, приветствий или объяснений.\n\nТекущее содержимое документа:\n${document.content}`,
      experimental_transform: smoothStream({ chunking: 'word' }),
      prompt: description,
    });

    for await (const delta of fullStream) {
      if (delta.type === 'text-delta') {
        draftContent += delta.text;
        dataStream.write({
          type: 'data-documentDelta',
          data: delta.text,
        });
      }
    }

    document.content = draftContent;

    // Завершаем обновление
    dataStream.write({ 
      type: 'data-finish', 
      data: null,
    });

    return {
      title: document.title,
      content: 'Документ был успешно обновлен',
    };
  },
});

export async function POST(req: Request) {
  const { messages, newSystemPrompt } = await req.json();
  if (newSystemPrompt) {
  systemPrompt = newSystemPrompt;
  return new Response(JSON.stringify({ success: true, message: 'Промт обновлён' }), {
    status: 200,
  });
}
  try {
    const openrouterModel = openrouter('nvidia/nemotron-nano-9b-v2:free');

    const stream = createUIMessageStream({
      originalMessages: messages,
      execute: ({ writer: dataStream }) => {
        const result = streamText({
          model: openrouterModel,
          temperature: 0,
          system: systemPrompt,
          messages: convertToModelMessages(messages),
          stopWhen: stepCountIs(5),
          experimental_transform: smoothStream({ chunking: 'word' }),
          tools: {
            serp: createSerpTool(),
            createDocument: createDocumentTool(dataStream, openrouterModel),
            updateDocument: createUpdateDocumentTool(dataStream, openrouterModel),
          },
        });

        result.consumeStream();
        
        dataStream.merge(
          result.toUIMessageStream({
            sendReasoning: true,
          })
        );
      },
      onError: () => {
        return 'Опа, ошибка!';
      },
    });

    return new Response(stream.pipeThrough(new JsonToSseTransformStream()));
  } catch (error) {
    console.error('Ошибка:', error);
    return new Response(JSON.stringify({ error: String(error) }), { 
      status: 500 
    });
  }
}