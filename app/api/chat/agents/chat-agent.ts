import { streamText, ModelMessage } from 'ai';
import { AgentContext } from './types';
import { updateConversation, saveConversation } from '@/lib/getPromt';

const TIMESTAMP_RE = /\b\d{1,2}:\d{2}(?::\d{2})?\b/;

const STOP_WORDS = new Set([
  'что', 'это', 'как', 'когда', 'где', 'почему', 'зачем', 'какой', 'какая', 'какие',
  'сколько', 'каков', 'какова', 'можно', 'нужно', 'надо', 'ли', 'или', 'и', 'а',
  'но', 'в', 'на', 'по', 'про', 'для', 'из', 'к', 'с', 'со', 'у', 'от', 'до',
  'об', 'о', 'без', 'не', 'да', 'нет', 'мы', 'вы', 'они', 'он', 'она', 'оно',
  'этот', 'эта', 'эти', 'тот', 'та', 'те', 'там', 'тут', 'здесь', 'также',
  'либо', 'тоже', 'есть', 'будет', 'быть', 'бы', 'же', 'прошу', 'пожалуйста',
]);

function extractQueryTerms(text: string): string[] {
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s:]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return [];

  return normalized
    .split(' ')
    .filter((token) => token.length > 3 && !STOP_WORDS.has(token));
}

function collectHiddenTranscripts(uiMessages: any[]): string[] {
  const texts: string[] = [];
  for (const msg of uiMessages || []) {
    const hidden = Array.isArray(msg?.metadata?.hiddenTexts) ? msg.metadata.hiddenTexts : [];
    for (const h of hidden) {
      const cleaned = String(h || '').trim();
      if (cleaned) texts.push(cleaned);
    }
  }
  return texts;
}

function buildTimestampSnippets(transcripts: string[], query: string): string[] {
  if (!transcripts.length) return [];
  const terms = extractQueryTerms(query);
  const snippets: string[] = [];

  const lines = transcripts.join('\n').split(/\r?\n/);
  let lastTimestamp = '';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const tsMatch = line.match(TIMESTAMP_RE);
    if (tsMatch) {
      lastTimestamp = tsMatch[0];
    }

    if (!terms.length) continue;
    const hay = line.toLowerCase();
    const hit = terms.some((t) => hay.includes(t));
    if (!hit || !lastTimestamp) continue;

    const snippetText = line.length > 220 ? `${line.slice(0, 217)}...` : line;
    const snippet = `[${lastTimestamp}] ${snippetText}`;
    if (!snippets.includes(snippet)) snippets.push(snippet);
    if (snippets.length >= 5) break;
  }

  return snippets;
}

export async function runChatAgent(context: AgentContext, systemPrompt: string, userPrompt: string) {
  const { messages, model, userId, conversationId, uiMessages } = context;
  const messagesWithUserPrompt: ModelMessage[] = [];
  
  if (userPrompt && userPrompt.trim()) {
    messagesWithUserPrompt.push({
      role: 'system',
      content: userPrompt,
    });
  }

  const lastUserText = (() => {
    const lastUser = Array.isArray(uiMessages)
      ? [...uiMessages].reverse().find((m: any) => m?.role === 'user')
      : null;
    if (lastUser?.parts?.length) {
      const textPart = lastUser.parts.find((p: any) => p?.type === 'text');
      if (textPart?.text) return String(textPart.text);
    }
    return '';
  })();

  const transcriptTexts = collectHiddenTranscripts(Array.isArray(uiMessages) ? uiMessages : []);
  const snippets = buildTimestampSnippets(transcriptTexts, lastUserText);
  if (snippets.length > 0) {
    messagesWithUserPrompt.push({
      role: 'system',
      content:
        'Используй тайм-коды из расшифровки, если отвечаешь на вопросы по встрече.\n' +
        'Если ответа нет в расшифровке, прямо скажи, что не найдено.\n\n' +
        'Релевантные тайм-коды:\n' +
        snippets.map((s) => `- ${s}`).join('\n'),
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
