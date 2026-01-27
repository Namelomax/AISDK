import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText } from 'ai';
import { z } from 'zod';
import type { ProcessDiagramState } from '@/lib/document/types';
import { TEMPLATE_XML } from '@/lib/document/drawio';

export const runtime = 'nodejs';
export const maxDuration = 30;

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseURL: 'https://openrouter.ai/api/v1',
  compatibility: 'strict',
  headers: {
    ...(process.env.OPENROUTER_REFERER ? { 'HTTP-Referer': process.env.OPENROUTER_REFERER } : {}),
    'X-Title': 'AISDK',
  },
});

const model = openrouter.chat('z-ai/glm-4.5-air:free');

function toText(msg: any): string {
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.parts)) {
    const p = msg.parts.find((x: any) => x?.type === 'text' && typeof x.text === 'string');
    if (p?.text) return String(p.text);
  }
  return '';
}

function normalize(s: string | null | undefined) {
  const t = String(s ?? '').trim();
  return t || null;
}

function clip(s: string, max = 2400) {
  const t = String(s || '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function extractDrawioXmlFromText(textRaw: string) {
  const text = String(textRaw || '');
  if (!text) return { xml: '', rest: '' };
  const xmlMatch = text.match(/<\?xml[\s\S]*?<\/mxfile>/i);
  const mxfileMatch = text.match(/<mxfile[\s\S]*?<\/mxfile>/i);
  const xml = (xmlMatch?.[0] || mxfileMatch?.[0] || '').trim();
  if (!xml) return { xml: '', rest: text };
  const rest = text.replace(xml, '');
  return { xml, rest };
}

function extractStepsFromText(textRaw: string) {
  const text = String(textRaw || '');
  const matches = Array.from(text.matchAll(/Шаг\s*(\d+)\.?\s*([^\n\r]+)/gi));
  if (!matches.length) return [] as Array<{ id: string; label: string; details: string; participants: string }>;

  const results: Array<{ id: string; label: string; details: string; participants: string }> = [];

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const start = m.index ?? 0;
    const end = i + 1 < matches.length ? matches[i + 1].index ?? text.length : text.length;
    let block = text.slice(start, end);
    const label = String(m[2] || '').trim() || `Шаг ${m[1]}`;

    // Отсекаем информацию о потребителях - она должна быть в финальном продукте
    block = block.replace(/Потребители\s*продукта\s*:[\s\S]*/i, '');
    block = block.replace(/Документы\/артефакты\s*:[\s\S]*/i, '');

    const descMatch = block.match(/Описание:\s*([\s\S]*?)(?:\n\s*Участники:|\n\s*Должность:|\n\s*Ответственный:|\n\s*Продукт|$)/i);
    const participantsMatch = block.match(/Участники:\s*([\s\S]*?)(?:\n\s*Должность:|\n\s*Ответственный:|\n\s*Продукт|$)/i);
    const roleMatch = block.match(/Должность:\s*([\s\S]*?)(?:\n\s*ФИО:|\n\s*Продукт|$)/i);
    const productMatch = block.match(/Продукт(?:\s*шага)?:\s*([\s\S]*?)(?:\n\s*Шаг\s*\d+|\n\s*Потребители|$)/i);
    const responsibleMatch = block.match(/Ответственный:\s*([\s\S]*?)(?:\n|$)/i);
    const createsMatch = block.match(/Созда[её]т:\s*([\s\S]*?)(?:\n|$)/i);
    const actionMatch = block.match(/Действи[ея]:\s*([\s\S]*?)(?:\n\s*Продукт|$)/i);

    const description = normalize(descMatch?.[1]) || '';
    const participants = normalize(participantsMatch?.[1]) || normalize(responsibleMatch?.[1]) || '';
    const role = normalize(roleMatch?.[1]) || '';
    const product = normalize(productMatch?.[1]) || normalize(createsMatch?.[1]) || '';
    const action = normalize(actionMatch?.[1]) || '';

    // Формируем строку участников с их действиями для отображения над шагом
    let participantsInfo = participants;
    if (action && participants) {
      participantsInfo = `${participants}\n(${action})`;
    }

    // Собираем детали - включаем ВСЕ поля для parseStepDetails в LocalFlowDiagram
    const detailParts: string[] = [];
    if (description) detailParts.push(`Описание: ${clip(description, 1200)}`);
    if (participants) detailParts.push(`Участники: ${clip(participants, 800)}`);
    if (role) detailParts.push(`Должность: ${clip(role, 200)}`);
    if (product) detailParts.push(`Продукт: ${clip(product, 800)}`);
    
    const details = detailParts.join('\n') || `Шаг ${i + 1}`;

    results.push({ 
      id: `S${i + 1}`, 
      label, 
      details,
      participants: participantsInfo
    });
  }

  return results;
}

