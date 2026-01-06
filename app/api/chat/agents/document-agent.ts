import { streamText, createUIMessageStream, JsonToSseTransformStream, generateObject } from 'ai';
import { z } from 'zod';
import { AgentContext } from './types';
import { updateConversation, saveConversation } from '@/lib/getPromt';
import { applyDocumentPatches, extractDocumentTitle, type DocumentPatch } from '@/lib/documentPatches';

function extractMessageText(msg: any): string {
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg?.parts)) {
    const texts = msg.parts
      .map((p: any) => (p?.type === 'text' && typeof p.text === 'string' ? p.text : ''))
      .filter(Boolean);
    if (texts.length) return texts.join(' ');
  }
  if (msg?.content && typeof msg.content === 'object') {
    try {
      return JSON.stringify(msg.content);
    } catch (e) {
      return String(msg.content);
    }
  }
  return '';
}

function isConfirmation(text: string): boolean {
  const t = (text || '').trim().toLowerCase();
  if (!t) return false;
  return /^(верно|да|ок|okay|окей|согласен|согласна|подтверждаю|вноси|внеси|делай|выполняй|применяй)([.!?\s,].*)?$/i.test(t);
}

function normalizeNewlines(input: string): string {
  return (input ?? '').replace(/\r\n?/g, '\n');
}

function stripLeadingMarkdownHeading(input: string): string {
  const t = normalizeNewlines(input);
  return t.replace(/^#{1,6}\s+.*\n/, '');
}

function stripCodeFences(input: string): string {
  return String(input ?? '')
    .replace(/```markdown\s*/gi, '')
    .replace(/```/g, '');
}

function stripEmbeddedAttachments(text: string): string {
  if (!text) return '';
  return String(text)
    .replace(/\n---\nВложенный файл:[\s\S]*?\n---/g, '')
    .replace(/<AI-HIDDEN>[\s\S]*?<\/AI-HIDDEN>/gi, '')
    .trim();
}

function stripHeadingSyntax(input: string): string {
  const trimmed = (input ?? '').trim();
  const m = trimmed.match(/^#{1,6}\s+(.+?)\s*$/);
  if (m) return m[1].trim();
  return trimmed;
}

function extractSectionBody(markdown: string, headingQuery: string): string | null {
  const doc = normalizeNewlines(markdown ?? '');
  const queryText = stripHeadingSyntax(headingQuery);
  if (!doc.trim() || !queryText) return null;

  const lines = doc.split('\n');

  let headingIndex = -1;
  let headingLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!m) continue;
    const level = m[1].length;
    const text = (m[2] ?? '').trim();
    if (text === queryText) {
      headingIndex = i;
      headingLevel = level;
      break;
    }
  }

  if (headingIndex === -1) return null;

  let endIndex = lines.length;
  for (let j = headingIndex + 1; j < lines.length; j++) {
    const m = lines[j].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!m) continue;
    const level = m[1].length;
    if (level <= headingLevel) {
      endIndex = j;
      break;
    }
  }

  const body = lines.slice(headingIndex + 1, endIndex).join('\n').trimEnd();
  return body;
}

