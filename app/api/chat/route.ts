import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { streamText, UIMessage, convertToModelMessages } from 'ai';

export const maxDuration = 30;

// Создаём экземпляр OpenRouter с API ключом
const openrouter = createOpenRouter({
  apiKey: "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",
  //baseURL: "https://purple-wildflower-18a.namelomaxer.workers.dev/"
});

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  console.log("Получены сообщения:", messages);

  // Преобразуем UIMessage в формат модели
  const modelMessages = convertToModelMessages(messages);

  const result = streamText({
    model: openrouter.chat('x-ai/grok-4-fast:free'), // выбираем нужную модель
    messages: modelMessages,
  });

  return result.toUIMessageStreamResponse();
}
