import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { 
  streamText, 
  UIMessage, 
  convertToModelMessages, 
  Output, 
  createUIMessageStream,
  JsonToSseTransformStream,
} from 'ai';
import { z } from 'zod';
import { getPrompt, updatePrompt, saveConversation, createPromptForUser, updateConversation, getUserSelectedPrompt, getPromptById } from '@/lib/getPromt';


export const maxDuration = 90;
export const runtime = 'nodejs';
const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseURL: 'https://openrouter.ai/api/v1',
  compatibility: 'strict',
  headers: {
    ...(process.env.OPENROUTER_REFERER ? { 'HTTP-Referer': process.env.OPENROUTER_REFERER } : {}),
    'X-Title': 'AISDK',
  },
});

const model = openrouter.chat('nvidia/nemotron-nano-12b-v2-vl:free');


let cachedPrompt: string | null = null;

function buildSystemPrompt(userPrompt: string): string {
  const trimmed = (userPrompt ?? '').trim();
  if (trimmed) return trimmed;
  return 'Ты — ассистент. Пользовательский системный промт не задан: уточни вводные и следуй дальнейшим указаниям пользователя.';
}

async function resolveSystemPrompt(userId?: string | null): Promise<string> {
  // Prefer the user's selected prompt when available
  if (userId) {
    try {
      const selectedId = await getUserSelectedPrompt(userId);
      if (selectedId) {
        const prompt = await getPromptById(selectedId);
        if (prompt?.content) return prompt.content;
      }
    } catch (error) {
      console.error('Failed to load user prompt, falling back to default:', error);
    }
  }

  // Fallback to cached default prompt
  if (!cachedPrompt) cachedPrompt = await getPrompt();
  return cachedPrompt;
}

const URL_REGEX = /(https?:\/\/[^\s<>"']+)/gi;
const MAX_DOC_CONTEXT_CHARS = 4000;
const HIDDEN_RE = /<AI-HIDDEN>[\s\S]*?<\/AI-HIDDEN>/gi;
const HIDDEN_CAPTURE_RE = /<AI-HIDDEN>[\s\S]*?<\/AI-HIDDEN>/gi;

function dataUrlToBuffer(dataUrl?: string | null): Buffer | null {
  if (!dataUrl) return null;
  const match = String(dataUrl).match(/^data:[^;]+;base64,(.+)$/i);
  if (!match) return null;
  try {
    return Buffer.from(match[1], 'base64');
  } catch {
    return null;
  }
}

async function extractPdfTextFromAttachment(att: any): Promise<string | null> {
  if (!att || att.mediaType !== 'application/pdf') return null;
  const buf = dataUrlToBuffer(att.url || att.data);
  if (!buf) return null;
  try {
    const { default: pdfParse } = await import('pdf-parse');
    const parsed = await pdfParse(buf);
    const text = parsed?.text?.trim();
    return text || null;
  } catch (error) {
    console.error('Failed to parse PDF attachment:', error);
    return null;
  }
}

function extractUrls(text?: string | null): string[] {
  if (!text) return [];
  const matches = text.match(URL_REGEX);
  if (!matches) return [];
  const sanitized = matches
    .map((url) => url.replace(/[)\],.]+$/, ''))
    .filter((url) => url.toLowerCase().startsWith('http'));
  const unique = Array.from(new Set(sanitized));
  return unique.slice(0, 20);
}

function withStructuredOutput<T>(
  enable: boolean,
  outputFactory: () => T,
): T | undefined {
  return enable ? outputFactory() : undefined;
}

async function fetchGoogleDocText(url: string): Promise<string | null> {
  const match = url.match(/docs\.google\.com\/document\/d\/([\w-]+)/i);
  if (!match) return null;
  const docId = match[1];
  const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;
  try {
    const resp = await fetch(exportUrl, { method: 'GET' });
    if (!resp.ok) {
      return null;
    }
    const text = await resp.text();
    return text.trim() ? text : null;
  } catch (error) {
    console.warn('Failed to fetch Google Doc text:', error);
    return null;
  }
}

