import { streamText, ModelMessage } from 'ai';
import { AgentContext } from './types';
import { updateConversation, saveConversation } from '@/lib/getPromt';

export async function runChatAgent(context: AgentContext, systemPrompt: string, userPrompt: string) {
  const { messages, model, userId, conversationId } = context;
  const messagesWithUserPrompt: ModelMessage[] = [];
  
  if (userPrompt && userPrompt.trim()) {
    messagesWithUserPrompt.push({
      role: 'system',
      content: userPrompt,
    });
  }
  
  messagesWithUserPrompt.push(...(messages as ModelMessage[]));
  const stream = streamText({
    model,
    temperature: 0,
    messages: messagesWithUserPrompt,
    system: systemPrompt, // System instructions + parsed files
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
