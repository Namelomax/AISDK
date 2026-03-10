import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText } from 'ai';
import { generateObject } from 'ai';
import { z } from 'zod';
import type { ProcessDiagramState } from '@/lib/document/types';
import { TEMPLATE_XML } from '@/lib/document/drawio';

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

// Shemes for parsing

const ParticipantActionSchema = z.object({
  name: z.string().describe('ФИО или роль участника (например: "директор (Ищенко Р.В.)", "методист")'),
  role: z.string().optional().describe('Должность участника, если указана отдельно'),
  action: z.string().describe('Что делает участник (например: "проверяет финальный результат", "составляет методички")'),
});

const StepNodeSchema = z.object({
  id: z.string().describe('Уникальный ID шага (S1, S2, S3 и т.д.)'),
  label: z.string().optional().default('Шаг процесса').describe('Краткое название шага (например: "Подготовка регламента")'),
  description: z.string().optional().default('').describe('Подробное описание шага (2-4 предложения)'),
  participants: z.array(ParticipantActionSchema).describe('Участники шага с их действиями'),
  product: z.string().optional().default('').describe('Продукт/результат шага (что получается на выходе)'),
  context: z.string().optional().describe('Дополнительный контекст (например: "в связи с понижением уровня программирования")'),
}).passthrough(); // Allow additional fields like role, details, type

const ProcessDiagramPatchSchema = z.object({
  organization: z.object({
    name: z.string().optional(),
    activity: z.string().optional(),
  }).optional(),
  
  owner: z.object({
    fullName: z.string().optional(),
    position: z.string().optional(),
  }).optional(),
  
  process: z.object({
    name: z.string().optional(),
    description: z.string().optional(),
  }).optional(),
  
  goal: z.string().optional().describe('Цель процесса одной строкой'),
  product: z.string().optional().describe('Итоговый продукт процесса'),
  consumers: z.union([
    z.string(),
    z.array(z.string())
  ]).optional().describe('Потребители результата (кто использует продукт) - строка или массив строк'),
  
  boundaries: z.object({
    start: z.string().optional(),
    end: z.string().optional(),
  }).optional(),
  
graph: z.object({
  layout: z.literal('template-v1').optional().default('template-v1'),
  nodes: z.array(StepNodeSchema),
  edges: z.array(z.object({
    from: z.string(),
    to: z.string(),
  })).optional().default([]),
}).optional(),
});

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