async function resolveUrlContexts(urls: string[]): Promise<Array<{ url: string; content: string }>> {
  const resolved: Array<{ url: string; content: string }> = [];
  await Promise.all(
    urls.map(async (url) => {
      if (/docs\.google\.com\/document\//i.test(url)) {
        const text = await fetchGoogleDocText(url);
        if (text) {
          resolved.push({
            url,
            content: text.slice(0, MAX_DOC_CONTEXT_CHARS),
          });
        }
      }
    })
  );
  return resolved;
}


// Serp агент
async function serpAgent(
  messages: UIMessage[],
  systemPrompt: string,
  tools?: Record<string, any>,
) {
  const normalizedMessages: UIMessage[] = messages.map((m: any) => {
    const text =
      m.parts?.find((p: any) => p.type === 'text')?.text ||
      (typeof m.content === 'string' ? m.content : '') ||
      '';

    return {
      id: m.id || crypto.randomUUID(),
      role: m.role || 'user',
      parts: [{ type: 'text' as const, text }],
    };
  });

  const last = normalizedMessages
    .slice()
    .reverse()
    .find((m) => m.role === 'user');

  const query = last?.parts?.find((p) => p.type === 'text')?.text?.trim() || '';

  // Поиск через SerpAPI
  const resp = await fetch(
    `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${process.env.SERP_API_KEY}`
  );
  const json = await resp.json();

  const results =
    json.organic_results?.slice(0, 3).map((r: any) => ({
      title: r.title,
      link: r.link,
      snippet: r.snippet,
    })) ?? [];

  const linkedUrls = extractUrls(query);
  const resolvedLinkContexts = await resolveUrlContexts(linkedUrls);
  const supplementalMessages: UIMessage[] = resolvedLinkContexts.map((doc) => ({
    id: crypto.randomUUID(),
    role: 'user',
    parts: [
      {
        type: 'text' as const,
        text: `Из публичного документа (${doc.url}) извлечено содержимое:
${doc.content}`,
      },
    ],
  }));
  const extendedMessages: UIMessage[] = [
    ...(normalizedMessages as UIMessage[]),
    ...supplementalMessages,
  ];

    return streamText({
      model,
      tools,
      messages: convertToModelMessages(extendedMessages),
      system: systemPrompt,
    });
}