function heuristicPatchFromText(textRaw: string): Partial<ProcessDiagramState> {
  const text = String(textRaw || '').replace(/\r\n?/g, '\n').trim();
  const patch: Partial<ProcessDiagramState> = {};

  const normalize = (s: string | null | undefined) => {
    const v = String(s ?? '').trim();
    return v.replace(/^\*\*|\*\*$/g, '').trim() || null;
  };

  const grabKey = (keyPattern: string | RegExp) => {
    const pattern = typeof keyPattern === 'string'
       ? keyPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
       : keyPattern.source;

    const tolerantPattern = pattern.replace(/\\ s\+/g, '\\s+').replace(/\s+/g, '\\s+');

    // Matches optional numbering "1. ", optional bold "**", then key
    // Then separator complex: optional whitespace, optional **, whitespace, colon/dash, whitespace, optional **, whitespace
    // Then capture value
    const sep = `\\s*(?:\\*\\*)?\\s*[:—–-]\\s*(?:\\*\\*)?\\s*`;
    const re = new RegExp(`(?:^|\\n)\\s*(?:\\d+\\.\\s*)?(?:\\*\\*)?${tolerantPattern}${sep}(.+)`, 'i');
    
    const m = text.match(re);
    return normalize(m?.[1]);
  };

  const grabLine = (label: string) => {
    const re = new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, 'im');
    const m = text.match(re);
    return normalize(m?.[1]);
  };

  // Organization
  {
    let name = grabKey('Официальное название компании') || 
                 grabKey('Организация') || 
                 grabKey('Компания') || 
                 grabKey('Название компании') ||
                 normalize((text.match(/\bв\s+(?:компании|организации)\s+([^\n.]+?)(?:\.|\n|$)/i) || [])[1]);
    
    // Also try "Я директор/руководитель <ORG NAME>" pattern
    if (!name) {
      const orgMatch = text.match(/\bя\s+(?:директор|руководитель|менеджер|глава|куратор|координатор|специалист|администратор|работаю в)\s+([^\n.]+?)(?:\.|\n|$)/i);
      if (orgMatch?.[1]) {
        // The match may contain the org name
        name = normalize(orgMatch[1]);
      }
    }
    
    if (name) patch.organization = { ...(patch.organization || {}), name };
    
    const activity = grabKey('Область деятельности') || grabKey('Мы занимаемся');
    if (activity) patch.organization = { ...(patch.organization || {}), activity };
  }

  // Owner Name
  {
     const m = text.match(/\b(?:меня\s+зовут|мое\s+имя|я\s*[-–—]?\s*)\s*([А-ЯЁA-Z][а-яёa-z]+\s+[А-ЯЁA-Z][а-яёa-z]+(?:\s+[А-ЯЁA-Z][а-яёa-z]+)?)/i);
     if (m?.[1]) patch.owner = { ...(patch.owner || {}), fullName: normalize(m[1]) };
  }
  // Owner Position
  {
     // Capture the role itself (директор, руководитель, etc.)
     const posMatch = text.match(/\bя\s+(директор|руководитель|менеджер|глава|куратор|координатор|специалист|администратор)/i);
     if (posMatch?.[1]) {
       patch.owner = { ...(patch.owner || {}), position: normalize(posMatch[1]) };
     }
  }

  // Process
  {
    const name = grabKey('Назначение регламента') || grabKey('Процесс') || grabKey('Регламент');
    let cleanName = name;
    if (cleanName && /регламентирует\s+процесс/i.test(cleanName)) {
      cleanName = cleanName.replace(/^регламентирует\s+процесс\s+/i, '');
      cleanName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
    }
    if (cleanName) patch.process = { ...(patch.process || {}), name: cleanName };
    
    const m = text.match(/\b(?:мне\s+необходимо|я\s+хочу)\s+описать\s+([^\n.]+?)(?:\.|\n|$)/i);
    if (m?.[1]) patch.process = { ...(patch.process || {}), description: normalize(m[1]) };
  }

  // Goal
  {
    const goal = grabKey('Цель процесса') || grabKey('Цель') || 
                 normalize((text.match(/\bцель[^\n—-]*[—-]\s*([^\n.]+?)(?:\.|\n|$)/i) || [])[1]);
    if (goal) patch.goal = goal;
  }

  // Product
  {
    const product = grabKey('Продукт') || grabKey('Результат') ||
                    normalize((text.match(/\bконечн(?:ый|ая)\s+результат[^\n—-]*[—-]\s*([^\n.]+?)(?:\.|\n|$)/i) || [])[1]);
    if (product) patch.product = product;
  }
  
  // Product Description
  {
     const desc = grabKey('Описание продукта');
     if (desc) patch.productDescription = desc;
  }

  // Boundaries
  {
    const start = grabKey('Начало') || grabKey('Старт');
    const end = grabKey('Завершение') || grabKey('Конец') || grabKey('Финиш');
    if (start || end) patch.boundaries = { start, end };
  }

  // Consumers
  {
    const consumersRaw = grabKey('Потребители продукта') || grabKey('Потребители');
    if (consumersRaw) {
      const list = consumersRaw.split(/[,;]\s*/).map(s => s.trim()).filter(Boolean);
      if (list.length) patch.consumers = list;
    }
  }

  return patch;
}

