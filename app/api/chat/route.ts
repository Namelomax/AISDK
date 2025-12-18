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

const model = openrouter.chat('nvidia/nemotron-3-nano-30b-a3b:free');


let cachedPrompt: string | null = null;

function buildSystemPrompt(userPrompt: string, hiddenDocsContext?: string): string {
  const trimmed = (userPrompt ?? '').trim();
  const base = trimmed || 'Ты — ассистент. Пользовательский системный промт не задан: уточни вводные и следуй дальнейшим указаниям пользователя.';
  if (!hiddenDocsContext) return base;

  return `${base}

===== ВЛОЖЕНИЯ ПОЛЬЗОВАТЕЛЯ =====
${hiddenDocsContext}

Используй факты из этих материалов в ответах. Если информация из вложений противоречит предположениям модели, приоритет всегда за документами. Ссылайся на документ по названию или номеру и не игнорируй эту секцию.
===== КОНЕЦ ВЛОЖЕНИЙ =====`;
}

async function resolveSystemPrompt(userId?: string | null, selectedPromptId?: string | null): Promise<string> {
  // 1. Try explicit prompt ID from client (for anon or override)
  if (selectedPromptId) {
    try {
      const prompt = await getPromptById(selectedPromptId);
      if (prompt?.content) return prompt.content;
      console.warn('Selected prompt not found or empty:', selectedPromptId);
    } catch (error) {
      console.error('Failed to load selected prompt:', error);
    }
  }

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

function isExplicitRegulationRequest(text?: string | null): boolean {
  if (!text) return false;
  const normalized = text.toLowerCase();
  const keywords = [
    'сформируй регламент',
    'создай регламент',
    'подготовь регламент',
    'финальный регламент',
    'итоговый регламент',
    'сделай регламент',
    'построй регламент',
    'регламент готов',
    'сформировать регламент',
    'финальную версию регламента',
    'заверши регламент',
    'сформируем регламент',
    'составим регламент',
    'напишем регламент',
    'давай регламент',
    'пора формировать регламент',
  ];

  if (keywords.some((phrase) => normalized.includes(phrase))) {
    return true;
  }

  const regexes = [
    /(сформиру(й|йте|ем|ть).*(финал|регламент))/i,
    /(подготов(ь|ьте|им|ить).*(регламент|финал))/i,
    /(созда(й|йте|дим|ть).*(регламент))/i,
    /(состав(ь|ьте|им|ить).*(регламент))/i,
    /(давай.*(сформируем|составим|напишем|сделаем).*(регламент))/i,
  ];

  return regexes.some((re) => re.test(text));
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

async function extractDocxTextFromAttachment(att: any): Promise<string | null> {
  if (!att || att.mediaType !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return null;
  const buf = dataUrlToBuffer(att.url || att.data);
  if (!buf) return null;
  try {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer: buf });
    return result.value.trim() || null;
  } catch (error) {
    console.error('Failed to parse DOCX attachment:', error);
    return null;
  }
}

async function extractXlsxTextFromAttachment(att: any): Promise<string | null> {
  if (!att || att.mediaType !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return null;
  const buf = dataUrlToBuffer(att.url || att.data);
  if (!buf) return null;
  try {
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(buf, { type: 'buffer' });
    let text = '';
    workbook.SheetNames.forEach(sheetName => {
      const sheet = workbook.Sheets[sheetName];
      text += `Sheet: ${sheetName}\n`;
      text += XLSX.utils.sheet_to_txt(sheet);
      text += '\n\n';
    });
    return text.trim() || null;
  } catch (error) {
    console.error('Failed to parse XLSX attachment:', error);
    return null;
  }
}

async function extractPptxTextFromAttachment(att: any): Promise<string | null> {
  if (!att || att.mediaType !== 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return null;
  const buf = dataUrlToBuffer(att.url || att.data);
  if (!buf) return null;
  try {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buf);
    const slideFiles = Object.keys(zip.files).filter(name => name.match(/^ppt\/slides\/slide\d+\.xml$/));
    
    // Sort slides by number
    slideFiles.sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)\.xml$/)?.[1] || '0');
      const numB = parseInt(b.match(/slide(\d+)\.xml$/)?.[1] || '0');
      return numA - numB;
    });

    let text = '';
    for (const fileName of slideFiles) {
      const content = await zip.file(fileName)?.async('string');
      if (content) {
        // Simple regex to extract text from <a:t> tags
        const slideText = content.match(/<a:t>(.*?)<\/a:t>/g)
          ?.map(t => t.replace(/<\/?a:t>/g, ''))
          .join(' ') || '';
        if (slideText.trim()) {
          text += `Slide ${fileName.match(/slide(\d+)\.xml$/)?.[1]}:\n${slideText}\n\n`;
        }
      }
    }
    return text.trim() || null;
  } catch (error) {
    console.error('Failed to parse PPTX attachment:', error);
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
  let { messages, newSystemPrompt, userId, selectedPromptId, documentContent } = body as any;
  let conversationId: string | null = null;
  try {
    const url = new URL(req.url);
    conversationId = body.conversationId || url.searchParams.get('conversationId');
    if (!selectedPromptId) selectedPromptId = url.searchParams.get('selectedPromptId');
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
    const docxs = atts.filter((a) => a?.mediaType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const xlsxs = atts.filter((a) => a?.mediaType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const pptxs = atts.filter((a) => a?.mediaType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation');

    if (!pdfs.length && !docxs.length && !xlsxs.length && !pptxs.length) continue;

    const pdfTexts = await Promise.all(pdfs.map(extractPdfTextFromAttachment));
    const docxTexts = await Promise.all(docxs.map(extractDocxTextFromAttachment));
    const xlsxTexts = await Promise.all(xlsxs.map(extractXlsxTextFromAttachment));
    const pptxTexts = await Promise.all(pptxs.map(extractPptxTextFromAttachment));

    const allTexts = [
      ...pdfTexts,
      ...docxTexts,
      ...xlsxTexts,
      ...pptxTexts
    ].filter((t): t is string => Boolean(t && t.trim()));

    if (allTexts.length) {
      msg.metadata = {
        ...(msg.metadata || {}),
        attachments: atts,
        hiddenTexts: [...(msg.metadata?.hiddenTexts || []), ...allTexts],
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

  const userPrompt = await resolveSystemPrompt(userId, selectedPromptId);
  console.log('Resolved user prompt:', userPrompt ? userPrompt.slice(0, 50) : 'null', 'for userId:', userId, 'selectedPromptId:', selectedPromptId);

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
  const hiddenDocEntries: string[] = [];
  (normalizedMessages as UIMessage[]).forEach((msg) => {
    const hiddenTexts: string[] = Array.isArray((msg as any)?.metadata?.hiddenTexts)
      ? (msg as any).metadata.hiddenTexts
      : [];
    const attachmentsMeta: any[] = Array.isArray((msg as any)?.metadata?.attachments)
      ? (msg as any).metadata.attachments
      : [];

    hiddenTexts.forEach((hidden, idx) => {
      const cleaned = String(hidden ?? '').trim();
      if (!cleaned) return;
      const attName = attachmentsMeta[idx]?.name || attachmentsMeta[idx]?.filename;
      const label = attName
        ? `Документ "${attName}"`
        : `Документ ${hiddenDocEntries.length + 1}`;
      const snippet = cleaned.length > 1200 ? `${cleaned.slice(0, 1200)} …` : cleaned;
      hiddenDocEntries.push(`${label}:\n${snippet}`);

      messagesWithHidden.push({
        id: `${msg.id}-hidden-${idx}`,
        role: 'system',
        parts: [{ type: 'text' as const, text: `Скрытый контент из вложений пользователя:\n${cleaned}` }],
      } as UIMessage);
    });

    messagesWithHidden.push(msg);
  });

  const hiddenDocsContext = hiddenDocEntries.length
    ? hiddenDocEntries.join('\n\n').slice(0, MAX_DOC_CONTEXT_CHARS)
    : '';

  const systemPrompt = buildSystemPrompt(userPrompt, hiddenDocsContext);

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
            void mod.updateConversation(convId, msgsToSave, documentContent);
          } catch (e) {
            console.error('Failed to update conversation:', e);
          }
        } else {
          try {
            const mod = await import('@/lib/getPromt');
            const created = await mod.saveConversation(userId, msgsToSave, documentContent);
            conversationId = created.id; // Capture the new ID
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
  let intentType: 'chat' | 'generate_regulation' = 'chat';
  
  // Context for intent classification (last 6 messages)
  const intentContext = normalizedMessages
    .slice(-6)
    .map((msg) => `${msg.role}: ${msg.content}`)
    .join('\n');

  try {
    const { object: intentObj } = await (await import('ai')).generateObject({
      model,
      schema: z.object({
        type: z.enum(['chat', 'generate_regulation']),
      }),
      system: `
Ты — умный классификатор намерений в диалоге. Твоя задача — определить следующий шаг: "chat" (общение, сбор информации, анализ) или "generate_regulation" (формирование финального документа).

Текущая задача ассистента (из системного промта):
"""
${userPrompt || 'Нет специфической задачи'}
"""

Инструкции:
1. "generate_regulation" выбирай ТОЛЬКО если:
   - Пользователь ЯВНО просит "сформировать", "создать", "написать" итоговый регламент/документ.
   - Агент в предыдущем сообщении предложил сформировать документ, и пользователь согласился ("да", "давай", "хорошо").
2. Во всех остальных случаях выбирай "chat".
   - Если пользователь загрузил файлы и просит их проанализировать -> "chat".
   - Если пользователь задает вопросы -> "chat".
   - Если идет обсуждение деталей -> "chat".

Будь консервативен. Если есть сомнения — выбирай "chat".
`,
      prompt: `
Контекст диалога (последние сообщения):
"""
${intentContext}
"""

Последнее сообщение пользователя:
"""
${lastText}
"""

Верни ТОЛЬКО JSON формата {"type":"<одно из значений>"}.
`,
    });
    intentType = intentObj.type;
  } catch (err) {
    console.error('Intent classification failed, defaulting to chat:', err);
  }

  const intent = { type: intentType };
  
  // Removed explicit blocking logic to allow smart detection
  // const explicitRegulationRequest = isExplicitRegulationRequest(lastText);
  // if (intent.type === 'generate_regulation' && !explicitRegulationRequest) { ... }

  // Removed document intent logic that forced "insufficient data" message
  // let systemAddendum = '';
  // if (intent.type === 'document') { ... }

  const effectiveSystemPrompt = systemPrompt;

  console.log('System prompt applied:', {
    userId: userId || 'anon',
    length: effectiveSystemPrompt.length,
    preview: effectiveSystemPrompt.slice(0, 160),
  });

  console.log('Detected intent:', intent.type);

  // === Роутинг по агентам ===
  if (intent.type === 'generate_regulation') {
    const stream = createUIMessageStream({
      originalMessages: normalizedMessages,
      execute: async ({ writer }) => {
        try {
          await generateFinalRegulation(normalizedMessages, userPrompt, writer, documentContent, { userId, conversationId });
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

  // if (intent.type === 'search') { ... } removed

  // Основной диалог
  const stream = streamText({
    model,
    temperature: 0.3,
    tools: baseTools,
    messages: convertToModelMessages(extendedMessages),
    system: effectiveSystemPrompt,
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
  userPrompt: string | null,
  dataStream: any,
  existingDocument?: string,
  saveContext?: { userId?: string, conversationId?: string | null }
) {
  const conversationContext = messages
    .map((msg) => {
      const text = msg.content || msg.parts?.find((p: any) => p.type === 'text')?.text || '';
      return `${msg.role}: ${text}`;
    })
    .join('\n');

  let directive = `Сформируй итоговый регламент на основе всей истории диалога ниже. 
Первой строкой напиши заголовок документа, начиная с символа # (например: "# Регламент проведения...").
Используй ТОЛЬКО подтверждённые факты из переписки. 
Пиши СТРОГО на русском языке. Избегай иностранных слов (например, используй "Организатор" вместо "Organisateur").
Никаких пояснений вне регламента. 
Если данных нет — пиши "*Информация не предоставлена в диалоге.*". 
Никаких кодовых блоков и тройных кавычек.`;

  if (userPrompt) {
    directive += `\n\nВАЖНО: При формировании документа следуй структуре и требованиям, заданным в пользовательском промте (если они там есть):
"""
${userPrompt}
"""`;
  }

  if (existingDocument && existingDocument.trim().length > 20) {
    directive += `\n\nТЕКУЩАЯ ВЕРСИЯ ДОКУМЕНТА (которую нужно исправить/дополнить):
"""
${existingDocument}
"""
ВНИМАНИЕ: Пользователь хочет внести изменения в этот документ. Верни ПОЛНЫЙ обновленный текст документа, а не только исправленную часть.
`;
  }

  directive += `\n\nИстория диалога:
${conversationContext}`;

  const stream = await streamText({
    model,
    temperature: 0.3,
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
        // Пытаемся найти заголовок: # Заголовок или **Заголовок**
        let titleMatch = headingLine.match(/^#\s*(.+)$/);
        if (!titleMatch) {
          const boldMatch = headingLine.match(/^\*\*(.+)\*\*$/);
          if (boldMatch) titleMatch = boldMatch;
        }

        if (titleMatch) {
          finalTitle = titleMatch[1].trim() || finalTitle;
          dataStream.write({ type: 'data-title', data: finalTitle });
          publishedFinalTitle = true;
          chunk = restAfterHeading; // Заголовок уходит в мету, из текста убираем
        } else {
          // Если первая строка не похожа на заголовок, оставляем её в тексте
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

  // Save the generated document content
  if (saveContext?.conversationId) {
    try {
      const mod = await import('@/lib/getPromt');
      // We only update the document content here, messages are updated in onFinish
      // But wait, onFinish runs AFTER this execute function finishes?
      // Yes. But onFinish receives `messages` which are the chat messages.
      // It does NOT receive the document content.
      // So we must save document content here.
      // However, updateConversation expects messages. We can pass the current messages.
      await mod.updateConversation(saveContext.conversationId, messages, fullContent);
    } catch (e) {
      console.error('Failed to save generated document:', e);
    }
  }
}