export async function runDocumentAgent(context: AgentContext) {
  const { messages, model, userPrompt, documentContent, userId, conversationId } = context;
  let generatedDocumentContent = '';

  const stream = createUIMessageStream({
    originalMessages: messages as any,
    execute: async ({ writer }) => {
      try {
        generatedDocumentContent = await generateFinalDocument(
          messages,
          userPrompt,
          writer,
          model,
          documentContent
        );
      } catch (error) {
        console.error('Document generation error:', error);
        writer.write({ type: 'text-start', id: 'error' });
        writer.write({
          type: 'text-delta',
          id: 'error',
          delta: 'Произошла ошибка при формировании документа. Попробуйте снова.',
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
          console.error('document persistence failed', e);
        }
      }
    }
  });

  const readable = stream.pipeThrough(new JsonToSseTransformStream());
  return new Response(readable, { headers: { 'Content-Type': 'text/event-stream' } });
}

async function generateFinalDocument(
  messages: any[], 
  userPrompt: string | null,
  dataStream: any,
  model: any,
  existingDocument?: string,
  temperature: number = 0.1,
): Promise<string> {
  const lastUserTextRaw = (() => {
    const lastUser = [...(messages || [])].reverse().find((m) => m?.role === 'user');
    return stripEmbeddedAttachments(extractMessageText(lastUser));
  })();

  const isEditRequest = (text: string) => {
    const t = (text || '').toLowerCase();
    return Boolean(
      t &&
      (
        t.includes('измени') ||
        t.includes('передел') ||
        t.includes('отредакт') ||
        t.includes('поправ') ||
        t.includes('замени') ||
        t.includes('добав') ||
        t.includes('убер') ||
        t.includes('удали') ||
        t.includes('исключ') ||
        t.includes('верни') ||
        t.includes('восстанов') ||
        t.includes('внеси') ||
        t.includes('занеси') ||
        t.includes('внести') ||
        t.includes('занести') ||
        t.includes('дополни') ||
        t.includes('оставь') ||
        t.includes('осталось') ||
        t.includes('оставалось') ||
        t.includes('только')
      ) &&
      (
        t.includes('пункт') ||
        t.includes('подпункт') ||
        t.includes('раздел') ||
        t.includes('в документ') ||
        t.includes('в регламент') ||
        t.includes('в правой панели') ||
        t.includes('в тексте') ||
        /\b\d+(?:\.\d+)+\b/.test(t)
      )
    );
  };

  const lastAssistantText = (() => {
    const msgs = messages || [];
    const lastUserIdx = [...msgs].map((m, i) => ({ m, i })).reverse().find(({ m }) => m?.role === 'user')?.i ?? -1;
    if (lastUserIdx <= 0) return '';
    for (let i = lastUserIdx - 1; i >= 0; i--) {
      if (msgs[i]?.role === 'assistant') return stripEmbeddedAttachments(extractMessageText(msgs[i]));
    }
    return '';
  })();

  const effectiveEditText = (() => {
    if (!lastUserTextRaw) return '';
    if (isConfirmation(lastUserTextRaw) && lastAssistantText) {
      // When user says "верно/вноси" the actual edit instructions are usually in the previous assistant message.
      return `Пользователь подтвердил применение правки. Применить правку из сообщения ассистента ниже.\n\nСООБЩЕНИЕ АССИСТЕНТА (контекст правки):\n${lastAssistantText}`;
    }
    return lastUserTextRaw;
  })();

  const hasExisting = Boolean(existingDocument && existingDocument.trim().length > 20);

  console.log('🩹 Document edit detection:', {
    hasExisting,
    lastUser: (lastUserTextRaw || '').slice(0, 120),
    isConfirmation: isConfirmation(lastUserTextRaw),
    effectiveEdit: (effectiveEditText || '').slice(0, 120),
    patchMode: hasExisting && isEditRequest(effectiveEditText),
  });

  // PATCH MODE: ask the model for targeted section replacement patches.
  if (hasExisting && isEditRequest(effectiveEditText)) {
    const currentTitle = extractDocumentTitle(existingDocument || '');
    if (currentTitle) {
      dataStream.write({ type: 'data-title', data: currentTitle });
    }

    const progressId = `doc-edit-${crypto.randomUUID()}`;
    dataStream.write({ type: 'text-start', id: progressId });
    dataStream.write({
      type: 'text-delta',
      id: progressId,
      delta: '✏️ Вношу правку в документ…\n\n',
    });

    // 1) Build a minimal patch plan (fast JSON, no bodies)
    const planSchema = z.object({
      patches: z
        .array(
          z.object({
            heading: z.string().min(1),
            mode: z.enum(['replace', 'append', 'delete', 'rename']).optional(),
            newHeading: z.string().optional(),
            instructions: z.string().min(1),
          })
        )
        .min(1),
    });

    const planPrompt = `Ты редактор Markdown-документа (регламента).

ВАЖНО:
- НЕ переписывай документ полностью.
- Верни ТОЛЬКО JSON (без Markdown, без пояснений).
- Сначала верни ПЛАН правок (без текста разделов), чтобы затем можно было сгенерировать тело раздела потоково.

ФОРМАТ JSON:
{"patches":[{"heading":"<существующий заголовок раздела>","mode":"replace|append|delete|rename","newHeading":"<новый заголовок для rename>","instructions":"<что именно изменить в этом разделе>"}]}

ПРАВИЛА:
- heading должен соответствовать существующему заголовку раздела в документе (текст заголовка без изменений).
- mode:
  - "append" — если нужно ДОБАВИТЬ пункт/абзац/подпункт.
  - "replace" — если нужно ПЕРЕПИСАТЬ содержимое раздела.
  - "delete" — если нужно УДАЛИТЬ раздел целиком.
  - "rename" — если нужно изменить ТОЛЬКО НАЗВАНИЕ пункта/раздела (переименовать строку заголовка), НЕ трогая тело и подпункты.
- instructions: одно-два предложения, максимально конкретно.
- Если mode=rename, ОБЯЗАТЕЛЬНО заполни newHeading (можно сохранить нумерацию вроде "1.1" и поменять только текст).
- Если пользователь просит добавить «пункт 2.1» — выбирай родительский раздел и mode=append.
- Если пользователь просит ВЕРНУТЬ/ВОССТАНОВИТЬ пункт, которого сейчас НЕТ — выбирай родительский раздел и mode=append.
- Если пользователь просит добавить пункт N.M — НЕ добавляй/не дублируй уже существующий пункт N.M. Если он уже есть, тогда mode=replace и instructions должны описывать ИЗМЕНЕНИЕ существующего пункта, а не повтор.

ТЕКУЩИЙ ДОКУМЕНТ:
"""
${existingDocument}
"""

ЗАПРОС ПОЛЬЗОВАТЕЛЯ:
"""
${effectiveEditText}
"""`;

    const { object: plan } = await generateObject({
      model,
      temperature,
      schema: planSchema,
      prompt: planPrompt,
    });

    const finalPatches: DocumentPatch[] = [];
    let workingDocument = existingDocument || '';

    const requestedPoint = (() => {
      const m = String(effectiveEditText || '').match(/\b\d+(?:\.\d+)+\b/);
      return m?.[0] ?? '';
    })();

    // 2) Stream patch bodies from the model as tokens arrive (no artificial delays)
    for (const planned of plan.patches) {
      const heading = planned.heading;
      const mode: 'replace' | 'append' | 'delete' | 'rename' =
        planned.mode === 'append'
          ? 'append'
          : planned.mode === 'delete'
            ? 'delete'
            : planned.mode === 'rename'
              ? 'rename'
              : 'replace';

      if (mode === 'rename') {
        const newHeading = String((planned as any).newHeading ?? '').trim();
        if (!newHeading) {
          // Safer to do nothing than to rewrite the section and risk losing nested items.
          continue;
        }
        const patch: DocumentPatch = { heading, mode: 'rename', content: '', newHeading };
        dataStream.write({ type: 'data-documentPatch', data: patch });
        finalPatches.push(patch);
        workingDocument = applyDocumentPatches(workingDocument, [patch]);
        continue;
      }

      if (mode === 'delete') {
        const patch: DocumentPatch = { heading, mode: 'delete', content: '' };
        dataStream.write({ type: 'data-documentPatch', data: patch });
        finalPatches.push(patch);
        workingDocument = applyDocumentPatches(workingDocument, [patch]);
        continue;
      }

      const baseBody = mode === 'append' ? extractSectionBody(workingDocument, heading) ?? '' : '';

      const contentPrompt = `Ты генерируешь ТОЛЬКО контент для правки Markdown-документа.

ОГРАНИЧЕНИЯ:
- Не добавляй строку заголовка (никаких "#", "##" в первой строке).
- Не используй тройные кавычки и fenced code blocks.
- Верни только Markdown-тело.

РЕЖИМ:
- mode=append: верни ТОЛЬКО добавляемый фрагмент (один подпункт/абзац), без пересказа всего раздела.
- mode=replace: верни ПОЛНОЕ тело раздела (без строки заголовка).

ДОПОЛНИТЕЛЬНЫЕ ТРЕБОВАНИЯ:
- Не вставляй лишние пробелы/переносы внутри слов.
- Если запрос явно про пункт "${requestedPoint}" и mode=append, то добавляемый фрагмент должен начинаться с "${requestedPoint}." (например: "${requestedPoint}. Текст...").

КОНТЕКСТ:
- Заголовок раздела: "${heading}"
- Mode: ${mode}
- Инструкция правки: ${planned.instructions}

ТЕКУЩИЙ ДОКУМЕНТ:
"""
${workingDocument}
"""

ПОСЛЕДНИЙ ЗАПРОС ПОЛЬЗОВАТЕЛЯ:
"""
${effectiveEditText}
"""`;

      const stream = await streamText({
        model,
        temperature,
        messages: [{ role: 'user', content: contentPrompt }],
      });

      let acc = '';
      for await (const part of stream.fullStream) {
        if (part.type !== 'text-delta') continue;
        let delta = String(part.text ?? '');
        if (!delta) continue;
        delta = stripCodeFences(delta);
        if (!delta) continue;

        // IMPORTANT: never stream per-token append patches.
        // The client-side applyDocumentPatches() inserts "\n\n" between appends,
        // which breaks words when deltas are tiny.
        acc += delta;

        const streamedBody =
          mode === 'append'
            ? [baseBody.trimEnd(), stripLeadingMarkdownHeading(acc)].filter(Boolean).join('\n\n')
            : stripLeadingMarkdownHeading(acc);

        dataStream.write({
          type: 'data-documentPatch',
          data: { heading, mode: 'replace', content: streamedBody } satisfies DocumentPatch,
        });
      }

      const finalContent = stripLeadingMarkdownHeading(stripCodeFences(acc)).trimEnd();
      const finalPatch: DocumentPatch = { heading, mode, content: finalContent };
      finalPatches.push(finalPatch);
      workingDocument = applyDocumentPatches(workingDocument, [finalPatch]);
    }

    let updated = workingDocument;
    if (!updated.trim()) updated = existingDocument || '';

    dataStream.write({ type: 'data-finish', data: null });
    dataStream.write({
      type: 'text-delta',
      id: progressId,
      delta: '✅ Правка применена к документу.\n',
    });
    dataStream.write({ type: 'text-end', id: progressId });

    return updated;
  }

  const conversationContext = messages
    .map((msg) => {
      const text = extractMessageText(msg);
      return text ? `${msg.role}: ${text}` : '';
    })
    .filter(Boolean)
    .join('\n');

  // === STATE INJECTION ===
  // We inject the current document state into the prompt so the agent knows what it's working with.
  let directive = '';

  if (userPrompt && userPrompt.trim()) {
    // If user has a custom prompt, use ONLY that as the main instruction
    directive = `${userPrompt}

  === ДАННЫЕ ДЛЯ ДОКУМЕНТА (ИСТОРИЯ ДИАЛОГА) ===
  ${conversationContext}

  === ВЫВОД ===
  Сформируй ПОЛНЫЙ документ по инструкции выше. В ответе не задавай вопросов, не добавляй приветствий и пояснений.
  Первая строка ответа — заголовок с символом # (например, "# Регламент ...").
  Затем выведи весь текст документа. Никаких списков действий, сообщений ассистента или пояснений — только итоговый документ.
  Если данных мало, выведи краткий документ из того, что есть, без заглушек "информация не предоставлена".`;
  } else {
    // Fallback minimal instruction if no user prompt
    directive = `Сформируй документ на основе всей истории диалога.
  Первая строка — заголовок с символом # (например: "# Регламент проведения...").
  Используй ТОЛЬКО факты из переписки.
  История диалога:
  ${conversationContext}

  Выведи только финальный документ: без вопросов, без приветствий, без пояснений.
  Если данных мало, выведи краткий документ из того, что есть, без заглушек "информация не предоставлена".
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

  // История диалога уже включена выше

  const stream = await streamText({
    model,
    temperature,
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
    const fallbackSource = conversationContext.trim() || '*Информация не предоставлена в диалоге.*';
    dataStream.write({ type: 'data-documentDelta', data: fallbackSource });
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