function mergeState(prev: ProcessDiagramState | null, patch: Partial<ProcessDiagramState>): ProcessDiagramState {
  const base: ProcessDiagramState = prev ? { ...prev } : {};
  const next: ProcessDiagramState = { ...base };

  const pickText = (val: any) => {
    if (val === null || val === undefined) return undefined;
    if (typeof val === 'string') {
      const v = normalize(val);
      return v ?? undefined;
    }
    return val;
  };

  if (patch.rawDrawioXml !== undefined) {
    const v = String(patch.rawDrawioXml || '').trim();
    next.rawDrawioXml = v || undefined;
  }

  if (patch.organization) {
    const org: NonNullable<ProcessDiagramState['organization']> = { ...(base.organization || {}) };
    const name = pickText(patch.organization.name);
    const activity = pickText(patch.organization.activity);
    if (name !== undefined) org.name = name as any;
    if (activity !== undefined) org.activity = activity as any;
    next.organization = org;
  }
  if (patch.process) {
    const proc: NonNullable<ProcessDiagramState['process']> = { ...(base.process || {}) };
    const name = pickText(patch.process.name);
    const description = pickText(patch.process.description);
    if (name !== undefined) proc.name = name as any;
    if (description !== undefined) proc.description = description as any;
    next.process = proc;
  }
  if (patch.owner) {
    const owner: NonNullable<ProcessDiagramState['owner']> = { ...(base.owner || {}) };
    const fullName = pickText(patch.owner.fullName);
    const position = pickText(patch.owner.position);
    if (fullName !== undefined) owner.fullName = fullName as any;
    if (position !== undefined) owner.position = position as any;
    next.owner = owner;
  }
  if (patch.boundaries) {
    const boundaries: NonNullable<ProcessDiagramState['boundaries']> = { ...(base.boundaries || {}) };
    const start = pickText(patch.boundaries.start);
    const end = pickText(patch.boundaries.end);
    if (start !== undefined) boundaries.start = start as any;
    if (end !== undefined) boundaries.end = end as any;
    next.boundaries = boundaries;
  }

  if (patch.goal !== undefined) {
    const goal = pickText(patch.goal);
    if (goal !== undefined) next.goal = goal as any;
  }
  if (patch.product !== undefined) {
    const product = pickText(patch.product);
    if (product !== undefined) next.product = product as any;
  }
  if (patch.productDescription !== undefined) {
    const pd = pickText(patch.productDescription);
    if (pd !== undefined) next.productDescription = pd as any;
  }

  if (Array.isArray(patch.consumers)) {
    const existing = Array.isArray(base.consumers) ? base.consumers : [];
    const deduped: ProcessDiagramState['consumers'] = [];
    const seen = new Set<string>();

    const normalizeConsumer = (input: any): {
      kind: 'person' | 'org' | 'group';
      name?: string | null;
      fullName?: string | null;
      position?: string | null;
    } | null => {
      if (!input) return null;
      if (typeof input === 'string') {
        const name = normalize(input);
        if (!name) return null;
        return { kind: 'group', name };
      }
      const kind = (input.kind as any) || 'group';
      if (kind !== 'person' && kind !== 'org' && kind !== 'group') return null;
      const fullName = normalize(input.fullName);
      const name = normalize(input.name);
      const position = normalize(input.position);
      if (!fullName && !name) return null;
      return { kind, fullName, name, position };
    };

    const add = (c: any) => {
      const normalized = normalizeConsumer(c);
      if (!normalized) return;
      const key = [normalized.kind, normalized.fullName || '', normalized.name || '', normalized.position || '']
        .join('|')
        .toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      deduped.push(normalized);
    };

    for (const c of existing) add(c);
    for (const c of patch.consumers) add(c);
    next.consumers = deduped;
  }

  if (patch.graph && (Array.isArray(patch.graph.nodes) || Array.isArray(patch.graph.edges) || patch.graph.layout)) {
    next.graph = {
      layout: patch.graph.layout ?? base.graph?.layout,
      nodes: Array.isArray(patch.graph.nodes) ? patch.graph.nodes : base.graph?.nodes,
      edges: Array.isArray(patch.graph.edges) ? patch.graph.edges : base.graph?.edges,
    };
  }

  next.updatedAt = new Date().toISOString();
  return next;
}

