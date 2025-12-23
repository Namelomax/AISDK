import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { 
  convertToModelMessages, 
} from 'ai';
import { getPrompt, updatePrompt, createPromptForUser, getUserSelectedPrompt, getPromptById, saveConversation, updateConversation } from '@/lib/getPromt';
import { classifyIntent } from './agents/classifier';
import { runChatAgent } from './agents/chat-agent';
import { runRegulationAgent } from './agents/regulation-agent';
import { AgentContext } from './agents/types';

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

// === HELPER FUNCTIONS ===

function buildSystemPrompt(userPrompt: string, hiddenDocsContext?: string): string {
  const trimmed = (userPrompt ?? '').trim();
  const base = trimmed || 'Ты — полезный AI-ассистент. Твоя задача — помогать пользователю, отвечая на вопросы и выполняя инструкции.';
  
  if (!hiddenDocsContext) return base;

  return `${base}

===== ВЛОЖЕНИЯ ПОЛЬЗОВАТЕЛЯ (КОНТЕКСТ) =====
${hiddenDocsContext}

ИНСТРУКЦИЯ ПО РАБОТЕ С ВЛОЖЕНИЯМИ:
1. Это справочные материалы. НЕ делай их краткий пересказ (summary), если пользователь об этом явно не попросил.
2. Используй информацию из них только для ответов на конкретные вопросы или выполнения задач пользователя.
3. Если пользователь не задал вопрос, просто подтверди получение файлов и скажи, что готов работать с ними согласно твоей основной инструкции.
===== КОНЕЦ ВЛОЖЕНИЙ =====`;
}

async function resolveSystemPrompt(userId?: string | null, selectedPromptId?: string | null): Promise<string> {
  if (selectedPromptId) {
    try {
      const prompt = await getPromptById(selectedPromptId);
      if (prompt?.content) return prompt.content;
    } catch (error) {
      console.error('Failed to load selected prompt:', error);
    }
  }

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

  if (!cachedPrompt) cachedPrompt = await getPrompt();
  return cachedPrompt;
}

