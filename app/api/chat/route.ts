import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { streamText, UIMessage, convertToModelMessages } from 'ai';
import { loadEnvConfig } from '@next/env'
export const maxDuration = 30;
const projectDir = process.cwd()
loadEnvConfig(projectDir)
const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY!,  
  
});

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  console.log("Получены сообщения:", messages);
  console.log(process.env.OPENROUTER_API_KEY!);  
  const modelMessages = convertToModelMessages(messages);

  const result = streamText({
    model: openrouter('x-ai/grok-4-fast:free'),
    messages: modelMessages,
  });
  

  return result.toUIMessageStreamResponse();
}
