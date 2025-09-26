import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { streamText, UIMessage, convertToModelMessages } from 'ai';

export const maxDuration = 30;

// Создаём экземпляр OpenRouter с API ключом
const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY!,
 // baseURL: "https://purple-wildflower-18a.namelomaxer.workers.dev/"
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