const PatchSchema = z
  .object({
    organization: z
      .object({
        name: z.string().nullable().optional(),
        activity: z.string().nullable().optional(),
      })
      .optional(),
    process: z
      .object({
        name: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
      })
      .optional(),
    owner: z
      .object({
        fullName: z.string().nullable().optional(),
        position: z.string().nullable().optional(),
      })
      .optional(),
    goal: z.string().nullable().optional(),
    product: z.string().nullable().optional(),
    productDescription: z.string().nullable().optional(),
    consumers: z
      .array(
        z.union([
          z.string(),
          z
            .object({
              kind: z.enum(['person', 'org', 'group']).optional(),
              name: z.string().nullable().optional(),
              fullName: z.string().nullable().optional(),
              position: z.string().nullable().optional(),
            })
            .passthrough(),
        ]),
      )
      .optional(),
    boundaries: z
      .object({
        start: z.string().nullable().optional(),
        end: z.string().nullable().optional(),
      })
      .optional(),
    graph: z
      .object({
        layout: z.string().nullable().optional(),
        nodes: z
          .array(
            z.object({
              id: z.string().nullable().optional(),
              label: z.string().min(1),
              type: z.string().nullable().optional(),
              details: z.string().nullable().optional(),
            })
          )
          .optional(),
        edges: z
          .array(
            z.object({
              from: z.string().min(1),
              to: z.string().min(1),
              label: z.string().nullable().optional(),
            })
          )
          .optional(),
      })
      .optional(),
  })
  .passthrough();

function normalizeNodeType(raw?: string | null) {
  const t = String(raw ?? '').trim().toLowerCase();
  if (!t) return undefined;
  if (['start', 'process', 'decision', 'end', 'actor', 'doc', 'note'].includes(t)) return t as any;
  if (t.includes('событие') || t.includes('старт')) return 'start';
  if (t.includes('конец') || t.includes('финиш') || t.includes('заверш')) return 'end';
  if (t.includes('решени') || t.includes('ветв') || t.includes('услов')) return 'decision';
  if (t.includes('акт') || t.includes('исполн') || t.includes('роль') || t.includes('участ')) return 'actor';
  if (t.includes('док')) return 'doc';
  if (t.includes('замет') || t.includes('примеч')) return 'note';
  if (t.includes('шаг') || t.includes('процесс') || t.includes('действ')) return 'process';
  return 'process';
}

function normalizeGraph(patch: Partial<ProcessDiagramState>): Partial<ProcessDiagramState> {
  if (!patch.graph?.nodes) return patch;
  const nodes = patch.graph.nodes.map((n) => ({
    ...n,
    type: normalizeNodeType(n.type),
  }));
  return {
    ...patch,
    graph: {
      layout: patch.graph.layout,
      nodes,
      edges: patch.graph.edges,
    },
  } as Partial<ProcessDiagramState>;
}

