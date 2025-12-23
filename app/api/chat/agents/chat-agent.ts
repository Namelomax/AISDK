import { streamText, convertToModelMessages } from 'ai';
import { AgentContext } from './types';
import { updateConversation, saveConversation } from '@/lib/getPromt';

export async function runChatAgent(context: AgentContext, systemPrompt: string) {
  const { messages, model, userId, conversationId } = context;

  // Minimal instructions to ensure smooth operation without overriding user intent
  const effectiveSystemPrompt = systemPrompt;
  const stream = streamText({
    model,
    temperature: 0.3,
    messages: messages,
    system: effectiveSystemPrompt,
  });

  return stream.toUIMessageStreamResponse({
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
    },
  });
}
