import { AgentContext } from './types';
import { IntentType } from './classifier';

export interface OrchestratorDecision {
  route: IntentType;
  reason: string;
}

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
    } catch {
      return String(msg.content);
    }
  }
  return '';
}

function stripEmbeddedAttachments(text: string): string {
  if (!text) return '';
  // Server injects extracted file text into the message like:
  // ---\nВложенный файл: NAME\n...\n---
  return String(text)
    .replace(/\n---\nВложенный файл:[\s\S]*?\n---/g, '')
    .replace(/<AI-HIDDEN>[\s\S]*?<\/AI-HIDDEN>/gi, '')
    .trim();
}

function looksLikeAttachmentReadRequest(text: string): boolean {
  const t = (text || '').toLowerCase();
  if (!t) return false;

  const hasReadVerb =
    t.includes('прочитай') ||
    t.includes('прочесть') ||
    t.includes('посмотри') ||
    t.includes('ознаком') ||
    t.includes('изучи') ||
    t.includes('проанализ') ||
    t.includes('что в') ||
    t.includes('о чем') ||
    t.includes('о чём') ||
    t.includes('опиши') ||
    t.includes('перескажи') ||
    t.includes('кратко') ||
    t.includes('суммари') ||
    t.includes('summary');

  const mentionsFile =
    t.includes('файл') ||
    t.includes('вложен') ||
    t.includes('документ') ||
    t.includes('таблиц') ||
    t.includes('презентац');

  const explicitlyDocumentEdit =
    t.includes('в документ') ||
    t.includes('в регламент') ||
    t.includes('измени') ||
    t.includes('отредакт') ||
    t.includes('добав') ||
    t.includes('удали') ||
    t.includes('убер') ||
    t.includes('замени') ||
    t.includes('внеси') ||
    t.includes('дополни');

  return hasReadVerb && mentionsFile && !explicitlyDocumentEdit;
}

function isConfirmation(text: string): boolean {
  const t = (text || '').trim().toLowerCase();
  if (!t) return false;
  return /^(верно|да|ок|okay|окей|согласен|согласна|подтверждаю|вноси|внеси|делай|выполняй|применяй)([.!?\s,].*)?$/i.test(t);
}

function looksLikeDocumentEdit(lastUserText: string, previousAssistantText: string): boolean {
  const t = (lastUserText || '').toLowerCase();
  const prev = (previousAssistantText || '').toLowerCase();

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
    t.includes('верни') ||
    t.includes('восстанов') ||
    t.includes('внеси') ||
    t.includes('занеси') ||
    t.includes('дополни') ||
    t.includes('оставь') ||
    t.includes('осталось') ||
    t.includes('оставалось') ||
    t.includes('только');

  const targetHint =
    t.includes('пункт') ||
    t.includes('подпункт') ||
    t.includes('раздел') ||
    t.includes('в документ') ||
    t.includes('в регламент') ||
    /\b\d+(?:\.\d+)+\b/.test(t);

  if (editVerb && targetHint) return true;

  // User confirms after assistant proposed specific edits.
  if (isConfirmation(t)) {
    return (
      prev.includes('верно ли') ||
      prev.includes('если да') ||
      prev.includes('я внесу') ||
      prev.includes('внесу эти изменения') ||
      prev.includes('убрать') ||
      prev.includes('удалить') ||
      prev.includes('добавить') ||
      prev.includes('изменить') ||
      prev.includes('пункт')
    );
  }

  return false;
}

// Orchestrator: classifier-first, but with deterministic override for edits when a document already exists.
export function decideNextAction(context: AgentContext, intent: IntentType): OrchestratorDecision {
  const hasExisting = Boolean(context?.documentContent && context.documentContent.trim().length > 20);

  if (hasExisting) {
    const msgs = context?.messages || [];
    const lastUser = [...msgs].reverse().find((m: any) => m?.role === 'user');
    const lastUserText = stripEmbeddedAttachments(extractMessageText(lastUser));
    const lastAssistant = (() => {
      const idx = msgs.length - 1;
      // Find the most recent assistant message before the last user message.
      let seenUser = false;
      for (let i = idx; i >= 0; i--) {
        if (msgs[i]?.role === 'user') {
          if (!seenUser) {
            seenUser = true;
            continue;
          }
        }
        if (seenUser && msgs[i]?.role === 'assistant') return msgs[i];
      }
      return null;
    })();
    const lastAssistantText = stripEmbeddedAttachments(extractMessageText(lastAssistant));

    // If the user is asking to read/summarize an attached file, treat it as chat.
    // The attachment's extracted text is already injected into context for the chat agent.
    if (looksLikeAttachmentReadRequest(lastUserText)) {
      return { route: 'chat', reason: 'Heuristic: user asks to read/summarize attachment (not a document edit).' };
    }

    if (looksLikeDocumentEdit(lastUserText, lastAssistantText)) {
      return { route: 'document', reason: 'Heuristic: existing document + edit/confirm request.' };
    }
  }

  if (intent === 'document') {
    return { route: 'document', reason: 'Classifier selected document generation.' };
  }

  return { route: 'chat', reason: 'Classifier selected chat.' };
}
