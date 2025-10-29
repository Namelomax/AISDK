import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { streamText, UIMessage, convertToModelMessages, Output, smoothStream } from 'ai';
import { z } from 'zod';
import { getPrompt, updatePrompt } from '@/lib/getPromt';

export const maxDuration = 30;
export const runtime = 'nodejs';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY2!,
});

const model = openrouter.chat('nvidia/nemotron-nano-9b-v2:free');

let cachedPrompt: string | null = null;

async function ensurePrompt() {
  if (!cachedPrompt) cachedPrompt = await getPrompt();
  return cachedPrompt;
}

// Общая схема ответа
const baseSchema = z.object({
  text: z.string().describe('Текстовый ответ пользователю'),
  action: z
    .enum(['none', 'document', 'search'])
    .default('none')
    .describe('Тип действия, если нужно обработать запрос специальным агентом'),
});

// Document agent
const documentSchema = z.object({
  text: z.string(),
  document: z.object({
    title: z.string(),
    content: z.string(),
  }),
});

async function documentAgent(messages: any[], systemPrompt: string) {
  return streamText({
    model,
    messages: convertToModelMessages(messages),
    system: systemPrompt + '\nТы — помощник по созданию документов в Markdown.',
    experimental_output: Output.object({ schema: documentSchema }),
    experimental_transform: smoothStream(),
  });
}

// Serp агент
const serpSchema = z.object({
  text: z.string(),
  results: z.array(
    z.object({
      title: z.string(),
      link: z.string(),
      snippet: z.string(),
    })
  ),
});

export async function serpAgent(
  model: any,
  messages: UIMessage[],
  systemPrompt: string
) {
  const normalizedMessages: UIMessage[] = messages.map((m: any) => {
    const text =
      m.parts?.find((p: any) => p.type === 'text')?.text ||
      (typeof m.content === 'string' ? m.content : '') ||
      '';

    return {
      id: m.id || crypto.randomUUID(), // ✅ уникальный ID
      role: m.role || 'user',
      parts: [{ type: 'text' as const, text }],
    };
  });

  const last = normalizedMessages
    .slice()
    .reverse()
    .find((m) => m.role === 'user');

  const query =
    last?.parts?.find((p) => p.type === 'text')?.text?.trim() || '';

  // Поиск через SerpAPI
  const resp = await fetch(
    `https://serpapi.com/search.json?q=${encodeURIComponent(
      query
    )}&api_key=${process.env.SERP_API_KEY}`
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
          text: `Результаты поиска: ${JSON.stringify(
            results,
            null,
            2
          )}\nСформулируй краткий и понятный ответ на основе этих данных.`,
        },
      ],
    },
  ];

  // Структурированный вывод
  return streamText({
    model,
    messages: convertToModelMessages(extendedMessages),
    system:
      systemPrompt +
      '\nТы — ассистент, который формулирует краткий и понятный ответ на основе результатов поиска.',
    experimental_output: Output.object({
      schema: z.object({
        text: z.string(),
        results: z
          .array(
            z.object({
              title: z.string(),
              link: z.string(),
              snippet: z.string(),
            })
          )
          .optional(),
      }),
    }),
    experimental_transform: smoothStream(),
  });
}



// Основной POST
export async function POST(req: Request) {
  const { messages, newSystemPrompt } = await req.json();

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

  const { object: intent } = await (
    await import('ai')
  ).generateObject({
    model,
    schema: z.object({
      type: z.enum(['chat', 'document', 'search']),
    }),
    prompt: `Классифицируй сообщение пользователя:
"${lastText}"
Если речь о создании, редактировании или анализе документа — 'document'.
Если запрос о поиске, информации в интернете — 'search'.
Иначе — 'chat'.`,
  });

  let stream;

  // маршрутизация
  if (intent.type === 'document') {
    stream = await documentAgent(messages, systemPrompt);
  } else if (intent.type === 'search') {
    stream = await serpAgent(model,messages, systemPrompt);
  } else {
    stream = streamText({
      model,
      messages: convertToModelMessages(messages),
      system: systemPrompt,
      experimental_output: Output.object({ schema: baseSchema }),
      experimental_transform: smoothStream(),
    });
  }

  return stream.toUIMessageStreamResponse();
}