function sanitizePatch(patch: Partial<ProcessDiagramState>): Partial<ProcessDiagramState> {
  if ((patch as any)?.consumers && !Array.isArray(patch.consumers)) {
    const raw = String((patch as any).consumers || '').trim();
    if (raw) {
      patch.consumers = raw.split(/\s*,\s*|\s*;\s*/g).filter(Boolean);
    } else {
      delete (patch as any).consumers;
    }
  }
  if (patch.graph?.nodes && Array.isArray(patch.graph.nodes) && patch.graph.nodes.length === 0) {
    patch.graph.nodes = undefined;
  }
  if (patch.graph?.edges && Array.isArray(patch.graph.edges) && patch.graph.edges.length === 0) {
    patch.graph.edges = undefined;
  }
  return patch;
}

function applyTextToDrawioXml(xml: string, state: ProcessDiagramState, steps: any[]) {
  let updated = xml;
  
  // Патчим по ID ячейки - это надёжнее чем по значению
  const setValById = (cellId: string, value: string | null | undefined) => {
    if (value === null || value === undefined) return;
    const escapedVal = String(value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '&#xa;');
    const re = new RegExp(`(<mxCell[^>]*\\bid="${cellId}"[^>]*\\bvalue=")[^"]*("[^>]*>)`, 'g');
    updated = updated.replace(re, `$1${escapedVal}$2`);
  };

  // Main fields - патчим по ID
  if (state.organization?.name) setValById('WUNQLDYkcmdtQOnQ86g9-10', state.organization.name);
  if (state.process?.name) setValById('N9eBfpktY8xSMP5imMae-5', state.process.name);
  if (state.goal) setValById('WUNQLDYkcmdtQOnQ86g9-12', state.goal);
  if (state.productDescription) setValById('N9eBfpktY8xSMP5imMae-53', state.productDescription);
  
  // Owner fields - по ID
  if (state.owner?.fullName) setValById('N9eBfpktY8xSMP5imMae-13', state.owner.fullName);
  if (state.owner?.position) setValById('N9eBfpktY8xSMP5imMae-9', state.owner.position);
  
  // Boundaries - по ID
  if (state.boundaries?.start) setValById('N9eBfpktY8xSMP5imMae-26', state.boundaries.start);
  if (state.boundaries?.end) setValById('N9eBfpktY8xSMP5imMae-27', state.boundaries.end);
  
  // Consumers (up to 3 in template) - по ID
  const consumers = Array.isArray(state.consumers) ? state.consumers : [];
  const consumerIds = ['N9eBfpktY8xSMP5imMae-39', 'N9eBfpktY8xSMP5imMae-43', 'N9eBfpktY8xSMP5imMae-47'];
  for (let i = 0; i < 3; i++) {
    const c = consumers[i];
    let consumerName = '';
    if (c) {
      if (typeof c === 'string') {
        consumerName = c;
      } else {
        consumerName = c.name || c.fullName || '';
      }
    }
    if (consumerName) setValById(consumerIds[i], consumerName);
  }

  // Steps - заполняем название шага и детали (участники, продукт внутри деталей)
  // ID шагов: N9eBfpktY8xSMP5imMae-28, -29, -30, -31
  const stepCellIds = ['N9eBfpktY8xSMP5imMae-28', 'N9eBfpktY8xSMP5imMae-29', 'N9eBfpktY8xSMP5imMae-30', 'N9eBfpktY8xSMP5imMae-31'];
  
  for (let i = 0; i < 4; i++) {
    const stepNum = i + 1;
    
    if (i < steps.length) {
      const step = steps[i];
      // Патчим название шага по ID
      setValById(stepCellIds[i], step.label);
      
      // Патчим детали шага (содержат участников, должность, продукт)
      setValById(`STEP${stepNum}_DETAILS`, step.details || '');
      
    } else {
      // Скрываем неиспользуемые шаги
      const cellIds = [
        stepCellIds[i], 
        `STEP${stepNum}_DETAILS`
      ];
      for (const cid of cellIds) {
        const re = new RegExp(`(<mxCell[^>]*\\bid="${cid}"[^>]*style=")([^"]*)(")`, 'g');
        updated = updated.replace(re, (match, p1, p2, p3) => {
          if (!p2.includes('opacity=')) {
            return `${p1}${p2};opacity=0${p3}`;
          }
          return match;
        });
      }
    }
  }

  return updated;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const messagesRaw = Array.isArray(body.messages) ? body.messages : [];
  const prevState = (body.state || null) as ProcessDiagramState | null;

  const msgs = messagesRaw
    .slice(-16)
    .map((m: any) => ({ role: m?.role, content: toText(m) }))
    .filter((m: any) => m.role && typeof m.content === 'string' && m.content.trim());

  const lastUser = [...msgs].reverse().find((m: any) => m.role === 'user');
  const lastUserText = lastUser?.content || '';
  const { xml: rawXml, rest: rawXmlRest } = extractDrawioXmlFromText(lastUserText);
  const processingText = rawXml ? rawXmlRest : lastUserText;

  // Проверяем версию шаблона - если в старом XML есть STEP1_GROUP или STEP1_ACTOR,
  // значит это старая структура и нужно использовать новый шаблон
  const prevXml = prevState?.rawDrawioXml || '';
  const isOldStructure = prevXml.includes('STEP1_GROUP') || prevXml.includes('STEP1_ACTOR') || prevXml.includes('Actor.svg');
  
  // Use rawXml if found, otherwise use previous state's XML (if not old structure), otherwise use default template
  const workingXml = rawXml || (prevXml && !isOldStructure ? prevXml : TEMPLATE_XML);
  console.log('Working XML source:', rawXml ? 'new from message' : (prevXml && !isOldStructure) ? 'from prevState' : 'DEFAULT TEMPLATE (forced refresh)');
  if (isOldStructure) {
    console.log('Old template structure detected, forcing refresh to new template');
  }

  if (processingText) {
      console.log('--- DEBUG DIAGRAM ---');
      console.log('User Text Length:', processingText.length);
      console.log('User Text Snippet:', processingText.slice(0, 200));
  }

  const stepNodes = extractStepsFromText(processingText);

  const xmlOnly = Boolean(rawXml && String(rawXmlRest || '').trim() === '');
  if (xmlOnly) {
    const merged = mergeState(prevState, { rawDrawioXml: rawXml });
    return new Response(JSON.stringify({ success: true, state: merged }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!String(processingText || '').trim()) {
    return new Response(JSON.stringify({ success: true, state: mergeState(prevState, {}) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Heuristic baseline patch from the last user message.
  const heuristic = heuristicPatchFromText(processingText);
  
  // Explicitly set the base XML to ensure it persists in the state merge
  // If we found new XML, use it. If not, preserve the old one in heuristic so it's not lost if merge behavior is weird.
  if (workingXml) {
    heuristic.rawDrawioXml = workingXml;
  }
  
  // LOG HEURISTIC RESULTS
  console.log('Heuristic Extracted:', JSON.stringify(heuristic, null, 2));

  // If we extracted XML from this message, apply it.
  if (rawXml) {
    heuristic.rawDrawioXml = rawXml;
  }

  if (stepNodes.length) {
    heuristic.graph = {
      layout: 'template-v1',
      nodes: stepNodes,
      edges: stepNodes.slice(1).map((n, i) => ({ from: stepNodes[i].id, to: n.id })),
    };
  }

  try {
    const { text: rawOutput } = await generateText({
      model,
      temperature: 0.1,
      prompt: `Ты отдельный агент, который обновляет состояние схемы бизнес-процесса на основе диалога.

ТЕБЕ ДАДУТ:
1) Предыдущее состояние (JSON)
2) Последние сообщения диалога

НУЖНО:
- Извлечь только факты о процессе (организация, владелец, цель, продукт, потребители, границы)
- ПО ВОЗМОЖНОСТИ сформировать схему процесса в виде графа (nodes/edges) по содержанию диалога
- Делай дополнения «рядом» с шагом: добавляй details к существующему узлу, а не новые узлы
- У каждого узла ДОЛЖНО быть details. Формат details СТРОГО:
  Описание: <2–4 предложения>
  Участники: <перечень ролей/людей>
  Должность: <роль/должность ответственного>
  ФИО: <ФИО если есть, иначе "не найдено">
  Продукт: <что получается на выходе>
  (каждая строка с новой строки)
  Если данных нет — укажи «не найдено» явно, не оставляй пустым.
- Если пользователь перечислил шаги по номерам или списком — включи ВСЕ шаги (не сокращай), порядок сохранить.
- Если что-то поменялось — корректируй существующие узлы (label/details/edges), можно пересобрать граф целиком
- Всегда ставь graph.layout = "template-v1"
- Вернуть ТОЛЬКО JSON-патч, который ДОПОЛНЯЕТ состояние (не стирай поля без причины)
- Если в последнем сообщении нет новых фактов — верни пустой объект {}

ПРЕДЫДУЩЕЕ СОСТОЯНИЕ:
${JSON.stringify(prevState || {}, null, 2)}

ПОДСКАЗКА (эвристика из последнего сообщения пользователя):
${JSON.stringify(heuristic || {}, null, 2)}

ПОСЛЕДНИЕ СООБЩЕНИЯ:
${msgs
  .map((m: any) => {
    const c = m.content.length > 700 ? `${m.content.slice(0, 700)}…` : m.content;
    return `${m.role}: ${c}`;
  })
  .join('\n\n')}

ПОДСКАЗКИ:
- owner.fullName: ФИО владельца/ответственного
- owner.position: должность владельца
- organization.name/activity: название организации и чем занимается
- process.name/description: название процесса/регламента/схемы и краткое описание
- goal: цель процесса (одной строкой)
- product: итоговый продукт/результат (одной строкой)
- consumers: список потребителей результата (персона/организация/группа)
- boundaries.start/end: старт/финиш (дата или событие/триггер)
 - graph.nodes: список узлов схемы (label + type + details), используй понятные шаги/акторы/документы
 - graph.edges: связи между узлами (from -> to), используй id узлов

ВАЖНО:
- Верни строго JSON (без markdown, без <think>)
- Используй эвристику как подсказку, но можешь уточнять/исправлять
- Если нашёл новые факты — верни их. Если фактов нет — {}
 - Если создаёшь graph, задай уникальные id (например, N1, N2, N3)
- Старайся держать граф компактным: 5–10 ключевых узлов, остальное в details

Верни только валидный JSON.`,
    });

    let rawPatch: any = {};
    try {
        let clean = rawOutput
          .replace(/<think>[\s\S]*?<\/think>/gi, '') 
          .replace(/```json/gi, '')
          .replace(/```/g, '')
          .trim();

        const first = clean.indexOf('{');
        const last = clean.lastIndexOf('}');
        if (first !== -1 && last !== -1) {
          clean = clean.substring(first, last + 1);
        }
        
        rawPatch = JSON.parse(clean);
    } catch (e) {
        console.warn('Failed to parse diagram patch, using empty object', e);
        // Fallback to empty -> eventually falls back to heuristic via mergeState logic below
        rawPatch = {};
    }

    const patch = sanitizePatch(normalizeGraph(rawPatch as Partial<ProcessDiagramState>));
    if (stepNodes.length) {
      patch.graph = {
        layout: 'template-v1',
        nodes: stepNodes,
        edges: stepNodes.slice(1).map((n, i) => ({ from: stepNodes[i].id, to: n.id })),
      };
    }
    // Merge: heuristic baseline first, then model patch (model can override).
    const merged = mergeState(mergeState(prevState, heuristic), patch);
    
    console.log('Merged State Org:', merged.organization);

    if (merged.rawDrawioXml) {
      console.log('Applying text to XML...');
      const before = merged.rawDrawioXml.length;
      merged.rawDrawioXml = applyTextToDrawioXml(merged.rawDrawioXml, merged, stepNodes);
      console.log('XML Updated. Length change:', before, '->', merged.rawDrawioXml.length);
    } else {
        console.log('No rawDrawioXml to patch!');
    }

    return new Response(JSON.stringify({ success: true, state: merged }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('diagram agent failed', e);
    // Fall back to heuristic-only update so the UI still progresses.
    const merged = mergeState(prevState, heuristic);

    if (merged.rawDrawioXml) {
      merged.rawDrawioXml = applyTextToDrawioXml(merged.rawDrawioXml, merged, stepNodes);
    }

    return new Response(JSON.stringify({ success: true, state: merged }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
