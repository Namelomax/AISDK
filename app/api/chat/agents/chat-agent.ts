import { streamText, ModelMessage } from 'ai';
import { AgentContext } from './types';
import { updateConversation, saveConversation } from '@/lib/getPromt';

export async function runChatAgent(context: AgentContext, systemPrompt: string, userPrompt: string) {
  const { messages, model, userId, conversationId } = context;
  const messagesWithUserPrompt: ModelMessage[] = [];
  
  if (userPrompt && userPrompt.trim()) {
    messagesWithUserPrompt.push({
      role: 'system',
      content: `# ИНСТРУКЦИИ ДЛЯ РОЛИ\n\nСледуй этим инструкциям в каждом ответе:\n\n${userPrompt}`,
    });
  }
  
  messagesWithUserPrompt.push(...(messages as ModelMessage[]));
  const systemInstructions = `${systemPrompt}
  # ПРАВИЛА ОТВЕТОВ
  Выводи итоговый регламент только после того, как с пользователем пройдешь все шаги описания цепочек кооперации, каждый подпункт это отдельный этап который нужно подробно обсудить и согласовать с пользователем.
  Запрещено выводить разделы регламента до финальной сборки
  Запрещено выводить регламент отдельно по блокам (разделам)`;
  const stream = streamText({
    model,
    temperature: 0.1,
    messages: messagesWithUserPrompt,
    system: systemInstructions, // System instructions + parsed files
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
