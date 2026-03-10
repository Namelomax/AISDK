import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText } from 'ai';

export const runtime = 'nodejs';
export const maxDuration = 300;

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseURL: 'https://openrouter.ai/api/v1',
  compatibility: 'strict',
  headers: {
    ...(process.env.OPENROUTER_REFERER ? { 'HTTP-Referer': process.env.OPENROUTER_REFERER } : {}),
    'X-Title': 'AISDK',
  },
});

const model = openrouter.chat('tngtech/deepseek-r1t2-chimera:free');

function toText(msg: any): string {
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.parts)) {
    const p = msg.parts.find((x: any) => x?.type === 'text' && typeof x.text === 'string');
    if (p?.text) return String(p.text);
  }
  return '';
}

function clip(s: string, max = 2400) {
  const t = String(s || '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export async function POST(request: Request) {
  const body = await request.json();
  const { documentContent, messages = [] } = body;

  if (!documentContent) {
    return new Response(JSON.stringify({ success: false, error: 'No document provided' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  console.log('📝 Validating document consistency...');
  
  const dialogue = messages
    .map((m: any) => `${m.role}: ${toText(m).slice(0, 500)}`)
    .join('\n\n');
  
  try {
    const { text: correctedDocument } = await generateText({
      model,
      temperature: 0.1,
      prompt: `You are a document validator. Check if document content matches the dialogue and correct any inconsistencies.

DIALOGUE CONTEXT:
${dialogue}

CURRENT DOCUMENT:
${documentContent}

VALIDATION TASK:
1. Check if document content accurately reflects ALL information from dialogue
2. Check if step names, descriptions, participants match dialogue exactly
3. Check if goal, product, consumers are correctly stated
4. Check for any missing information that was mentioned in dialogue
5. Check for any information in document that wasn't in dialogue

CORRECTION RULES:
- If document is correct, return it unchanged
- If there are inconsistencies, return corrected version
- Match exact wording from dialogue
- Don't add information not mentioned in dialogue
- Maintain document structure and formatting
- Only fix factual inconsistencies, keep the writing style

Return the corrected document (or original if no corrections needed):`,
    });

    // Check if AI made any changes
    const wasChanged = correctedDocument.trim() !== documentContent.trim();
    
    if (wasChanged) {
      console.log('✅ Document corrected after validation');
    } else {
      console.log('✅ Document validation passed - no corrections needed');
    }
    
    return new Response(JSON.stringify({ 
      success: true, 
      content: correctedDocument,
      corrected: wasChanged,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    
  } catch (e) {
    console.error('⚠️ Document validation failed:', e);
    return new Response(JSON.stringify({ 
      success: true, 
      content: documentContent,
      error: String(e),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