function normalize(s: string | null | undefined) {
  const t = String(s ?? '').trim();
  return t || null;
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
  if (!matches.length) return [] as Array<{ id: string; label: string; description: string; participants: string; role: string; product: string }>;

  const results: Array<{ id: string; label: string; description: string; participants: string; role: string; product: string }> = [];

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const start = m.index ?? 0;
    const end = i + 1 < matches.length ? matches[i + 1].index ?? text.length : text.length;
    let block = text.slice(start, end);
    const label = String(m[2] || '').trim() || `Шаг ${m[1]}`;

    // Отсекаем информацию о потребителях - она должна быть в финальном продукте
    block = block.replace(/Потребители\s*продукта\s*:[\s\S]*/i, '');
    block = block.replace(/Документы\/артефакты\s*:[\s\S]*/i, '');

    const descMatch = block.match(/Описание:\s*([\s\S]*?)(?:\n\s*Участники:|\n\s*Должность:|\n\s*Ответственный:|\n\s*Продукт|\n\s*Действи|$)/i);
    const participantsMatch = block.match(/Участники:\s*([\s\S]*?)(?:\n\s*Должность:|\n\s*Ответственный:|\n\s*Продукт|\n\s*Действи|$)/i);
    const roleMatch = block.match(/Должность:\s*([\s\S]*?)(?:\n\s*ФИО:|\n\s*Продукт|$)/i);
    
    // Продукт шага - только до конца строки или до начала действий участников
    // Ищем паттерн "Продукт шага:" и берём только одну-две строки
    const productMatch = block.match(/Продукт(?:\s*шага)?:\s*([^\n]+(?:\n(?![а-яА-Яa-zA-Z]+\s+(?:проверяет|составляет|координирует|утверждает|готовит|создаёт|формирует|согласует|отвечает))[^\n]*)*)/i);
    
    const responsibleMatch = block.match(/Ответственный:\s*([\s\S]*?)(?:\n|$)/i);
    const createsMatch = block.match(/Созда[её]т:\s*([\s\S]*?)(?:\n|$)/i);
    const actionMatch = block.match(/Действи[ея]:\s*([\s\S]*?)(?:\n\s*Продукт|$)/i);

    const description = normalize(descMatch?.[1]) || '';
    let participantsRaw = normalize(participantsMatch?.[1]) || normalize(responsibleMatch?.[1]) || '';
    const role = normalize(roleMatch?.[1]) || '';
    let product = normalize(productMatch?.[1]) || normalize(createsMatch?.[1]) || '';
    const action = normalize(actionMatch?.[1]) || '';

    // Парсим действия участников в свободной форме
    // Ищем паттерны типа "директор проверяет...", "координатор согласует..."
    const freeFormActions = block.match(/\n\s*([а-яА-Яa-zA-Z\s\(\)\.]+?)\s+(проверяет|составляет|координирует|утверждает|готовит|создаёт|формирует|согласует|отвечает|разрабатывает|настраивает|обеспечивает|организует|контролирует|ведёт|подготавливает)\s+([^\n]+)/gi);
    
    const participantActions: Array<{ name: string; action: string }> = [];
    
    // Сначала парсим из скобок в списке участников
    if (participantsRaw) {
      const parts = participantsRaw.split(/[,;]/).map(p => p.trim()).filter(Boolean);
      for (const p of parts) {
        const match = p.match(/^(.+?)\s*\((.+?)\)\s*$/);
        if (match) {
          participantActions.push({ name: match[1].trim(), action: match[2].trim() });
        } else {
          participantActions.push({ name: p, action: '' });
        }
      }
    }
    
    // Затем парсим свободную форму действий
    if (freeFormActions) {
      for (const fa of freeFormActions) {
        const match = fa.match(/\n?\s*([а-яА-Яa-zA-Z\s\(\)\.]+?)\s+(проверяет|составляет|координирует|утверждает|готовит|создаёт|формирует|согласует|отвечает|разрабатывает|настраивает|обеспечивает|организует|контролирует|ведёт|подготавливает)\s+([^\n]+)/i);
        if (match) {
          const personName = match[1].trim();
          const actionVerb = match[2].trim();
          const actionObject = match[3].trim();
          const fullAction = `${actionVerb} ${actionObject}`;
          
          // Ищем участника по имени и добавляем действие
          const existing = participantActions.find(pa => 
            personName.toLowerCase().includes(pa.name.toLowerCase().split(' ')[0]) ||
            pa.name.toLowerCase().includes(personName.toLowerCase().split(' ')[0])
          );
          if (existing && !existing.action) {
            existing.action = fullAction;
          } else if (!existing) {
            participantActions.push({ name: personName, action: fullAction });
          }
        }
      }
    }
    
    // Если есть общее действие и участники без индивидуальных действий
    if (action) {
      for (const pa of participantActions) {
        if (!pa.action) {
          pa.action = action;
        }
      }
    }

    // Формируем строку участников с их действиями
    const participants = participantActions.length > 0
      ? participantActions.map(pa => pa.action ? `${pa.name} (${pa.action})` : pa.name).join(', ')
      : participantsRaw;

    results.push({ 
      id: `S${i + 1}`, 
      label, 
      description,
      participants,
      role,
      product
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

  // Product Requirements
  {
     const reqs = grabKey('Требования к продукту') || grabKey('Требования');
     if (reqs) patch.productRequirements = reqs;
  }

  // Product Artifacts
  {
     const artifacts = grabKey('Документы продукта') || grabKey('Артефакты') || grabKey('Выходные документы');
     if (artifacts) patch.productArtifacts = artifacts;
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
    const existingNodes = Array.isArray(base.graph?.nodes) ? base.graph!.nodes! : [];
    const patchNodes = Array.isArray(patch.graph.nodes) ? patch.graph.nodes : [];
    
    // Merge nodes: update existing by id, add new ones
    const nodeMap = new Map<string, any>();
    
    // Add existing nodes
    for (const node of existingNodes) {
      if (node?.id) {
        nodeMap.set(node.id, node);
      }
    }
    
    // Update/add nodes from patch
    for (const node of patchNodes) {
      if (node?.id) {
        nodeMap.set(node.id, node); // This replaces if exists, adds if new
      }
    }
    
    const mergedNodes = Array.from(nodeMap.values());
    
    // Merge edges: keep existing + add new (avoid duplicates)
    const existingEdges = Array.isArray(base.graph?.edges) ? base.graph!.edges! : [];
    const patchEdges = Array.isArray(patch.graph.edges) ? patch.graph.edges : [];
    const edgeSet = new Set<string>();
    const mergedEdges: any[] = [];
    
    for (const edge of [...existingEdges, ...patchEdges]) {
      if (edge?.from && edge?.to) {
        const key = `${edge.from}->${edge.to}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          mergedEdges.push(edge);
        }
      }
    }
    
    next.graph = {
      layout: patch.graph.layout ?? base.graph?.layout,
      nodes: mergedNodes,
      edges: mergedEdges,
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

export async function POST(request: Request) {
  const body = await request.json();
  const { messages = [], state: prevState = {} } = body;

  if (!messages.length) {
    return new Response(JSON.stringify({ success: true, state: prevState }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const msgs = messages.map((m: any) => ({ role: m.role, content: toText(m) }));
  const lastUserText = msgs.filter((m: any) => m.role === 'user').pop()?.content || '';

  console.log('🔄 Diagram update request:', {
    prevStateExists: !!prevState,
    prevNodesCount: prevState?.graph?.nodes?.length || 0,
    prevNodeIds: prevState?.graph?.nodes?.map((n: any) => n.id).join(', ') || 'none',
    lastMessagePreview: lastUserText.slice(0, 100)
  });

  // Формируем контекст для AI (последние 5 сообщений для экономии токенов)
  const recentMessages = msgs.slice(-5).map((m: any) => {
    const content = clip(m.content, 1000);
    return `${m.role}: ${content}`;
  }).join('\n\n');

  console.log('🔍 Processing message:', lastUserText.slice(0, 200));

  try {
    // Получаем данные от AI в удобном для него формате
    const { object: aiPatch } = await generateObject({
      model,
      schema: ProcessDiagramPatchSchema,
      temperature: 0.1,
      prompt: `CRITICAL: Return ONLY raw JSON. NO markdown blocks.

You are an expert at extracting business process information from dialogues.

CRITICAL INCREMENTAL UPDATE RULES:
- Extract NEW or UPDATED information from the LAST USER MESSAGE ONLY
- CURRENT STATE already contains existing data - you DON'T need to repeat it
- Only return fields that are MENTIONED in the last user message
- DO NOT return nodes that already exist and weren't changed
- If user says "Цель: X" - return ONLY {"goal": "X"}, NO nodes
- If user says "добавь шаг 4" - return ONLY {"graph": {"nodes": [S4]}}, NOT S1-S3
- If user says "измени шаг 2" - return ONLY {"graph": {"nodes": [updated S2]}}, NOT other nodes
- Empty response {} is valid if nothing new to add

EXAMPLES OF CORRECT INCREMENTAL UPDATES:

Example 1 - Adding new step:
CURRENT STATE: has S1, S2, S3
LAST USER MESSAGE: "Шаг 4. Подведение итогов. Подводятся итоги..."
CORRECT OUTPUT: {"graph": {"nodes": [S4], "edges": [{"from": "S3", "to": "S4"}]}}
WRONG OUTPUT: {"graph": {"nodes": [S1, S2, S3, S4], ...}} ← DON'T DO THIS!

Example 2 - Adding goal:
CURRENT STATE: has S1-S4
LAST USER MESSAGE: "Цель: Популяризация..."
CORRECT OUTPUT: {"goal": "Популяризация..."}
WRONG OUTPUT: {"goal": "...", "graph": {"nodes": [S1, S2, S3, S4]}} ← DON'T DO THIS!

Example 3 - Updating one step:
CURRENT STATE: has S1, S2, S3
LAST USER MESSAGE: "Измени шаг 2 - добавь участника"
CORRECT OUTPUT: {"graph": {"nodes": [{"id": "S2", "participants": [...]}]}}
WRONG OUTPUT: {"graph": {"nodes": [S1, updated S2, S3]}} ← DON'T DO THIS!

Example 4 - Deleting a step:
CURRENT STATE: has S1, S2, S3, S4
LAST USER MESSAGE: "Удали шаг 3"
CORRECT OUTPUT: {"graph": {"nodes": [S1, S2, S4]}} ← Return all EXCEPT deleted
NOTE: For deletion, you MUST return all nodes except the deleted one

WHY THIS WORKS:
- CURRENT STATE below shows all existing data (nodes, goal, product, etc.)
- Your patch will be MERGED with CURRENT STATE, not replace it
- Existing nodes/fields stay unless you explicitly override them
- This is INCREMENTAL UPDATE, not full rebuild
- RETURNING ALL NODES = WRONG, RETURN ONLY CHANGED/NEW NODES = CORRECT

EXTRACTION RULES FOR STEP PARTICIPANTS:
1. If participants listed as "Участники: директор, методист" - create separate entry for each
2. If AFTER participant list there are lines with actions like:
   "директор проверяет результат"
   "методист составляет методички"
   MATCH these actions to participants from the list
3. Extract action from parentheses: "директор (проверяет)" → action: "проверяет"
4. Each participant MUST have name and action. If action not specified, use empty string ""
5. If participant has format "должность (ФИО)" extract role and name separately

EXTRACTION RULES FOR STEP PRODUCT:
1. Product is the RESULT of the step
2. Do NOT include participant actions in product
3. Product usually follows "Продукт шага:" or "Создаёт:"

FIELD MAPPING RULES:
- "Цель" or "Цель процесса" → ALWAYS put in "goal" field (separate top-level field, NOT in process.description)
- "Процесс" or "Название процесса" → put in "process.name"
- "Описание процесса" → put in "process.description" ONLY if it describes HOW the process works, NOT the goal
- If user says "Цель: X" → extract X and put in "goal" field
- "Организация" or "Компания" → put in "organization.name"
- "Продукт" or "Итоговый продукт" → put in "product" (top-level, NOT in nodes)
- "Потребители" → put in "consumers"

IMPORTANT: "goal" and "process.description" are DIFFERENT:
- goal = WHY we do this process (цель, желаемый результат)
- process.description = WHAT this process is about (общее описание процесса)

EXAMPLE:
User says: "Цель: Популяризация спортивного программирования"
Correct output:
{
  "goal": "Популяризация спортивного программирования",
  "process": { "name": "..." }
}

INCREMENTAL UPDATES:
- You can add just ONE or FEW nodes, not all at once
- EXISTING nodes will be preserved - only add/update what user mentions
- If user says "добавь шаг 4" - add ONLY S4, existing S1, S2, S3 will remain
- If user says "измени шаг 2" - update ONLY S2, others will remain
- If user says "удали шаг 3" - return all nodes EXCEPT S3
- You can add just organization info, or just process name, or just goal
- ALL FIELDS ARE OPTIONAL - extract only what user mentioned

SPECIAL NODE TYPES:
- If user mentions "процесс пользователя" or describes what user does, create a node with type="user-process"
- This node should be placed above regular steps (id="USER_PROCESS_1", etc.)

EDGE VALIDATION:
- NEVER create edges with null/undefined source or target
- Only create edges between existing nodes
- Format: {from: "S1", to: "S2"}

===== CURRENT STATE (ALREADY IN DATABASE - DON'T REPEAT THIS DATA!) =====
${JSON.stringify(prevState, null, 2)}

EXISTING NODES: ${prevState?.graph?.nodes?.map((n: any) => n.id).join(', ') || 'NONE'}
↑↑↑ THESE NODES ALREADY EXIST - DO NOT RETURN THEM UNLESS YOU'RE UPDATING THEM! ↑↑↑
===== END OF CURRENT STATE =====

RECENT MESSAGES (for context only):
${recentMessages}

===== LAST USER MESSAGE (extract ONLY from this) =====
${lastUserText}
===== END OF LAST USER MESSAGE =====

CRITICAL JSON STRUCTURE REQUIREMENTS:
- graph.layout MUST be "template-v1"
- Each node MUST have: id, label, description, participants (as ARRAY of objects), product
- participants MUST be an array of objects with structure: [{name: "...", role: "...", action: "..."}]
- LABEL EXTRACTION RULES:
  * If user writes "Шаг 4. Проведение конкурса..." → extract label: "Проведение конкурса..."
  * Take the text AFTER "Шаг N." as the label
  * If no label after "Шаг N." or label not mentioned at all, use "Шаг N"
- If description not mentioned, summarize the step in 1-2 sentences
- If product not mentioned, use empty string ""
- Extract ALL fields mentioned: organization, process, goal, product, consumers, boundaries
- Create edges: S1→S2, S2→S3, etc.
- Return ONLY JSON object starting with { and ending with }

CORRECT participants format:
"participants": [
  {"name": "Ищенко Р.В.", "role": "директор", "action": "проверяет финальный результат"},
  {"name": "", "role": "методист", "action": "составляет методички"}
]

WRONG participants format:
"participants": "Ищенко Р.В. (проверяет финальный результат), методист (составляет методички)"

Extract the information:`,
    });

    console.log('✅ AI extracted patch:', JSON.stringify(aiPatch, null, 2));
    console.log('📝 Patch analysis:', {
      hasGraph: !!aiPatch.graph,
      patchNodesCount: aiPatch.graph?.nodes?.length || 0,
      patchNodeIds: aiPatch.graph?.nodes?.map((n: any) => n.id).join(', ') || 'none',
      hasGoal: !!aiPatch.goal,
      hasProduct: !!aiPatch.product,
      hasOrganization: !!aiPatch.organization,
    });

    // Конвертируем AI-формат в ProcessDiagramState формат
    const patch: Partial<ProcessDiagramState> = {
      organization: aiPatch.organization,
      owner: aiPatch.owner,
      process: aiPatch.process,
      goal: aiPatch.goal,
      product: aiPatch.product,
      boundaries: aiPatch.boundaries,
    };

    // Конвертируем consumers: string | string[] → string[]
    if (aiPatch.consumers) {
      if (Array.isArray(aiPatch.consumers)) {
        patch.consumers = aiPatch.consumers.filter(Boolean);
      } else {
        const consumersArray = String(aiPatch.consumers)
          .split(',')
          .map(c => c.trim())
          .filter(Boolean);
        patch.consumers = consumersArray;
      }
    }

    // Конвертируем graph.nodes: формат AI → формат ProcessDiagramState
    if (aiPatch.graph?.nodes) {
      // Валидируем edges: удаляем те, у которых нет source или target
      const validEdges = (aiPatch.graph.edges || []).filter(edge => {
        const hasValidNodes = edge.from && edge.to;
        if (!hasValidNodes) {
          console.warn('⚠️ Skipping invalid edge:', edge);
          return false;
        }
        return true;
      });

      patch.graph = {
        layout: 'template-v1',
        nodes: aiPatch.graph.nodes.map(aiNode => {
          // Форматируем participants: массив объектов → строка для совместимости
          const participantsStr = aiNode.participants
            .map(p => p.action ? `${p.name} (${p.action})` : p.name)
            .join(', ');

          // Формируем details в строковом формате как в вашем оригинальном коде
          const detailsParts: string[] = [];
          
          if (aiNode.description) {
            detailsParts.push(`Описание: ${aiNode.description}`);
          }
          
          if (participantsStr) {
            detailsParts.push(`Участники: ${participantsStr}`);
          }
          
          // Добавляем роль первого участника если есть
          const firstRole = aiNode.participants[0]?.role;
          if (firstRole) {
            detailsParts.push(`Должность: ${firstRole}`);
          }
          
          if (aiNode.product) {
            detailsParts.push(`Продукт: ${aiNode.product}`);
          }

          const details = detailsParts.join('\n');

          return {
            id: aiNode.id,
            label: aiNode.label,
            description: aiNode.description,
            participants: participantsStr,
            role: firstRole || '',
            product: aiNode.product,
            details, // добавляем для совместимости
            type: aiNode.id?.startsWith('USER_PROCESS') ? 'user-process' : 'process',
          };
        }),
        edges: validEdges,
      };
    }

    const merged = mergeState(prevState, patch);
    
    console.log('📊 Merge result:', {
      prevNodesCount: prevState?.graph?.nodes?.length || 0,
      patchNodesCount: patch.graph?.nodes?.length || 0,
      mergedNodesCount: merged.graph?.nodes?.length || 0,
      nodeIds: merged.graph?.nodes?.map(n => n.id).join(', ') || 'none'
    });

    // Собираем всех участников из всех шагов для отображения в списке
    // ВАЖНО: мержим с существующими участниками, не перезаписываем
    const allParticipants = new Map<string, { role?: string; name: string; fullName?: string }>();
    
    // Сначала добавляем существующих участников из merged state
    if (merged.participants && Array.isArray(merged.participants)) {
      for (const p of merged.participants) {
        const name = p.name || p.fullName || '';
        if (!name) continue;
        const key = `${p.role || ''}_${name}`.toLowerCase();
        if (!allParticipants.has(key)) {
          allParticipants.set(key, {
            role: p.role ?? undefined,
            name,
            fullName: p.fullName ?? undefined,
          });
        }
      }
    }
    
    // Затем добавляем новых участников из PATCH (только если AI вернул новые узлы)
    if (aiPatch.graph?.nodes) {
      for (const node of aiPatch.graph.nodes) {
        for (const participant of node.participants) {
          // Парсим формат "должность (ФИО)" или просто "должность" или "ФИО"
          const match = participant.name.match(/^(.+?)\s*\((.+?)\)$/);
          if (match) {
            // Формат "должность (ФИО)"
            const role = match[1].trim();
            const fullName = match[2].trim();
            const key = `${role}_${fullName}`.toLowerCase();
            if (!allParticipants.has(key)) {
              allParticipants.set(key, { role, fullName, name: participant.name });
            }
          } else {
            // Простой формат - просто имя или должность
            const key = participant.name.toLowerCase();
            if (!allParticipants.has(key)) {
              allParticipants.set(key, {
                role: participant.role ?? undefined,
                name: participant.name,
                fullName: participant.name,
              });
            }
          }
        }
      }
    }

    // Обновляем список участников только если были изменения
    if (aiPatch.graph?.nodes && allParticipants.size > 0) {
      merged.participants = Array.from(allParticipants.values());
    }

    // Применяем к DrawIO XML если нужно
    if (merged.rawDrawioXml && patch.graph?.nodes) {
      merged.rawDrawioXml = applyTextToDrawioXml(
        merged.rawDrawioXml, 
        merged, 
        patch.graph.nodes
      );
    }

    console.log('✅ Returning merged state:', {
      nodesCount: merged.graph?.nodes?.length || 0,
      nodeIds: merged.graph?.nodes?.map((n: any) => n.id).join(', ') || 'none',
      hasGoal: !!merged.goal,
      hasParticipants: !!merged.participants?.length
    });

    return new Response(JSON.stringify({ 
      success: true, 
      state: merged,
      steps: merged.graph?.nodes || [],  // Return ALL nodes from merged state, not just patch
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (e) {
    console.error('❌ AI agent failed:', e);
    
    // Fallback на пустой ответ
    return new Response(JSON.stringify({ 
      success: false, 
      error: String(e),
      state: prevState,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}