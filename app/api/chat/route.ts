import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { streamText, UIMessage, convertToModelMessages } from 'ai';

export const maxDuration = 30;

// Создаём экземпляр OpenRouter с API ключом
const openrouter = createOpenRouter({
  apiKey: "Bearer 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",
 //baseURL: "https://purple-wildflower-18a.namelomaxer.workers.dev/"
});

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  console.log("Получены сообщения:", messages);

  // Преобразуем UIMessage в формат модели
  const modelMessages = convertToModelMessages(messages);

  const result = streamText({
    model: openrouter('x-ai/grok-4-fast:free'), // выбираем нужную модель
    messages: modelMessages,
  });

  return result.toUIMessageStreamResponse();
}
