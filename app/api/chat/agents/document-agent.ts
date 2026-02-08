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

function stripHiddenTags(input: string): string {
  return String(input ?? '')
    .replace(/<AI-HIDDEN>/gi, '')
    .replace(/<\/AI-HIDDEN>/gi, '')
    .trim();
}

type ProtocolPerson = {
  name: string;
  role?: string;
};

type ProtocolQuestion = {
  question: string;
  answer?: string;
};

type ProtocolDecision = {
  decision: string;
  responsible?: string;
};

type ProtocolDraft = {
  protocolNumber?: string;
  meetingDate?: string;
  agenda?: string[];
  customerOrg?: string;
  customerParticipants?: ProtocolPerson[];
  executorOrg?: string;
  executorParticipants?: ProtocolPerson[];
  terms?: { term: string; definition: string }[];
  abbreviations?: { abbr: string; meaning: string }[];
  meetingContent?: string[];
  questions?: ProtocolQuestion[];
  decisions?: ProtocolDecision[];
  openQuestions?: string[];
  issues?: string[];
  approvals?: {
    executorOrg?: string;
    executorSigner?: string;
    customerOrg?: string;
    customerSigner?: string;
  };
};

function formatProtocolMarkdown(draft: ProtocolDraft): string {
  const number = (draft.protocolNumber || '').trim() || '—';
  const date = (draft.meetingDate || '').trim() || 'Не указано в расшифровке';

  const agenda = (draft.agenda || []).filter(Boolean);
  const agendaLines = agenda.length ? agenda : ['Не указано в расшифровке'];

  const customerOrg = (draft.customerOrg || '').trim() || 'Не указано в расшифровке';
  const executorOrg = (draft.executorOrg || '').trim() || 'Не указано в расшифровке';

  const customerParticipants = (draft.customerParticipants || []).filter((p) => p?.name?.trim());
  const executorParticipants = (draft.executorParticipants || []).filter((p) => p?.name?.trim());

  const terms = (draft.terms || []).filter((t) => t?.term?.trim() && t?.definition?.trim());
  const abbreviations = (draft.abbreviations || []).filter((t) => t?.abbr?.trim() && t?.meaning?.trim());

  const meetingContent = (draft.meetingContent || []).filter(Boolean);
  const questions = (draft.questions || []).filter((q) => q?.question?.trim());
  const decisions = (draft.decisions || []).filter((d) => d?.decision?.trim());
  const openQuestions = (draft.openQuestions || []).filter(Boolean);
  const issues = (draft.issues || []).filter(Boolean);

  const approvals = draft.approvals || {};
  const approvalExecutorOrg = (approvals.executorOrg || executorOrg).trim() || '—';
  const approvalExecutorSigner = (approvals.executorSigner || '').trim() || '—';
  const approvalCustomerOrg = (approvals.customerOrg || customerOrg).trim() || '—';
  const approvalCustomerSigner = (approvals.customerSigner || '').trim() || '—';

  const lines: string[] = [];
  lines.push(`ПРОТОКОЛ ОБСЛЕДОВАНИЯ №${number}`);
  lines.push('');
  lines.push('1.\tДата встречи: ' + date);
  lines.push('2.\tПовестка:');
  for (const item of agendaLines) {
    lines.push(`•\t${item}`);
  }
  lines.push('3.\tУчастники:');
  lines.push(`Со стороны Заказчика ${customerOrg}:`);
  lines.push('ФИО\tДолжность');
  if (customerParticipants.length === 0) {
    lines.push('Не указано\t—');
  } else {
    for (const person of customerParticipants) {
      lines.push(`${person.name}\t${person.role?.trim() || '—'}`);
    }
  }
  lines.push('');
  lines.push(`Со стороны Исполнителя ${executorOrg}:`);
  lines.push('ФИО\tДолжность/роль');
  if (executorParticipants.length === 0) {
    lines.push('Не указано\t—');
  } else {
    for (const person of executorParticipants) {
      lines.push(`${person.name}\t${person.role?.trim() || '—'}`);
    }
  }
  lines.push('');
  lines.push('4.\tТермины и определения:');
  if (terms.length === 0) {
    lines.push('•\tНе указано в расшифровке');
  } else {
    for (const term of terms) {
      lines.push(`•\t${term.term} – ${term.definition}`);
    }
  }
  lines.push('5.\tСокращения и обозначения:');
  if (abbreviations.length === 0) {
    lines.push('•\tНе указано в расшифровке');
  } else {
    for (const abbr of abbreviations) {
      lines.push(`•\t${abbr.abbr} – ${abbr.meaning}`);
    }
  }
  lines.push('6.\tСодержание встречи:');
  lines.push('В ходе встречи обсуждались следующие вопросы:');
  if (meetingContent.length === 0) {
    lines.push('Не указано в расшифровке');
  } else {
    for (const item of meetingContent) {
      lines.push(item);
    }
  }
  lines.push('');
  lines.push('7.\tВопросы:');
  if (questions.length === 0) {
    lines.push('Не указано в расшифровке');
    lines.push('');
    lines.push('Ответы:');
    lines.push('Не указано в расшифровке');
  } else {
    questions.forEach((q, idx) => {
      lines.push(`${idx + 1}.\t${q.question}`);
    });
    lines.push('');
    lines.push('Ответы:');
    questions.forEach((q, idx) => {
      lines.push(`${idx + 1}.\t${q.answer?.trim() || 'Ответ не указан в расшифровке'}`);
    });
  }
  lines.push('');
  lines.push('8.\tРешения:');
  if (decisions.length === 0) {
    lines.push('Не указано в расшифровке');
  } else {
    decisions.forEach((d, idx) => {
      lines.push(`${idx + 1}.\t${d.decision}`);
      lines.push(`Ответственный: ${d.responsible?.trim() || 'не указан'}.`);
    });
  }
  lines.push('');
  lines.push('9.\tОткрытые вопросы:');
  const openItems = [...openQuestions, ...issues.map((i) => `Противоречие/недосказанность: ${i}`)].filter(Boolean);
  if (openItems.length === 0) {
    lines.push('Не указано в расшифровке');
  } else {
    openItems.forEach((item, idx) => {
      lines.push(`${idx + 1}.\t${item}`);
    });
  }
  lines.push('');
  lines.push('10.\tСогласовано:');
  lines.push('');
  lines.push('Со стороны Исполнителя:\tСо стороны Заказчика:');
  lines.push(`${approvalExecutorOrg}:\t${approvalCustomerOrg}`);
  lines.push('');
  lines.push(`${approvalExecutorSigner} /______________\t${approvalCustomerSigner} /______________`);
  return lines.join('\n');
}

