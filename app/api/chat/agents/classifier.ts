import type { AgentContext } from './types';

export type IntentType = 'chat' | 'document';

function looksLikeExplicitDocumentCommand(text: string): boolean {
  const t = (text || '').toLowerCase();
  if (!t) return false;

  const editVerb =
    t.includes('измени') ||
    t.includes('передел') ||
    t.includes('отредакт') ||
    t.includes('поправ') ||
    t.includes('замени') ||
    t.includes('добав') ||
    t.includes('убер') ||
    t.includes('удали') ||
    t.includes('исключ') ||
    t.includes('внеси') ||
    t.includes('дополни');

  const docTargetHint =
    t.includes('в документ') ||
    t.includes('в регламент') ||
    t.includes('пункт') ||
    t.includes('раздел') ||
    t.includes('регламент') ||
    t.includes('документ');

  const genVerb =
    t.includes('сформируй') ||
    t.includes('сформировать') ||
    t.includes('составь') ||
    t.includes('составить') ||
    t.includes('сгенерируй') ||
    t.includes('сгенерировать') ||
    t.includes('подготовь') ||
    t.includes('подготовить') ||
    t.includes('оформи') ||
    t.includes('оформить') ||
    t.includes('сделай') ||
    t.includes('сделать') ||
    t.includes('выведи') ||
    t.includes('покажи') ||
    t.includes('дай');

  const docNoun =
    t.includes('протокол') ||
    t.includes('регламент') ||
    t.includes('документ') ||
    t.includes('инструкц') ||
    t.includes('положение') ||
    t.includes('политик') ||
    t.includes('итогов') ||
    t.includes('финальн');

  return (editVerb && docTargetHint) || (genVerb && docNoun);
}

function stripAttachmentNoise(text: string): string {
  if (!text) return '';
  return String(text)
    // Our server-side file injection blocks
    .replace(/\n---\nВложенный файл:[\s\S]*?\n---/g, '')
    // Hidden tags (if any)
    .replace(/<AI-HIDDEN>[\s\S]*?<\/AI-HIDDEN>/gi, '')
    .trim();
}

function contentToText(content: any): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    // CoreMessage content can be an array of parts.
    return content
      .map((p: any) => {
        if (!p) return '';
        if (typeof p === 'string') return p;
        if (typeof p?.text === 'string') return p.text;
        if (typeof p?.content === 'string') return p.content;
        return '';
      })
      .filter(Boolean)
      .join(' ');
  }
  if (typeof content === 'object') {
    if (typeof (content as any).text === 'string') return (content as any).text;
    if (typeof (content as any).content === 'string') return (content as any).content;
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }
  return String(content);
}

function uiMessageText(msg: any): string {
  if (!msg) return '';
  if (Array.isArray(msg?.parts)) {
    const t = msg.parts.find((p: any) => p?.type === 'text' && typeof p.text === 'string')?.text;
    if (t) return String(t);
  }
  if (typeof msg?.content === 'string') return msg.content;
  if (typeof msg?.text === 'string') return msg.text;
  return '';
}

function getLastAssistantText(context: AgentContext): string {
  const uiMessages: any[] = Array.isArray((context as any).uiMessages) ? ((context as any).uiMessages as any[]) : [];
  if (uiMessages.length > 0) {
    const lastUiAssistant = [...uiMessages].reverse().find((m) => m?.role === 'assistant');
    return stripAttachmentNoise(uiMessageText(lastUiAssistant));
  }

  const msgs: any[] = Array.isArray((context as any).messages) ? ((context as any).messages as any[]) : [];
  const lastAssistant = [...msgs].reverse().find((m) => m?.role === 'assistant');
  const raw = contentToText(lastAssistant?.content);
  return stripAttachmentNoise(raw);
}

function uiMessageHasAttachments(msg: any): boolean {
  if (!msg) return false;
  if (Array.isArray(msg?.parts) && msg.parts.some((p: any) => p?.type === 'file')) return true;
  if (Array.isArray(msg?.metadata?.attachments) && msg.metadata.attachments.length > 0) return true;
  return false;
}

function getLastUserTextForIntent(context: AgentContext): { text: string; isUpload: boolean } {
  const uiMessages: any[] = Array.isArray((context as any).uiMessages) ? ((context as any).uiMessages as any[]) : [];
  if (uiMessages.length > 0) {
    const lastUiUser = [...uiMessages].reverse().find((m) => m?.role === 'user');
    const text = stripAttachmentNoise(uiMessageText(lastUiUser));
    const isUpload = uiMessageHasAttachments(lastUiUser) && !text.trim();
    return { text, isUpload };
  }

  const msgs: any[] = Array.isArray((context as any).messages) ? ((context as any).messages as any[]) : [];
  const last = msgs[msgs.length - 1];
  const raw = contentToText(last?.content);
  const text = stripAttachmentNoise(raw);
  return { text, isUpload: false };
}

export async function classifyIntent(context: AgentContext): Promise<IntentType> {
  const { text: lastUserText, isUpload } = getLastUserTextForIntent(context);
  const lastAssistantText = getLastAssistantText(context);

  if (isUpload) {
    console.log('🤖 Intent classification: upload-only -> chat');
    return 'chat';
  }

  if (looksLikeExplicitDocumentCommand(lastUserText)) {
    console.log('🤖 Intent classification: explicit protocol command -> document');
    return 'document';
  }

  if (lastAssistantText) {
    const t = lastAssistantText.toLowerCase();
    const askedForClarification =
      t.includes('перед формированием протокола нужно уточнить') ||
      t.includes('ответьте, пожалуйста') ||
      t.includes('уточнить') ||
      t.includes('нужно уточнить');
    if (askedForClarification) {
      console.log('🤖 Intent classification: follow-up to clarification -> document');
      return 'document';
    }
  }

  console.log('🤖 Intent classification: default -> chat');
  return 'chat';
}