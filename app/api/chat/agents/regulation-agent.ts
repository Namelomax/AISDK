import { streamText, createUIMessageStream, JsonToSseTransformStream } from 'ai';
import { AgentContext } from './types';
import { updateConversation, saveConversation } from '@/lib/getPromt';

export async function runRegulationAgent(context: AgentContext) {
  const { messages, model, userPrompt, documentContent, userId, conversationId } = context;
  let generatedDocumentContent = '';

  const stream = createUIMessageStream({
    originalMessages: messages as any, // Cast to any to satisfy UIMessage type if needed, or convert
    execute: async ({ writer }) => {
      try {
        generatedDocumentContent = await generateFinalRegulation(
          messages,
          userPrompt,
          writer,
          model,
          documentContent
        );
      } catch (error) {
        console.error('Regulation generation error:', error);
        writer.write({ type: 'text-start', id: 'error' });
        writer.write({
          type: 'text-delta',
          id: 'error',
          delta: 'Произошла ошибка при формировании регламента. Попробуйте снова.',
        });
        writer.write({ type: 'text-end', id: 'error' });
      }
    },
    onFinish: async ({ messages: finished }) => {
      if (userId) {
        try {
          if (conversationId) {
            await updateConversation(conversationId, finished, generatedDocumentContent);
          } else {
            await saveConversation(userId, finished, generatedDocumentContent);
          }
        } catch (e) {
          console.error('generate_regulation persistence failed', e);
        }
      }
    }
  });

  const readable = stream.pipeThrough(new JsonToSseTransformStream());
  return new Response(readable, { headers: { 'Content-Type': 'text/event-stream' } });
}

async function generateFinalRegulation(
  messages: any[], 
  userPrompt: string | null,
  dataStream: any,
  model: any,
  existingDocument?: string,
): Promise<string> {
  const conversationContext = messages
    .map((msg) => {
      const text = msg.content || msg.parts?.find((p: any) => p.type === 'text')?.text || '';
      return `${msg.role}: ${text}`;
    })
    .join('\n');

  // === STATE INJECTION ===
  // We inject the current document state into the prompt so the agent knows what it's working with.
  let directive = '';

  if (userPrompt && userPrompt.trim()) {
    // If user has a custom prompt, use ONLY that as the main instruction
    directive = `${userPrompt}

=== КОНТЕКСТ ЗАДАЧИ ===
История диалога ниже содержит всю информацию для формирования документа.`;
  } else {
    // Fallback minimal instruction if no user prompt
    directive = `Сформируй документ на основе всей истории диалога.
Первой строкой напиши заголовок документа, начиная с символа # (например: "# Регламент проведения...").
Используй ТОЛЬКО факты из переписки.
Никаких кодовых блоков и тройных кавычек.`;
  }

  if (existingDocument && existingDocument.trim().length > 20) {
    directive += `\n\n=== ТЕКУЩЕЕ СОСТОЯНИЕ ДОКУМЕНТА (STATE INJECTION) ===
Ниже приведен текущий текст документа. Твоя задача — обновить его, учитывая последние правки из диалога.
Верни ПОЛНЫЙ обновленный текст документа.

"""
${existingDocument}
"""
=====================================================
`;
  }

  directive += `\n\nИстория диалога:
${conversationContext}`;

  const stream = await streamText({
    model,
    temperature: 0.1,
    messages: [
      {
        role: 'user',
        content: directive,
      },
    ],
  });

  dataStream.write({ type: 'data-clear', data: null });
  const placeholderTitle = 'Генерация документа…';
  dataStream.write({ type: 'data-title', data: placeholderTitle });
  const progressId = `regulation-${crypto.randomUUID()}`;
  dataStream.write({ type: 'text-start', id: progressId });
  dataStream.write({
    type: 'text-delta',
    id: progressId,
    delta: '📄 Формирую финальный регламент. Изменения будут появляться справа по мере генерации.\n\n',
  });

  let bufferedForTitle = '';
  let publishedFinalTitle = false;
  let headingBuffer = '';
  let headingRemoved = false;
  let finalTitle = placeholderTitle;
  let hasEmittedContent = false;
  let fullContent = '';

  for await (const part of stream.fullStream) {
    if (part.type !== 'text-delta') continue;
    let chunk = String(part.text ?? '').replace(/\r/g, '');
    if (!chunk) continue;

    // Remove code blocks if model adds them
    chunk = chunk.replace(new RegExp('```markdown\\s*', 'gi'), '').replace(new RegExp('```', 'g'), '');
    if (!chunk) continue;

    // Buffer first line for title extraction
    if (!headingRemoved) {
      headingBuffer += chunk;
      const newlineIdx = headingBuffer.indexOf('\n');
      if (newlineIdx === -1) {
        continue; 
      }

      const headingLine = headingBuffer.slice(0, newlineIdx);

      if (!publishedFinalTitle) {
        let titleMatch = headingLine.match(/^#\s*(.+)$/);
        if (!titleMatch) {
          const boldMatch = headingLine.match(/^\*\*(.+)\*\*$/);
          if (boldMatch) titleMatch = boldMatch;
        }

        if (titleMatch) {
          finalTitle = titleMatch[1].trim() || finalTitle;
          dataStream.write({ type: 'data-title', data: finalTitle });
          publishedFinalTitle = true;
          chunk = headingBuffer; 
        } else {
          chunk = headingBuffer;
        }
      }

      headingBuffer = '';
      headingRemoved = true;
      if (!chunk) {
        continue;
      }
    }

    fullContent += chunk;
    dataStream.write({ type: 'data-documentDelta', data: chunk });
    hasEmittedContent = true;
  }

  if (!publishedFinalTitle) {
    dataStream.write({ type: 'data-title', data: finalTitle });
  }

  if (!hasEmittedContent) {
    const fallback = fullContent.trim() || '*Информация не предоставлена в диалоге.*';
    dataStream.write({ type: 'data-documentDelta', data: fallback });
  }

  dataStream.write({ type: 'data-finish', data: null });
  dataStream.write({
    type: 'text-delta',
    id: progressId,
    delta: `\n\n✅ Регламент "${finalTitle}" сформирован. При необходимости попросите меня внести изменения.`,
  });
  dataStream.write({ type: 'text-end', id: progressId });

  return fullContent;
}