// Основной POST
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  let { messages, newSystemPrompt, userId } = body as any;
  let conversationId: string | null = null;
  try {
    const url = new URL(req.url);
    conversationId = body.conversationId || url.searchParams.get('conversationId');
  } catch {}
  if (!Array.isArray(messages)) {
    messages = [];
  }

  const toPlainText = (msg: any): string => {
    if (Array.isArray(msg.parts)) {
      const textPart = msg.parts.find((p: any) => p?.type === 'text' && typeof p.text === 'string');
      if (textPart?.text) return String(textPart.text);
    }

    if (typeof msg.content === 'string') return msg.content;

    if (Array.isArray(msg.content)) {
      const joined = msg.content
        .map((c: any) => {
          if (typeof c === 'string') return c;
          if (c?.text) return String(c.text);
          return '';
        })
        .filter(Boolean)
        .join('\n');
      if (joined) return joined;
    }

    if (typeof msg.text === 'string') return msg.text;
    return '';
  };

  const baseMessages: any[] = Array.isArray(messages) && messages.length > 0
    ? messages
    : (body && (body.text || body.message)
      ? [{
          id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
          role: 'user',
          parts: [{ type: 'text', text: String(body.text ?? body.message ?? '') }],
          content: String(body.text ?? body.message ?? ''),
        }]
      : []);

  const normalizedMessages: any[] = baseMessages.map((m: any) => {
    const rawText = toPlainText(m);

    const hiddenMatches = rawText.match(HIDDEN_CAPTURE_RE) || [];
    const hiddenTexts = hiddenMatches
      .map((segment) => segment.replace(/<AI-HIDDEN>/gi, '').replace(/<\/AI-HIDDEN>/gi, '').trim())
      .filter(Boolean);

    const visibleText = rawText.replace(HIDDEN_RE, '').trim();

    const fileParts = Array.isArray(m?.parts)
      ? m.parts.filter((p: any) => p?.type === 'file')
      : [];

    const attachmentsFromParts = fileParts
      .map((file: any) => {
        const url = file?.url || file?.data || '';
        if (!url) return null;
        return {
          id: file.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
          name: file.filename || 'attachment',
          url,
          mediaType: file.mediaType || file.mimeType,
        };
      })
      .filter(Boolean);

    const attachmentsFromMeta = Array.isArray(m?.metadata?.attachments)
      ? m.metadata.attachments.map((att: any) => ({
          id: att.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
          name: att.name || att.filename || 'attachment',
          url: att.url || att.data || '',
          mediaType: att.mediaType || att.mimeType,
          content: att.content,
        }))
      : [];

    const attachments = [...attachmentsFromMeta, ...attachmentsFromParts];

    const attachmentsText = attachments
      .map((att: any) => {
        const name = att?.name ? String(att.name) : 'attachment';
        const content = att?.content ? String(att.content) : '';
        return content ? `Файл: ${name}\n${content}` : '';
      })
      .filter(Boolean)
      .join('\n\n');

    const combined = [visibleText, attachmentsText].filter(Boolean).join('\n\n');

    return {
      id: m.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
      role: ['assistant', 'user', 'system', 'tool'].includes(m.role) ? m.role : 'user',
      content: combined,
      parts: [{ type: 'text' as const, text: combined }],
      metadata: { ...(m.metadata || {}), attachments, hiddenTexts },
    };
  });

  for (const msg of normalizedMessages) {
    const atts: any[] = Array.isArray(msg?.metadata?.attachments) ? msg.metadata.attachments : [];
    const pdfs = atts.filter((a) => a?.mediaType === 'application/pdf');
    if (!pdfs.length) continue;

    const pdfTexts = await Promise.all(pdfs.map(extractPdfTextFromAttachment));
    const extracted = pdfTexts.filter((t): t is string => Boolean(t && t.trim()));
    if (extracted.length) {
      msg.metadata = {
        ...(msg.metadata || {}),
        attachments: atts,
        hiddenTexts: [...(msg.metadata?.hiddenTexts || []), ...extracted],
      };
    }
  }

  try {
    const url = new URL(req.url);
    const qp = url.searchParams.get('userId');
    if (!userId && qp) userId = qp;
  } catch (e) {
    // ignore
  }

  const currentDocument = normalizedMessages.length ? normalizedMessages.at(-1)?.metadata?.currentDocument : undefined;
  console.log(currentDocument, 'currentDocument');
  console.log(normalizedMessages.length ? normalizedMessages.at(-1) : undefined, 'message');

  if (newSystemPrompt) {
    // If userId provided, save prompt for user
    try {
      if (userId) {
        const title = (newSystemPrompt || '').slice(0, 60) || 'User Prompt';
        await createPromptForUser(userId, title, newSystemPrompt);
      } else {
        await updatePrompt(newSystemPrompt);
      }
      cachedPrompt = newSystemPrompt;
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    } catch (err) {
      console.error('Error saving prompt for user:', err);
      return new Response(JSON.stringify({ success: false }), { status: 500 });
    }
  }

  const userPrompt = await resolveSystemPrompt(userId);
  const systemPrompt = buildSystemPrompt(userPrompt);

  console.log('System prompt applied:', {
    userId: userId || 'anon',
    length: systemPrompt.length,
    preview: systemPrompt.slice(0, 160),
  });

  const lastUserMessage = normalizedMessages[normalizedMessages.length - 1];
  const lastText =
    lastUserMessage?.content ||
    lastUserMessage?.parts?.find((p: any) => p.type === 'text')?.text ||
    '';
  const linkedUrls = extractUrls(lastText);
  const baseTools = undefined;
  const urlContextHint = '';
  const resolvedLinkContexts = await resolveUrlContexts(linkedUrls);
  const supplementalMessages: UIMessage[] = resolvedLinkContexts.map((doc) => ({
    id: crypto.randomUUID(),
    role: 'user',
    parts: [
      {
        type: 'text' as const,
        text: `Из публичного документа (${doc.url}) извлечено содержимое:\n${doc.content}`,
      },
    ],
  }));

  const messagesWithHidden: UIMessage[] = [];
  (normalizedMessages as UIMessage[]).forEach((msg) => {
    const hiddenTexts: string[] = Array.isArray((msg as any)?.metadata?.hiddenTexts)
      ? (msg as any).metadata.hiddenTexts
      : [];

    hiddenTexts.forEach((hidden, idx) => {
      messagesWithHidden.push({
        id: `${msg.id}-hidden-${idx}`,
        role: 'system',
        parts: [{ type: 'text' as const, text: `Скрытый контент из вложений пользователя:\n${hidden}` }],
      } as UIMessage);
    });

    messagesWithHidden.push(msg);
  });

  const extendedMessages: UIMessage[] = [
    ...messagesWithHidden,
    ...supplementalMessages,
  ];

  console.log('🔍 Debug Info:', {
    totalMessages: normalizedMessages.length,
    lastUserMessage: lastText.substring(0, 150),
  });

  // If userId provided, save or update conversation in background.
  // Some clients may not send `messages` as an array; build a sensible fallback.
  if (userId) {
    try {
      const convId = (body && body.conversationId) || (() => {
        try { const u = new URL(req.url); return u.searchParams.get('conversationId'); } catch { return null; }
      })();

      const msgsToSave: any[] = normalizedMessages.length > 0
        ? normalizedMessages
        : (lastUserMessage ? [lastUserMessage] : (body && (body.text || body.message) ? [{
            id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
            role: 'user',
            parts: [{ type: 'text', text: String(body.text ?? body.message ?? '') }],
            content: String(body.text ?? body.message ?? ''),
          }] : []));

      if (msgsToSave.length > 0) {
        if (convId) {
          try {
            const mod = await import('@/lib/getPromt');
            void mod.updateConversation(convId, msgsToSave);
          } catch (e) {
            console.error('Failed to update conversation:', e);
          }
        } else {
          try {
            const mod = await import('@/lib/getPromt');
            void mod.saveConversation(userId, msgsToSave);
          } catch (e) {
            console.error('Failed to create conversation:', e);
          }
        }
      }
    } catch (err) {
      console.error('Failed to save conversation:', err);
    }
  }

  // Определяем намерение пользователя
  let intentType: 'chat' | 'document' | 'search' | 'generate_regulation' | 'casual' = 'chat';
  try {
    const { object: intentObj } = await (await import('ai')).generateObject({
      model,
     // system: systemPrompt,
      schema: z.object({
        type: z.enum(['chat', 'document', 'search', 'generate_regulation', 'casual']),
      }),
      prompt: `
Ты — классификатор пользовательских сообщений.

Сообщение пользователя:
"""
${lastText}
"""

Верни ТОЛЬКО JSON формата {"type":"<одно из значений>"} без каких-либо пояснений, текста или Markdown. Никаких обоснований.
Варианты type: generate_regulation, document, search, chat, casual.
`,
    });
    intentType = intentObj.type;
  } catch (err) {
    console.error('Intent classification failed, defaulting to chat:', err);
  }

  const intent = { type: intentType };
  const userMessageCount = normalizedMessages.filter((m) => m.role === 'user').length;
  // Избегаем автоперехода в document на самом первом сообщении — отвечаем как обычный чат
  if (intent.type === 'document' && userMessageCount <= 1) {
    intent.type = 'chat';
  }

  // Не теряем системный промт на "casual" — ведём как обычный чат
  if (intent.type === 'casual') {
    intent.type = 'chat';
  }

  console.log('Detected intent:', intent.type);

  // === Роутинг по агентам ===
  if (intent.type === 'generate_regulation') {
    const stream = createUIMessageStream({
      originalMessages: normalizedMessages,
      execute: async ({ writer }) => {
        try {
          await generateFinalRegulation(normalizedMessages, systemPrompt, writer);
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
              await updateConversation(conversationId, finished);
            } else {
              await saveConversation(userId, finished);
            }
          } catch (e) {
            console.error('generate_regulation persistence failed', e);
          }
        }
      }
    });
    const readable = stream.pipeThrough(new JsonToSseTransformStream());
    return wrapReadableWithSessionSave(readable, userId);
  }

  if (intent.type === 'document') {
    const stream = createUIMessageStream({
      originalMessages: normalizedMessages,
      execute: async ({ writer }) => {
        writer.write({ type: 'data-clear', data: null });
        writer.write({ type: 'data-title', data: '' });
        writer.write({ type: 'data-finish', data: null });

        const holdId = `doc-hold-${crypto.randomUUID()}`;
        const guidance = getDocumentGuidance();

        writer.write({ type: 'text-start', id: holdId });
        writer.write({ type: 'text-delta', id: holdId, delta: ` ${guidance.heading}\n\n${guidance.actions}` });
        writer.write({ type: 'text-end', id: holdId });
      },
      onFinish: async ({ messages: finished }) => {
        if (userId) {
          try {
            if (conversationId) {
              await updateConversation(conversationId, finished);
            } else {
              await saveConversation(userId, finished);
            }
          } catch (e) {
            console.error('document persistence failed', e);
          }
        }
      }
    });
    const readable = stream.pipeThrough(new JsonToSseTransformStream());
    return wrapReadableWithSessionSave(readable, userId);
  }

  if (intent.type === 'search') {
    const stream = await serpAgent(normalizedMessages, systemPrompt, baseTools);
    const resp = stream.toUIMessageStreamResponse({
      originalMessages: normalizedMessages,
      onFinish: async ({ messages: finished }) => {
        if (userId) {
          try {
            if (conversationId) {
              await updateConversation(conversationId, finished);
            } else {
              await saveConversation(userId, finished);
            }
          } catch (e) {
            console.error('search onFinish persistence failed', e);
          }
        }
      }
    });
    return wrapResponseWithSessionSave(resp, userId);
  }

  // Основной диалог
  const stream = streamText({
    model,
    tools: baseTools,
    messages: convertToModelMessages(extendedMessages),
    system: systemPrompt,
  });
  const resp = stream.toUIMessageStreamResponse({
    originalMessages: normalizedMessages,
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
    }
  });
  return wrapResponseWithSessionSave(resp, userId);
}