async function streamDocumentContent(dataStream: any, content: string) {
  const text = String(content || '');
  if (!text) return;

  const chunkSize = 1200;
  for (let i = 0; i < text.length; i += chunkSize) {
    const chunk = text.slice(i, i + chunkSize);
    dataStream.write({ type: 'data-documentDelta', data: chunk });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function collectMissingProtocolFields(draft: ProtocolDraft): string[] {
  const missing: string[] = [];
  if (!draft.meetingDate || !draft.meetingDate.trim()) missing.push('Дата встречи');
  if (!draft.agenda || draft.agenda.filter(Boolean).length === 0) missing.push('Повестка');
  if (!draft.customerParticipants || draft.customerParticipants.filter((p) => p?.name?.trim()).length === 0) {
    missing.push('Участники со стороны Заказчика');
  }
  if (!draft.executorParticipants || draft.executorParticipants.filter((p) => p?.name?.trim()).length === 0) {
    missing.push('Участники со стороны Исполнителя');
  }
  return missing;
}

export async function runDocumentAgent(context: AgentContext) {
  const { messages, uiMessages, model, userPrompt, documentContent, userId, conversationId } = context;
  let generatedDocumentContent = '';

  const safeOriginalUIMessages = (() => {
    if (Array.isArray(uiMessages) && uiMessages.length > 0) return uiMessages as any;
    // Minimal fallback shape expected by `createUIMessageStream`.
    return (Array.isArray(messages) ? messages : []).map((m: any, idx: number) => {
      const text = typeof m?.content === 'string' ? m.content : '';
      return {
        id: String(m?.id ?? `m-${idx}-${Date.now()}`),
        role: m?.role === 'assistant' ? 'assistant' : 'user',
        parts: [{ type: 'text', text }],
        metadata: m?.metadata ?? {},
      };
    });
  })();

  const stream = createUIMessageStream({
    originalMessages: safeOriginalUIMessages,
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
  // `createUIMessageStream` expects stream parts that match its schema.
  // Custom parts must have `type` starting with `data-` and a `data` field.
  const writeData = (payload: { type: string; data: any }) => {
    dataStream.write({ type: payload.type, data: payload.data });
  };

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

  const conversationContext = (messages || [])
    .map((msg) => {
      const text = extractMessageText(msg);
      return text ? `${msg.role}: ${text}` : '';
    })
    .filter(Boolean)
    .join('\n');

  console.log('🩹 Document edit detection:', {
    hasExisting,
    lastUser: (lastUserTextRaw || '').slice(0, 120),
    isConfirmation: isConfirmation(lastUserTextRaw),
    effectiveEdit: (effectiveEditText || '').slice(0, 120),
    patchMode: hasExisting && isEditRequest(effectiveEditText),
  });

  const transcriptSource = stripHiddenTags([
    lastUserTextRaw,
    conversationContext || '',
  ].filter(Boolean).join('\n\n'));

  const protocolSchema = z.object({
    protocolNumber: z.string().optional(),
    meetingDate: z.string().optional(),
    agenda: z.array(z.string()).optional(),
    customerOrg: z.string().optional(),
    customerParticipants: z
      .array(z.object({ name: z.string(), role: z.string().optional() }))
      .optional(),
    executorOrg: z.string().optional(),
    executorParticipants: z
      .array(z.object({ name: z.string(), role: z.string().optional() }))
      .optional(),
    terms: z.array(z.object({ term: z.string(), definition: z.string() })).optional(),
    abbreviations: z.array(z.object({ abbr: z.string(), meaning: z.string() })).optional(),
    meetingContent: z.array(z.string()).optional(),
    questions: z.array(z.object({ question: z.string(), answer: z.string().optional() })).optional(),
    decisions: z
      .array(z.object({ decision: z.string(), responsible: z.string().optional() }))
      .optional(),
    openQuestions: z.array(z.string()).optional(),
    issues: z.array(z.string()).optional(),
    approvals: z
      .object({
        executorOrg: z.string().optional(),
        executorSigner: z.string().optional(),
        customerOrg: z.string().optional(),
        customerSigner: z.string().optional(),
      })
      .optional(),
  });

  const protocolPrompt = `Ты формируешь ТОЛЬКО «ПРОТОКОЛ ОБСЛЕДОВАНИЯ» по расшифровке встречи.

ОГРАНИЧЕНИЯ:
- Не придумывай факты. Используй только данные из расшифровки.
- Если данных нет, оставляй поле пустым или кратко "Не указано в расшифровке".
- Выяви противоречия/недосказанности и запиши их в поле "issues".
- Структура должна соответствовать протоколу обследования (разделы 1–10 как в примере).

ФОРМАТ ВЫВОДА: верни только JSON по схеме, без Markdown, без пояснений.

Расшифровка встречи:
"""
${transcriptSource || 'Не указано в расшифровке'}
"""`;

  const { object: protocolDraft } = await generateObject({
    model,
    temperature: 0,
    schema: protocolSchema,
    prompt: protocolPrompt,
  });

  const missingFields = collectMissingProtocolFields(protocolDraft as ProtocolDraft);
  if (missingFields.length > 0) {
    const clarifyId = `clarify-${crypto.randomUUID()}`;
    dataStream.write({ type: 'text-start', id: clarifyId });
    dataStream.write({
      type: 'text-delta',
      id: clarifyId,
      delta:
        'Перед формированием протокола нужно уточнить:\n' +
        missingFields.map((f, i) => `${i + 1}. ${f}`).join('\n') +
        '\n\nОтветьте, пожалуйста, чтобы я заполнил эти разделы протокола.',
    });
    dataStream.write({ type: 'text-end', id: clarifyId });
    return existingDocument || '';
  }

  const finalDoc = formatProtocolMarkdown(protocolDraft as ProtocolDraft);

  writeData({ type: 'data-clear', data: null });
  writeData({ type: 'data-title', data: 'Протокол обследования' });
  const progressId = `protocol-${crypto.randomUUID()}`;
  dataStream.write({ type: 'text-start', id: progressId });
  dataStream.write({
    type: 'text-delta',
    id: progressId,
    delta: '📄 Формирую протокол обследования.\n\n',
  });

  await streamDocumentContent(dataStream, finalDoc);
  writeData({ type: 'data-finish', data: null });
  dataStream.write({
    type: 'text-delta',
    id: progressId,
    delta: '\n\n✅ Протокол обследования сформирован.',
  });
  dataStream.write({ type: 'text-end', id: progressId });

  return finalDoc;
}
