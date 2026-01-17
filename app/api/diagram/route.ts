import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateObject } from 'ai';
import { z } from 'zod';
import type { ProcessDiagramState } from '@/lib/document/types';

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

const model = openrouter.chat('xiaomi/mimo-v2-flash:free');

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

function heuristicPatchFromText(textRaw: string): Partial<ProcessDiagramState> {
  const text = String(textRaw || '').replace(/\r\n?/g, '\n').trim();
  const t = text.toLowerCase();
  const patch: Partial<ProcessDiagramState> = {};

  // Owner full name
  // Examples: "Меня зовут Иванов Иван Иванович"; "Меня зовут ... , я ..."
  {
    const m = text.match(/\bменя\s+зовут\s+([^\n,.]+?)(?:\s*,|\s*\.|\s*$)/i);
    if (m?.[1]) {
      patch.owner = { ...(patch.owner || {}), fullName: normalize(m[1]) };
    }
  }

  // Position (common Russian roles). Keep it simple.
  {
    const m = text.match(/\bя\s+(директор|руководитель|менеджер|куратор|координатор|специалист|администратор)\b/i);
    if (m?.[1]) {
      patch.owner = { ...(patch.owner || {}), position: normalize(m[1]) };
    }
  }

  // Organization name: after position or explicit "в компании" / "в организации".
  {
    const m1 = text.match(/\bя\s+(?:директор|руководитель|менеджер|куратор|координатор|специалист|администратор)\s+([^\n.]+?)(?:\.|\n|$)/i);
    const m2 = text.match(/\bв\s+(?:компании|организации)\s+([^\n.]+?)(?:\.|\n|$)/i);
    const name = normalize(m1?.[1] || m2?.[1]);
    if (name) {
      patch.organization = { ...(patch.organization || {}), name };
    }
  }

  // Organization activity: "мы занимаемся ..." / "мы работаем ..."
  {
    const m = text.match(/\bмы\s+(?:занимаемся|работаем)\s+([^\n.]+?)(?:\.|\n|$)/i);
    if (m?.[1]) {
      patch.organization = { ...(patch.organization || {}), activity: normalize(m[1]) };
    }
  }

  // Process name/description: "мне необходимо описать ..." or "я хочу описать ..."
  {
    const m = text.match(/\b(?:мне\s+необходимо|я\s+хочу)\s+описать\s+([^\n.]+?)(?:\.|\n|$)/i);
    if (m?.[1]) {
      const desc = normalize(m[1]);
      patch.process = { ...(patch.process || {}), description: desc };
      // If the phrase starts with "конкурс" / "процесс" use it as a name.
      const short = desc ? desc.split(/\s*(?:,|\(|—|-)\s*/)[0] : null;
      if (short && short.length <= 140) {
        patch.process = { ...(patch.process || {}), name: short };
      }
    }
  }

  // Goal: "Цель ... — ..."
  {
    const m = text.match(/\bцель[^\n—-]*[—-]\s*([^\n.]+?)(?:\.|\n|$)/i);
    if (m?.[1]) patch.goal = normalize(m[1]);
  }

  // Product/result: "Конечный результат — ..."
  {
    const m = text.match(/\bконечн(?:ый|ая)\s+результат[^\n—-]*[—-]\s*([^\n.]+?)(?:\.|\n|$)/i);
    if (m?.[1]) patch.product = normalize(m[1]);
  }

  // Boundaries: very rough extraction for explicit "начало"/"конец".
  if (t.includes('начало') || t.includes('конец')) {
    const start = normalize((text.match(/\bначал[ао][^\n—-]*[—-]\s*([^\n.]+?)(?:\.|\n|$)/i) || [])[1]);
    const end = normalize((text.match(/\bконец[^\n—-]*[—-]\s*([^\n.]+?)(?:\.|\n|$)/i) || [])[1]);
    if (start || end) patch.boundaries = { ...(patch.boundaries || {}), start, end };
  }

  return patch;
}

function mergeState(prev: ProcessDiagramState | null, patch: Partial<ProcessDiagramState>): ProcessDiagramState {
  const base: ProcessDiagramState = prev ? { ...prev } : {};
  const next: ProcessDiagramState = { ...base };

  if (patch.organization) {
    next.organization = {
      ...(base.organization || {}),
      ...(patch.organization || {}),
    };
  }
  if (patch.process) {
    next.process = {
      ...(base.process || {}),
      ...(patch.process || {}),
    };
  }
  if (patch.owner) {
    next.owner = {
      ...(base.owner || {}),
      ...(patch.owner || {}),
    };
  }
  if (patch.boundaries) {
    next.boundaries = {
      ...(base.boundaries || {}),
      ...(patch.boundaries || {}),
    };
  }

  if (patch.goal !== undefined) next.goal = patch.goal;
  if (patch.product !== undefined) next.product = patch.product;

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

  if (patch.graph && (Array.isArray(patch.graph.nodes) || Array.isArray(patch.graph.edges))) {
    next.graph = {
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
      nodes,
      edges: patch.graph.edges,
    },
  } as Partial<ProcessDiagramState>;
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

  if (!lastUserText.trim()) {
    return new Response(JSON.stringify({ success: true, state: mergeState(prevState, {}) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Heuristic baseline patch from the last user message.
  const heuristic = heuristicPatchFromText(lastUserText);

  try {
    const { object: rawPatch } = await generateObject({
      model,
      temperature: 0.1,
      schema: PatchSchema,
      prompt: `Ты отдельный агент, который обновляет состояние схемы бизнес-процесса на основе диалога.

ТЕБЕ ДАДУТ:
1) Предыдущее состояние (JSON)
2) Последние сообщения диалога

НУЖНО:
- Извлечь только факты о процессе (организация, владелец, цель, продукт, потребители, границы)
- ПО ВОЗМОЖНОСТИ сформировать схему процесса в виде графа (nodes/edges) по содержанию диалога
- Делай дополнения «рядом» с шагом: добавляй details к существующему узлу, а не новые узлы
- У каждого узла ДОЛЖНО быть details (1–2 предложения). Если данных мало — сформулируй краткое описание по контексту.
- Если что-то поменялось — корректируй существующие узлы (label/details/edges), можно пересобрать граф целиком
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
- Верни строго JSON (без markdown)
- Используй эвристику как подсказку, но можешь уточнять/исправлять
- Если нашёл новые факты — верни их. Если фактов нет — {}
 - Если создаёшь graph, задай уникальные id (например, N1, N2, N3)
- Старайся держать граф компактным: 5–10 ключевых узлов, остальное в details

Верни только валидный JSON.`,
    });

    const patch = normalizeGraph(rawPatch as Partial<ProcessDiagramState>);
    // Merge: heuristic baseline first, then model patch (model can override).
    const merged = mergeState(mergeState(prevState, heuristic), patch);
    return new Response(JSON.stringify({ success: true, state: merged }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('diagram agent failed', e);
    // Fall back to heuristic-only update so the UI still progresses.
    const merged = mergeState(prevState, heuristic);
    return new Response(JSON.stringify({ success: true, state: merged }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