// Helper to wrap a ReadableStream (SSE)
function wrapReadableWithSessionSave(readable: ReadableStream, userId?: string | null) {
  const wrapped = new ReadableStream({
    async start(controller) {
      const reader = readable.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
      // no-op: we no longer persist session info here
    }
  });

  return new Response(wrapped, { headers: { 'Content-Type': 'text/event-stream' } });
}

function wrapResponseWithSessionSave(resp: Response, userId?: string | null) {
  const body = resp.body;
  if (!body) return resp;
  const wrapped = new ReadableStream({
    async start(controller) {
      const reader = body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
      // no-op: session persistence disabled
    }
  });

  // copy headers
  const headers: Record<string,string> = {};
  resp.headers.forEach((v,k) => headers[k]=v);
  return new Response(wrapped, { status: resp.status, headers });
}

function getDocumentGuidance(): { heading: string; actions: string } {
  return {
    heading: 'Нужно ещё немного информации, прежде чем формировать документ.',
    actions: '- Опишите цель процесса и роль регламента.\n- Перечислите участников, входы и выходы.\n- Пришлите файлы или текст с деталями, если они есть.',
  };
}

// Функция для формирования финального регламента
async function generateFinalRegulation(
  messages: any[], 
  systemPrompt: string,
  dataStream: any
) {
  const conversationContext = messages
    .map((msg) => {
      const text = msg.content || msg.parts?.find((p: any) => p.type === 'text')?.text || '';
      return `${msg.role}: ${text}`;
    })
    .join('\n');

  const directive = `Сформируй итоговый регламент на основе всей истории диалога ниже. Используй ТОЛЬКО подтверждённые факты из переписки. Никаких пояснений вне регламента. Если данных нет — пиши "*Информация не предоставлена в диалоге.*". Никаких кодовых блоков и тройных кавычек.

История диалога:
${conversationContext}`;

  const stream = await streamText({
    model,
    //system: systemPrompt,
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

    // удаляем возможные кодовые блоки, если модель всё же их добавила
    chunk = chunk.replace(/```markdown\s*/gi, '').replace(/```/g, '');
    if (!chunk) continue;

    // Буферизуем первую строку с заголовком, чтобы не было разрывов внутри слова
    if (!headingRemoved) {
      headingBuffer += chunk;
      const newlineIdx = headingBuffer.indexOf('\n');
      if (newlineIdx === -1) {
        continue; // ждём окончания строки с заголовком
      }

      const headingLine = headingBuffer.slice(0, newlineIdx);
      const restAfterHeading = headingBuffer.slice(newlineIdx + 1);

      if (!publishedFinalTitle) {
        const match = headingLine.match(/^#\s*(.+)$/);
        if (match) {
          finalTitle = match[1].trim() || finalTitle;
          dataStream.write({ type: 'data-title', data: finalTitle });
          publishedFinalTitle = true;
        }
      }

      chunk = restAfterHeading;
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
}