// === FILE PARSING UTILS ===
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
    return parsed?.text?.trim() || null;
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
    
    slideFiles.sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)\.xml$/)?.[1] || '0');
      const numB = parseInt(b.match(/slide(\d+)\.xml$/)?.[1] || '0');
      return numA - numB;
    });

    let text = '';
    for (const fileName of slideFiles) {
      const content = await zip.file(fileName)?.async('string');
      if (content) {
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

// === MAIN HANDLER ===

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  let { messages, newSystemPrompt, userId, selectedPromptId, documentContent } = body as any;
  let conversationId: string | null = null;

  try {
    const url = new URL(req.url);
    conversationId = body.conversationId || url.searchParams.get('conversationId');
    if (!selectedPromptId) selectedPromptId = url.searchParams.get('selectedPromptId');
    const qp = url.searchParams.get('userId');
    if (!userId && qp) userId = qp;
  } catch {}

  if (!Array.isArray(messages)) {
    console.log('⚠️ Messages is not an array, defaulting to empty:', typeof messages);
    messages = [];
  }

  console.log('📨 Request info:', {
    messagesCount: messages.length,
    userId: userId || 'anon',
    conversationId: conversationId || 'none',
    hasDocumentContent: !!documentContent,
  });

  // 1. Handle System Prompt Updates
  if (newSystemPrompt) {
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

  // 2. Normalize Messages & Extract Attachments
  const toPlainText = (msg: any): string => {
    if (Array.isArray(msg.parts)) {
      const textPart = msg.parts.find((p: any) => p?.type === 'text' && typeof p.text === 'string');
      if (textPart?.text) return String(textPart.text);
    }
    if (typeof msg.content === 'string') return msg.content;
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

  console.log('📝 Base messages prepared:', baseMessages.length);

  const normalizedMessages: any[] = baseMessages.map((m: any) => {
    const rawText = toPlainText(m);
    const hiddenMatches = rawText.match(HIDDEN_CAPTURE_RE) || [];
    const hiddenTexts = hiddenMatches
      .map((segment) => segment.replace(/<AI-HIDDEN>/gi, '').replace(/<\/AI-HIDDEN>/gi, '').trim())
      .filter(Boolean);

    const visibleText = rawText.replace(HIDDEN_RE, '').trim();
    const fileParts = Array.isArray(m?.parts) ? m.parts.filter((p: any) => p?.type === 'file') : [];
    
    const attachmentsFromParts = fileParts.map((file: any) => {
        const url = file?.url || file?.data || '';
        if (!url) return null;
        return {
          id: file.id || crypto.randomUUID(),
          name: file.filename || 'attachment',
          url,
          mediaType: file.mediaType || file.mimeType,
        };
      }).filter(Boolean);

    const attachmentsFromMeta = Array.isArray(m?.metadata?.attachments)
      ? m.metadata.attachments
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
      id: m.id || crypto.randomUUID(),
      role: ['assistant', 'user', 'system', 'tool'].includes(m.role) ? m.role : 'user',
      content: combined,
      parts: [{ type: 'text' as const, text: combined }],
      metadata: { ...(m.metadata || {}), attachments, hiddenTexts },
    };
  });

  console.log('✅ Normalized messages:', normalizedMessages.length);

  // 3. Process Attachments (PDF/DOCX/etc)
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

    const allTexts = [...pdfTexts, ...docxTexts, ...xlsxTexts, ...pptxTexts].filter((t): t is string => Boolean(t && t.trim()));

    if (allTexts.length) {
      msg.metadata = {
        ...(msg.metadata || {}),
        attachments: atts,
        hiddenTexts: [...(msg.metadata?.hiddenTexts || []), ...allTexts],
      };
    }
  }

  // 4. Prepare Context for Agents
  const userPrompt = await resolveSystemPrompt(userId, selectedPromptId);
  
  // Prepare hidden docs context and enrich messages with file content
  const hiddenDocEntries: string[] = [];
  const messagesWithHidden: any[] = [];
  
  normalizedMessages.forEach((msg) => {
    const hiddenTexts: string[] = Array.isArray((msg as any)?.metadata?.hiddenTexts)
      ? (msg as any).metadata.hiddenTexts
      : [];
    const attachmentsMeta: any[] = Array.isArray((msg as any)?.metadata?.attachments)
      ? (msg as any).metadata.attachments
      : [];

    // Build file content summary for context
    const fileContents: string[] = [];
    hiddenTexts.forEach((hidden, idx) => {
      const cleaned = String(hidden ?? '').trim();
      if (!cleaned) return;
      const attName = attachmentsMeta[idx]?.name || attachmentsMeta[idx]?.filename;
      const label = attName ? `Документ "${attName}"` : `Документ ${hiddenDocEntries.length + 1}`;
      const snippet = cleaned.length > 1200 ? `${cleaned.slice(0, 1200)} …` : cleaned;
      hiddenDocEntries.push(`${label}:\n${snippet}`);
      
      // Add full content to this message
      fileContents.push(`\n\n---\nВложенный файл: ${attName || 'документ'}\n${cleaned}\n---`);
    });
    
    // If message has file attachments, append their content to the message
    if (fileContents.length > 0) {
      const enrichedContent = `${msg.content}${fileContents.join('')}`;
      messagesWithHidden.push({
        ...msg,
        content: enrichedContent,
        parts: [{ type: 'text' as const, text: enrichedContent }],
      });
    } else {
      messagesWithHidden.push(msg);
    }
  });

  const hiddenDocsContext = hiddenDocEntries.length
    ? hiddenDocEntries.join('\n\n').slice(0, 4000)
    : '';

  const systemPrompt = buildSystemPrompt(userPrompt, hiddenDocsContext);

  console.log('📦 Messages prepared:', {
    messagesWithHidden: messagesWithHidden.length,
    normalizedMessages: normalizedMessages.length,
    hiddenDocEntries: hiddenDocEntries.length,
  });

  // 5. Create Agent Context - with safety checks
  let coreMessages;
  try {
    const messagesToConvert = messagesWithHidden.length > 0 ? messagesWithHidden : normalizedMessages;
    console.log('🔄 Converting messages:', messagesToConvert.length);
    
    if (!Array.isArray(messagesToConvert) || messagesToConvert.length === 0) {
      throw new Error('No valid messages to convert');
    }
    
    coreMessages = convertToModelMessages(messagesToConvert);
    console.log('✅ Messages converted successfully');
  } catch (error) {
    console.error('❌ Failed to convert messages:', error);
    console.error('Messages data:', JSON.stringify({ messagesWithHidden, normalizedMessages }, null, 2));
    // Fallback: try to preserve at least the last user message
    const lastMessage = normalizedMessages[normalizedMessages.length - 1];
    coreMessages = lastMessage ? [{
      role: lastMessage.role as 'user' | 'assistant',
      content: typeof lastMessage.content === 'string' ? lastMessage.content : 'Hello',
    }] : [{
      role: 'user' as const,
      content: 'Hello',
    }];
  }

  const agentContext: AgentContext = {
    messages: coreMessages,
    userPrompt: userPrompt,
    userId,
    conversationId,
    documentContent,
    model,
  };

  // 6. Classify Intent
  const intent = await classifyIntent(agentContext);

  // 7. Route to Agent
  if (intent === 'generate_regulation') {
    return runRegulationAgent(agentContext);
  } else {
    return runChatAgent(agentContext, systemPrompt);
  }
}
