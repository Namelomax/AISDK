'use client';

import { Check, Copy, Download, RefreshCcw } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';

type LocalFlowDiagramProps = {
  xml: string;
  className?: string;
  ariaLabel?: string;
  onNodeClick?: (nodeId: string) => void;
  activeNodeId?: string | null;
  activeNodeDetails?: { title: string; body: string } | null;
  onDismissDetails?: () => void;
};

type ViewportTransform = {
  x: number;
  y: number;
  scale: number;
};

type CameraViewBox = {
  x: number;
  y: number;
  w: number;
  h: number;
};

type Vertex = {
  id: string;
  value: string;
  style: string;
  parentId: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type Edge = {
  id: string;
  style: string;
  source?: string;
  target?: string;
  sourcePoint?: { x: number; y: number } | null;
  targetPoint?: { x: number; y: number } | null;
};

type DiagramModel = {
  vertices: Vertex[];
  edges: Edge[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function decodeHtmlToText(input: string) {
  const s = String(input || '')
    .replace(/&amp;lt;br\s*\/?&amp;gt;/gi, '\n')
    .replace(/&lt;br\s*\/?&gt;/gi, '\n');
  if (!s) return '';
  // draw.io values often contain <br/> and entities.
  const withBreaks = s.replace(/<br\s*\/?>/gi, '\n');
  try {
    const doc = new DOMParser().parseFromString(`<div>${withBreaks}</div>`, 'text/html');
    return (doc.body.textContent || '').trim();
  } catch {
    return withBreaks.replace(/<[^>]*>/g, '').trim();
  }
}

function wrapTextLines(text: string, maxChars: number) {
  const normalized = String(text || '').replace(/\\n|\/\/n/g, '\n');
  const rawLines = normalized.split(/\r\n?|\n/g);
  const lines: string[] = [];
  const minChars = 6;
  const clampChars = (n: number) => Math.max(minChars, n);

  const pushChunkedWord = (word: string, limit: number) => {
    let remaining = word;
    while (remaining.length > limit) {
      lines.push(remaining.slice(0, limit));
      remaining = remaining.slice(limit);
    }
    return remaining;
  };

  for (const raw of rawLines) {
    const t = raw.trim();
    if (!t) {
      lines.push('');
      continue;
    }

    const words = t.split(/\s+/g);
    let current = '';
    const limit = clampChars(maxChars);

    for (const w of words) {
      if (!current) {
        if (w.length > limit) {
          const rest = pushChunkedWord(w, limit);
          current = rest;
        } else {
          current = w;
        }
        continue;
      }

      if ((current + ' ' + w).length <= limit) {
        current += ' ' + w;
      } else {
        lines.push(current);
        current = '';
        if (w.length > limit) {
          const rest = pushChunkedWord(w, limit);
          current = rest;
        } else {
          current = w;
        }
      }
    }
    if (current) lines.push(current);
  }

  // Trim trailing empty lines
  while (lines.length > 0 && !lines[lines.length - 1]?.trim()) lines.pop();
  return lines;
}

function wrapTextLinesCone(text: string, maxChars: number, step: number) {
  const normalized = String(text || '').replace(/\\n|\/\/n/g, '\n');
  const rawLines = normalized.split(/\r\n?|\n/g);
  const lines: string[] = [];
  const minChars = 6;
  let lineIndex = 0;

  const getMaxChars = () => Math.max(minChars, maxChars - step * lineIndex);

  const pushChunkedWord = (word: string) => {
    let remaining = word;
    while (remaining.length > 0) {
      const limit = getMaxChars();
      if (remaining.length <= limit) return remaining;
      lines.push(remaining.slice(0, limit));
      remaining = remaining.slice(limit);
      lineIndex += 1;
    }
    return '';
  };

  for (const raw of rawLines) {
    const t = raw.trim();
    if (!t) {
      lines.push('');
      lineIndex += 1;
      continue;
    }

    const words = t.split(/\s+/g);
    let current = '';
    for (const w of words) {
      const limit = getMaxChars();
      if (!current) {
        if (w.length > limit) {
          const rest = pushChunkedWord(w);
          current = rest;
        } else {
          current = w;
        }
        continue;
      }
      if ((current + ' ' + w).length <= limit) {
        current += ' ' + w;
      } else {
        lines.push(current);
        lineIndex += 1;
        current = '';
        if (w.length > limit) {
          const rest = pushChunkedWord(w);
          current = rest;
        } else {
          current = w;
        }
      }
    }
    if (current) {
      lines.push(current);
      lineIndex += 1;
    }
  }

  while (lines.length > 0 && !lines[lines.length - 1]?.trim()) lines.pop();
  return lines;
}

type StepDetails = {
  description: string;
  participants: string;
  participantsList: Array<{ role: string; name: string; raw: string }>;
  role: string;
  name: string;
  product: string;
};

function parseParticipantsList(input: string) {
  const raw = String(input || '').trim();
  if (!raw) return [] as Array<{ role: string; name: string; raw: string }>;
  const parts = raw.split(/\s*;\s*|\s*\n\s*|\s*\|\s*/g).filter(Boolean);
  const list = parts.length ? parts : raw.split(/\s*,\s*/g).filter(Boolean);
  return list.map((item) => {
    const seg = item.trim();
    const split = seg.split(/\s*[—-]\s*/g);
    if (split.length >= 2) {
      return { role: split[0].trim(), name: split.slice(1).join(' - ').trim(), raw: seg };
    }
    return { role: '', name: seg, raw: seg };
  });
}

function parseStepDetails(input: string): StepDetails {
  const raw = decodeHtmlToText(input || '').trim();
  if (!raw) {
    return { description: '', participants: '', participantsList: [], role: '', name: '', product: '' };
  }

  const lines = raw.split(/\r\n?|\n/g).map((l) => l.trim()).filter(Boolean);
  let descriptionParts: string[] = [];
  let participants = '';
  let role = '';
  let name = '';
  let product = '';

  const extractValue = (lineText: string) => lineText.replace(/^[^:\-—]+[:\-—]\s*/g, '').trim();
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith('участники') || lower.startsWith('участник')) {
      participants = extractValue(line);
      continue;
    }
    if (lower.startsWith('должность') || lower.startsWith('роль') || lower.startsWith('role') || lower.startsWith('position')) {
      role = extractValue(line);
      continue;
    }
    if (lower.startsWith('фио') || lower.startsWith('имя') || lower.startsWith('name')) {
      name = extractValue(line);
      continue;
    }
    if (lower.startsWith('продукт') || lower.startsWith('результат') || lower.startsWith('output')) {
      product = extractValue(line);
      continue;
    }
    descriptionParts.push(line);
  }

  const description = descriptionParts.join(' ').trim() || raw;
  const participantsList = parseParticipantsList(participants);
  return { description, participants, participantsList, role, name, product };
}

function parseMxfileXml(xml: string): { vertices: Vertex[]; edges: Edge[]; bounds: { minX: number; minY: number; maxX: number; maxY: number } } {
  const empty = { vertices: [], edges: [], bounds: { minX: 0, minY: 0, maxX: 800, maxY: 600 } };
  const trimmed = String(xml || '').trim();
  if (!trimmed) return empty;

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(trimmed, 'text/xml');
  } catch {
    return empty;
  }

  // Try to locate <mxGraphModel>.
  const mxGraphModel = doc.querySelector('mxGraphModel');
  if (!mxGraphModel) return empty;

  const cellEls = Array.from(mxGraphModel.querySelectorAll('mxCell'));
  const vertices: Vertex[] = [];
  const edges: Edge[] = [];

  for (const el of cellEls) {
    const id = (el.getAttribute('id') || '').trim();
    if (!id) continue;

    const isVertex = el.getAttribute('vertex') === '1';
    const isEdge = el.getAttribute('edge') === '1';
    const style = el.getAttribute('style') || '';

    if (isVertex) {
      const parentId = (el.getAttribute('parent') || '1').trim() || '1';
      const geom = el.querySelector('mxGeometry');
      const x = Number(geom?.getAttribute('x') || '0');
      const y = Number(geom?.getAttribute('y') || '0');
      const width = Number(geom?.getAttribute('width') || '0');
      const height = Number(geom?.getAttribute('height') || '0');
      const value = el.getAttribute('value') || '';

      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) continue;
      vertices.push({ id, value, style, parentId, x, y, width, height });
    }

    if (isEdge) {
      const source = (el.getAttribute('source') || '').trim() || undefined;
      const target = (el.getAttribute('target') || '').trim() || undefined;
      const geom = el.querySelector('mxGeometry');
      const spEl = geom?.querySelector('mxPoint[as="sourcePoint"]');
      const tpEl = geom?.querySelector('mxPoint[as="targetPoint"]');
      const sourcePoint = spEl
        ? {
            x: Number(spEl.getAttribute('x') || '0'),
            y: Number(spEl.getAttribute('y') || '0'),
          }
        : null;
      const targetPoint = tpEl
        ? {
            x: Number(tpEl.getAttribute('x') || '0'),
            y: Number(tpEl.getAttribute('y') || '0'),
          }
        : null;
      if (!source && !target && !sourcePoint && !targetPoint) continue;
      edges.push({ id, style, source, target, sourcePoint, targetPoint });
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const v of vertices) {
    minX = Math.min(minX, v.x);
    minY = Math.min(minY, v.y);
    maxX = Math.max(maxX, v.x + v.width);
    maxY = Math.max(maxY, v.y + v.height);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return empty;
  }

  const pad = 30;
  return {
    vertices,
    edges,
    bounds: {
      minX: minX - pad,
      minY: minY - pad,
      maxX: maxX + pad,
      maxY: maxY + pad,
    },
  };
}

function buildWorldVertices(vertices: Vertex[]) {
  const byId = new Map(vertices.map((v) => [v.id, v] as const));
  const memo = new Map<string, { x: number; y: number }>();

  const getWorldPos = (id: string): { x: number; y: number } => {
    const cached = memo.get(id);
    if (cached) return cached;
    const v = byId.get(id);
    if (!v) {
      const zero = { x: 0, y: 0 };
      memo.set(id, zero);
      return zero;
    }

    const parentId = (v.parentId || '1').trim();
    if (!parentId || parentId === '1' || parentId === '0') {
      const base = { x: v.x, y: v.y };
      memo.set(id, base);
      return base;
    }

    const p = byId.get(parentId);
    if (!p) {
      const base = { x: v.x, y: v.y };
      memo.set(id, base);
      return base;
    }

    const pw = getWorldPos(parentId);
    const out = { x: pw.x + v.x, y: pw.y + v.y };
    memo.set(id, out);
    return out;
  };

  return vertices.map((v) => {
    const w = getWorldPos(v.id);
    return { ...v, x: w.x, y: w.y };
  });
}

function computeBounds(vertices: Vertex[]) {
  if (!vertices.length) return { minX: 0, minY: 0, maxX: 800, maxY: 600 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const v of vertices) {
    minX = Math.min(minX, v.x);
    minY = Math.min(minY, v.y);
    maxX = Math.max(maxX, v.x + v.width);
    maxY = Math.max(maxY, v.y + v.height);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { minX: 0, minY: 0, maxX: 800, maxY: 600 };
  }

  const pad = 30;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

function unionBounds(a: { minX: number; minY: number; maxX: number; maxY: number }, b: { minX: number; minY: number; maxX: number; maxY: number }) {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function rectUnion(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.width, b.x + b.width);
  const maxY = Math.max(a.y + a.height, b.y + b.height);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function updateXmlWithVertexPositions(xml: string, vertices: Vertex[]) {
  const trimmed = String(xml || '').trim();
  if (!trimmed) return '';

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(trimmed, 'text/xml');
  } catch {
    return trimmed;
  }

  // If the XML is invalid, DOMParser can return <parsererror/>.
  if (doc.getElementsByTagName('parsererror').length) return trimmed;

  const byId = new Map(vertices.map((v) => [v.id, v] as const));
  const cellEls = Array.from(doc.querySelectorAll('mxCell[vertex="1"]'));

  for (const cell of cellEls) {
    const id = (cell.getAttribute('id') || '').trim();
    const v = id ? byId.get(id) : undefined;
    if (!v) continue;
    const geom = cell.querySelector('mxGeometry');
    if (!geom) continue;
    geom.setAttribute('x', String(Math.round(v.x)));
    geom.setAttribute('y', String(Math.round(v.y)));
  }

  const serialized = new XMLSerializer().serializeToString(doc);
  // Keep a standard XML header for draw.io import friendliness.
  return serialized.startsWith('<?xml') ? serialized : `<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`;
}

function pickVertexKind(style: string) {
  const s = String(style || '').toLowerCase();
  if (s.includes('shape=terminator')) return 'terminator' as const;
  if (s.includes('shape=umlactor')) return 'actor' as const;
  if (s.includes('shape=isocube2')) return 'cube' as const;
  if (/(^|;)ellipse(;|$)/.test(s) || s.includes('ellipse')) return 'ellipse' as const;
  if (/(^|;)text(;|$)/.test(s) || s.includes('text')) return 'text' as const;
  return 'rect' as const;
}

function parseStyle(style: string) {
  const raw = String(style || '');
  const map = new Map<string, string>();
  for (const part of raw.split(';')) {
    const t = part.trim();
    if (!t) continue;
    const eq = t.indexOf('=');
    if (eq > 0) {
      const k = t.slice(0, eq).trim().toLowerCase();
      const v = t.slice(eq + 1).trim();
      if (k) map.set(k, v);
    } else {
      map.set(t.toLowerCase(), '1');
    }
  }
  return map;
}

function isGroupVertex(v: Vertex) {
  const m = parseStyle(v.style);
  return m.get('group') === '1' || m.get('container') === '1' || m.has('group');
}

function hasOwnerIcon(v: Vertex) {
  const m = parseStyle(v.style);
  return m.get('ownericon') === '1' || m.has('ownericon');
}

function isDetailFrame(v: Vertex) {
  const m = parseStyle(v.style);
  return m.get('detailframe') === '1' || m.has('detailframe');
}

function getSpacingLeft(style: string) {
  const m = parseStyle(style);
  const v = m.get('spacingleft');
  const n = v ? Number(v) : 0;
  return Number.isFinite(n) ? n : 0;
}

function getFontSize(style: string, fallback = 12) {
  const m = parseStyle(style);
  const v = m.get('fontsize');
  const n = v ? Number(v) : fallback;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function isHiddenVertex(v: Vertex) {
  const m = parseStyle(v.style);
  const opacityRaw = m.get('opacity');
  const opacity = opacityRaw ? Number(opacityRaw) : 1;
  if (Number.isFinite(opacity) && opacity <= 0) return true;
  return m.get('hidden') === '1' || m.has('hidden');
}

function fitTextInBox(text: string, width: number, height: number, baseFontSize: number) {
  const minFontSize = 6;
  let fontSize = Math.max(minFontSize, Math.round(baseFontSize));
  let lineHeight = Math.max(4, Math.round(fontSize * 1.2));
  let maxChars = Math.max(6, Math.floor(width / Math.max(1, fontSize * 0.4)));
  let lines = wrapTextLines(text, maxChars);

  const fits = () => {
    const maxLines = Math.max(1, Math.floor(height / lineHeight));
    return lines.length <= maxLines;
  };

  while (!fits() && fontSize > minFontSize) {
    fontSize = Math.max(minFontSize, fontSize - 1);
    lineHeight = Math.max(4, Math.round(fontSize * 1.2));
    maxChars = Math.max(6, Math.floor(width / Math.max(1, fontSize * 0.6)));
    lines = wrapTextLines(text, maxChars);
  }

  const maxLines = Math.max(1, Math.floor(height / lineHeight));
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    const last = lines[lines.length - 1] || '';
    lines[lines.length - 1] = last.length > 1 ? `${last.slice(0, -1)}…` : `${last}…`;
  }

  return { lines, fontSize, lineHeight };
}

function isStepNodeId(id: string) {
  const upper = id.toUpperCase();
  return (
    upper.startsWith('STEP_') ||
    ['N9EBFPKTY8XSMP5IMMAE-28', 'N9EBFPKTY8XSMP5IMMAE-29', 'N9EBFPKTY8XSMP5IMMAE-30', 'N9EBFPKTY8XSMP5IMMAE-31'].includes(upper)
  );
}

function fitRectToAspect(rect: { x: number; y: number; width: number; height: number }, aspect: number) {
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  const a = w / h;
  if (!Number.isFinite(aspect) || aspect <= 0) return rect;

  if (a < aspect) {
    // Too tall -> expand width
    const newW = h * aspect;
    const pad = (newW - w) / 2;
    return { x: rect.x - pad, y: rect.y, width: newW, height: h };
  }
  if (a > aspect) {
    // Too wide -> expand height
    const newH = w / aspect;
    const pad = (newH - h) / 2;
    return { x: rect.x, y: rect.y - pad, width: w, height: newH };
  }
  return rect;
}

function scaleRectAroundCenter(rect: { x: number; y: number; width: number; height: number }, factor: number) {
  const f = Math.max(0.05, factor);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const w = rect.width * f;
  const h = rect.height * f;
  return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
}

function getCenter(v: Vertex) {
  return { x: v.x + v.width / 2, y: v.y + v.height / 2 };
}

function anchorOnRect(v: Vertex, towardX: number, towardY: number) {
  const c = getCenter(v);
  let dx = towardX - c.x;
  let dy = towardY - c.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) {
    dx = 1;
    dy = 0;
  }

  const halfW = v.width / 2;
  const halfH = v.height / 2;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);

  const tx = adx < 1e-9 ? Infinity : halfW / adx;
  const ty = ady < 1e-9 ? Infinity : halfH / ady;
  const t = Math.min(tx, ty);

  return { x: c.x + dx * t, y: c.y + dy * t };
}

function anchorOnEllipse(v: Vertex, towardX: number, towardY: number) {
  const c = getCenter(v);
  let dx = towardX - c.x;
  let dy = towardY - c.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) {
    dx = 1;
    dy = 0;
  }

  const rx = Math.max(1e-6, v.width / 2);
  const ry = Math.max(1e-6, v.height / 2);

  const denom = Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
  const t = denom < 1e-9 ? 1 : 1 / denom;

  return { x: c.x + dx * t, y: c.y + dy * t };
}

function getAnchorPoint(v: Vertex, towardX: number, towardY: number) {
  const kind = pickVertexKind(v.style);
  if (kind === 'ellipse') return anchorOnEllipse(v, towardX, towardY);
  // For rect/terminator/text, a rectangle boundary is a good approximation.
  return anchorOnRect(v, towardX, towardY);
}

function getEdgeEndpoints(
  edge: Edge,
  byId: Map<string, Vertex>
): { x1: number; y1: number; x2: number; y2: number } | null {
  const s = edge.source ? byId.get(edge.source) : undefined;
  const t = edge.target ? byId.get(edge.target) : undefined;

  if (s && t) {
    const sc = getCenter(s);
    const tc = getCenter(t);
    const a1 = getAnchorPoint(s, tc.x, tc.y);
    const a2 = getAnchorPoint(t, sc.x, sc.y);
    return { x1: a1.x, y1: a1.y, x2: a2.x, y2: a2.y };
  }

  if (edge.sourcePoint && t) {
    const tc = getCenter(t);
    const a2 = getAnchorPoint(t, edge.sourcePoint.x, edge.sourcePoint.y);
    return { x1: edge.sourcePoint.x, y1: edge.sourcePoint.y, x2: a2.x, y2: a2.y };
  }

  if (edge.targetPoint && s) {
    const sc = getCenter(s);
    const a1 = getAnchorPoint(s, edge.targetPoint.x, edge.targetPoint.y);
    return { x1: a1.x, y1: a1.y, x2: edge.targetPoint.x, y2: edge.targetPoint.y };
  }

  if (edge.sourcePoint && edge.targetPoint) {
    return { x1: edge.sourcePoint.x, y1: edge.sourcePoint.y, x2: edge.targetPoint.x, y2: edge.targetPoint.y };
  }

  return null;
}

export function LocalFlowDiagram({
  xml,
  className,
  ariaLabel,
  onNodeClick,
  activeNodeId,
  activeNodeDetails,
  onDismissDetails,
}: LocalFlowDiagramProps) {
  const DIAGRAM_SCALE = 10;
  const [copied, setCopied] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const [camera, setCamera] = useState<CameraViewBox>({ x: 0, y: 0, w: 800, h: 600 });
  const hasUserTransformRef = useRef(false);
  const cameraAnimRef = useRef<number | null>(null);
  const zoomedStepRef = useRef<string | null>(null);
  const dragState = useRef<{
    active: boolean;
    mode: 'pan' | 'node' | 'group' | null;
    pointerId: number | null;
    lastX: number;
    lastY: number;
    nodeId: string | null;
    nodeStartX: number;
    nodeStartY: number;
  }>({
    active: false,
    mode: null,
    pointerId: null,
    lastX: 0,
    lastY: 0,
    nodeId: null,
    nodeStartX: 0,
    nodeStartY: 0,
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragMovedRef = useRef(false);
  const suppressClickRef = useRef(false);

  const MIN_SCALE = 0.1;
  const MAX_SCALE = 200;
  const DEFAULT_FIT_ZOOM = 0.75;
  const VIEWBOX_MIN = 60;
  const VIEWBOX_MAX = 200000;

  const parsed = useMemo(() => {
    const base = parseMxfileXml(xml);
    const scale = DIAGRAM_SCALE;
    const vertices = base.vertices.map((v) => ({
      ...v,
      x: v.x * scale,
      y: v.y * scale,
      width: v.width * scale,
      height: v.height * scale,
    }));
    const edges = base.edges.map((e) => ({
      ...e,
      sourcePoint: e.sourcePoint
        ? { x: e.sourcePoint.x * scale, y: e.sourcePoint.y * scale }
        : null,
      targetPoint: e.targetPoint
        ? { x: e.targetPoint.x * scale, y: e.targetPoint.y * scale }
        : null,
    }));
    const bounds = computeBounds(vertices);
    return { vertices, edges, bounds } as DiagramModel;
  }, [xml]);

  const [model, setModel] = useState<DiagramModel>(parsed);
  const baseBoundsRef = useRef(parsed.bounds);

  useEffect(() => {
    setModel(parsed);
    baseBoundsRef.current = parsed.bounds;
    // When XML changes from outside, allow auto-fit again.
    hasUserTransformRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xml]);

  const effectiveBounds = useMemo(() => {
    const visible = buildWorldVertices(model.vertices).filter((v) => !isDetailFrame(v));
    const current = computeBounds(visible);
    // Never shrink below the initial bounds to avoid viewBox "jump".
    return unionBounds(baseBoundsRef.current, current);
  }, [model.vertices]);

  const contentViewBox = useMemo(() => {
    const b = effectiveBounds;
    const w = Math.max(1, b.maxX - b.minX);
    const h = Math.max(1, b.maxY - b.minY);
    return { x: b.minX, y: b.minY, w, h };
  }, [effectiveBounds]);

  const verticesById = useMemo(() => {
    const m = new Map<string, Vertex>();
    for (const v of model.vertices) m.set(v.id, v);
    return m;
  }, [model.vertices]);

  const worldVertices = useMemo(() => buildWorldVertices(model.vertices), [model.vertices]);

  const visibleVertices = useMemo(
    () =>
      worldVertices.filter((v) => {
        if (isDetailFrame(v) || isHiddenVertex(v)) return false;
        if (isStepNodeId(v.id) && !decodeHtmlToText(v.value || '').trim()) return false;
        return true;
      }),
    [worldVertices]
  );

  const worldVerticesById = useMemo(() => {
    const m = new Map<string, Vertex>();
    for (const v of worldVertices) m.set(v.id, v);
    return m;
  }, [worldVertices]);

  const visibleVerticesById = useMemo(() => {
    const m = new Map<string, Vertex>();
    for (const v of visibleVertices) m.set(v.id, v);
    return m;
  }, [visibleVertices]);


  const animateCameraTo = (next: CameraViewBox, duration = 260) => {
    if (cameraAnimRef.current) {
      cancelAnimationFrame(cameraAnimRef.current);
      cameraAnimRef.current = null;
    }

    const start = { ...camera };
    const startTime = performance.now();

    const tick = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const x = start.x + (next.x - start.x) * eased;
      const y = start.y + (next.y - start.y) * eased;
      const w = start.w + (next.w - start.w) * eased;
      const h = start.h + (next.h - start.h) * eased;
      setCamera({ x, y, w, h });

      if (t < 1) {
        cameraAnimRef.current = requestAnimationFrame(tick);
      } else {
        cameraAnimRef.current = null;
      }
    };

    cameraAnimRef.current = requestAnimationFrame(tick);
  };

  const resetView = () => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const cw = Math.max(1, rect.width);
    const ch = Math.max(1, rect.height);
    const aspect = cw / ch;

    const margin = 20;
    const base = {
      x: contentViewBox.x - margin,
      y: contentViewBox.y - margin,
      width: contentViewBox.w + margin * 2,
      height: contentViewBox.h + margin * 2,
    };
    const fitted = fitRectToAspect(base, aspect);
    const scaled = scaleRectAroundCenter(fitted, DEFAULT_FIT_ZOOM);
    animateCameraTo({ x: scaled.x, y: scaled.y, w: scaled.width, h: scaled.height });
  };

  const screenToWorld = (clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const cw = Math.max(1, rect.width);
    const ch = Math.max(1, rect.height);
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    return {
      x: camera.x + (px / cw) * camera.w,
      y: camera.y + (py / ch) * camera.h,
    };
  };

  const worldToScreen = (worldX: number, worldY: number) => {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const cw = Math.max(1, rect.width);
    const ch = Math.max(1, rect.height);
    return {
      x: ((worldX - camera.x) / camera.w) * cw,
      y: ((worldY - camera.y) / camera.h) * ch,
      cw,
      ch,
    };
  };

  const zoomToWorldRect = (rect: { x: number; y: number; width: number; height: number }, extraZoom = 1) => {
    const container = containerRef.current;
    if (!container) return;
    const cr = container.getBoundingClientRect();
    const cw = Math.max(1, cr.width);
    const ch = Math.max(1, cr.height);
    const aspect = cw / ch;

    const margin = 24;
    const base = {
      x: rect.x - margin,
      y: rect.y - margin,
      width: rect.width + margin * 2,
      height: rect.height + margin * 2,
    };
    const fitted = fitRectToAspect(base, aspect);
    const scaled = extraZoom !== 1 ? scaleRectAroundCenter(fitted, extraZoom) : fitted;
    hasUserTransformRef.current = true;
    animateCameraTo({ x: scaled.x, y: scaled.y, w: scaled.width, h: scaled.height });
  };

  const zoomToNode = (nodeId: string) => {
    const base = worldVerticesById.get(nodeId);
    if (!base) return;
    const rect = { x: base.x, y: base.y, width: base.width, height: base.height };
    const extraZoom = isStepNodeId(nodeId) ? 0.5 : 0.9;
    zoomToWorldRect(rect, extraZoom);
  };

  useEffect(() => {
    if (hasUserTransformRef.current) return;
    resetView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentViewBox.x, contentViewBox.y, contentViewBox.w, contentViewBox.h]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      if (hasUserTransformRef.current) return;
      resetView();
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      hasUserTransformRef.current = true;
      const rect = el.getBoundingClientRect();
      const cw = Math.max(1, rect.width);
      const ch = Math.max(1, rect.height);
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      // Convert screen point to world point.
      const wx = camera.x + (px / cw) * camera.w;
      const wy = camera.y + (py / ch) * camera.h;

      // Zoom in/out by scaling the viewBox.
      const zoomFactor = e.deltaY > 0 ? 1.2 : 1 / 1.2;
      const nextW = clamp(camera.w * zoomFactor, VIEWBOX_MIN, VIEWBOX_MAX);
      const nextH = clamp(camera.h * zoomFactor, VIEWBOX_MIN, VIEWBOX_MAX);

      const nextX = wx - (px / cw) * nextW;
      const nextY = wy - (py / ch) * nextH;
      setCamera({ x: nextX, y: nextY, w: nextW, h: nextH });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel as any);
  }, [camera]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return;

    // Middle mouse button (wheel press) or right mouse button: pan
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      setIsDragging(true);
      dragMovedRef.current = false;
      dragState.current = {
        active: true,
        mode: 'pan',
        pointerId: e.pointerId,
        lastX: e.clientX,
        lastY: e.clientY,
        nodeId: null,
        nodeStartX: 0,
        nodeStartY: 0,
      };
      hasUserTransformRef.current = true;
      el.setPointerCapture(e.pointerId);
      return;
    }

    // Left mouse button: drag nodes (if pressed on a node)
    if (e.button === 0) {
      const target = e.target as Element | null;
      const nodeEl = target?.closest('[data-node-id]') as Element | null;
      const id = (nodeEl?.getAttribute('data-node-id') || '').trim();
      if (!id) return;

      const vWorld = worldVerticesById.get(id);
      const vLocal = verticesById.get(id);
      if (!vWorld || !vLocal) return;

      const isGroup = isGroupVertex(vWorld);
      if (isGroup) {
        const p = screenToWorld(e.clientX, e.clientY);
        if (!p) return;
        const inHeader =
          p.x >= vWorld.x &&
          p.x <= vWorld.x + vWorld.width &&
          p.y >= vWorld.y &&
          p.y <= vWorld.y + 28;
        if (!inHeader) return;
      }

      e.preventDefault();
      setIsDragging(true);
      dragMovedRef.current = false;
      dragState.current = {
        active: true,
        mode: isGroup ? 'group' : 'node',
        pointerId: e.pointerId,
        lastX: e.clientX,
        lastY: e.clientY,
        nodeId: id,
        nodeStartX: vLocal.x,
        nodeStartY: vLocal.y,
      };
      hasUserTransformRef.current = true;
      el.setPointerCapture(e.pointerId);
      return;
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current.active) return;
    if (dragState.current.pointerId !== e.pointerId) return;

    const dx = e.clientX - dragState.current.lastX;
    const dy = e.clientY - dragState.current.lastY;
    dragState.current.lastX = e.clientX;
    dragState.current.lastY = e.clientY;

    if (Math.abs(dx) + Math.abs(dy) > 2) dragMovedRef.current = true;

    if (dragState.current.mode === 'pan') {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cw = Math.max(1, rect.width);
      const ch = Math.max(1, rect.height);
      // Drag right should move content right => camera left.
      const worldDx = (dx / cw) * camera.w;
      const worldDy = (dy / ch) * camera.h;
      setCamera((c) => ({ x: c.x - worldDx, y: c.y - worldDy, w: c.w, h: c.h }));
      return;
    }

    if (dragState.current.mode === 'node') {
      const id = dragState.current.nodeId;
      if (!id) return;
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cw = Math.max(1, rect.width);
      const ch = Math.max(1, rect.height);
      // Convert screen delta to world delta based on current viewBox.
      const worldDx = (dx / cw) * camera.w;
      const worldDy = (dy / ch) * camera.h;
      dragState.current.nodeStartX += worldDx;
      dragState.current.nodeStartY += worldDy;

      setModel((prev) => {
        const nextVertices = prev.vertices.map((v) => (v.id === id ? { ...v, x: dragState.current.nodeStartX, y: dragState.current.nodeStartY } : v));
        return { ...prev, vertices: nextVertices };
      });
      return;
    }

    if (dragState.current.mode === 'group') {
      const id = dragState.current.nodeId;
      if (!id) return;
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cw = Math.max(1, rect.width);
      const ch = Math.max(1, rect.height);
      const worldDx = (dx / cw) * camera.w;
      const worldDy = (dy / ch) * camera.h;
      dragState.current.nodeStartX += worldDx;
      dragState.current.nodeStartY += worldDy;

      setModel((prev) => {
        const nextVertices = prev.vertices.map((v) => (v.id === id ? { ...v, x: dragState.current.nodeStartX, y: dragState.current.nodeStartY } : v));
        return { ...prev, vertices: nextVertices };
      });
      return;
    }
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return;
    if (!dragState.current.active) return;
    if (dragState.current.pointerId !== e.pointerId) return;
    const { mode, nodeId } = dragState.current;
    const wasClick = !dragMovedRef.current && mode === 'node' && nodeId;
    dragState.current.active = false;
    dragState.current.mode = null;
    dragState.current.pointerId = null;
    setIsDragging(false);
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    if (wasClick && nodeId) {
      suppressClickRef.current = true;
      const baseId = nodeId;
      if (!/^GROUP_/i.test(baseId)) {
        const targetVertex = worldVerticesById.get(baseId);
        if (!isDetailFrame(targetVertex as Vertex)) {
          zoomToNode(baseId);
          if (onNodeClick) onNodeClick(baseId);
          console.log('[diagram] click', baseId);
        }
      }
    }
  };

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (dragMovedRef.current) {
      dragMovedRef.current = false;
      return;
    }

    const target = e.target as Element | null;
    const nodeEl = target?.closest('[data-node-id]') as Element | null;
    const id = (nodeEl?.getAttribute('data-node-id') || '').trim();
    if (!id) {
      onDismissDetails?.();
      return;
    }
    const baseId = id;
    if (/^GROUP_/i.test(baseId)) return;
    if (isDetailFrame(worldVerticesById.get(baseId) as Vertex)) return;
    zoomToNode(baseId);
    if (onNodeClick) onNodeClick(baseId);
    console.log('[diagram] click', baseId);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as Element | null;
    const nodeEl = target?.closest('[data-node-id]') as Element | null;
    const id = (nodeEl?.getAttribute('data-node-id') || '').trim();
    if (!id) {
      hasUserTransformRef.current = false;
      zoomedStepRef.current = null;
      resetView();
      return;
    }
    const baseId = id;
    if (/^GROUP_/i.test(baseId)) return;
    if (isDetailFrame(worldVerticesById.get(baseId) as Vertex)) return;
    if (isStepNodeId(baseId)) {
      const base = worldVerticesById.get(baseId);
      if (!base) return;
      const rect = { x: base.x, y: base.y, width: base.width, height: base.height };
      if (zoomedStepRef.current === baseId) {
        zoomToWorldRect(rect, 1.45);
        zoomedStepRef.current = null;
      } else {
        zoomToWorldRect(rect, 0.5);
        zoomedStepRef.current = baseId;
      }
      return;
    }
    zoomToNode(baseId);
  };

  const copyXml = async () => {
    const trimmed = String(xml || '').trim();
    if (!trimmed) return;
    const toCopy = updateXmlWithVertexPositions(trimmed, model.vertices) || trimmed;
    try {
      await navigator.clipboard.writeText(toCopy);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const downloadSvg = () => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const xmlString = new XMLSerializer().serializeToString(svgEl);
    const withXml = xmlString.startsWith('<?xml') ? xmlString : `<?xml version="1.0" encoding="UTF-8"?>\n${xmlString}`;
    const blob = new Blob([withXml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = window.document.createElement('a');
    a.href = url;
    a.download = 'diagram.svg';
    window.document.body.appendChild(a);
    a.click();
    window.document.body.removeChild(a);

    URL.revokeObjectURL(url);
  };

  if (!String(xml || '').trim()) {
    return (
      <div className={className} aria-label={ariaLabel || 'Diagram'}>
        <div className="text-sm text-muted-foreground">Нет данных для схемы.</div>
      </div>
    );
  }

  return (
    <div className={className} aria-label={ariaLabel || 'Diagram'}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            title={copied ? 'Скопировано' : 'Копировать XML (draw.io)'}
            aria-label={copied ? 'Скопировано' : 'Копировать XML (draw.io)'}
            onClick={copyXml}
            disabled={!xml?.trim()}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? 'Скопировано' : 'Копировать'}
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            title="Скачать SVG (качество без потерь)"
            aria-label="Скачать SVG (качество без потерь)"
            onClick={downloadSvg}
            disabled={!parsed.vertices.length}
          >
            <Download className="size-4" />
            Скачать SVG
          </Button>
        </div>

        <Button
          type="button"
          size="icon"
          variant="outline"
          title="Сбросить вид"
          aria-label="Сбросить вид"
          onClick={() => {
            hasUserTransformRef.current = false;
            resetView();
          }}
        >
          <RefreshCcw className="size-4" />
        </Button>
      </div>

      <div
        ref={containerRef}
        className="relative h-full w-full overflow-hidden rounded-md border bg-background"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
        style={{ touchAction: 'none', cursor: isDragging ? 'grabbing' : 'default' }}
      >
        {activeNodeId && activeNodeDetails && !isStepNodeId(activeNodeId) ? (() => {
          const v = worldVerticesById.get(activeNodeId);
          if (!v) return null;
          const screen = worldToScreen(v.x + v.width, v.y);
          if (!screen) return null;
          const boxW = 280;
          const boxH = 160;
          const pad = 12;
          const preferRight = screen.x + boxW + pad <= screen.cw;
          const left = preferRight ? screen.x + pad : Math.max(8, screen.x - boxW - pad);
          const top = Math.min(screen.ch - boxH - 8, Math.max(8, screen.y - 8));

          return (
            <div
              className="absolute z-20 w-[280px] rounded-md border bg-background p-3 text-sm shadow-md transition-all duration-200"
              style={{ left, top, opacity: 1, transform: 'translateY(0)' }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-semibold">{activeNodeDetails.title}</div>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDismissDetails?.();
                  }}
                >
                  Закрыть
                </button>
              </div>
              <div className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                {activeNodeDetails.body}
              </div>
            </div>
          );
        })() : null}
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox={`${camera.x} ${camera.y} ${camera.w} ${camera.h}`}
          xmlns="http://www.w3.org/2000/svg"
        >
            <defs>
              <marker
                id="arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted-foreground)" />
              </marker>
            </defs>

            {/* edges */}
            {model.edges.map((e) => {
              const points = getEdgeEndpoints(e, visibleVerticesById);
              if (!points) return null;
              return (
                <line
                  key={e.id}
                  x1={points.x1}
                  y1={points.y1}
                  x2={points.x2}
                  y2={points.y2}
                  stroke="var(--muted-foreground)"
                  strokeWidth={30}
                  markerEnd="url(#arrow)"
                  opacity={0.8}
                />
              );
            })}

            {/* vertices */}
            {[...visibleVertices]
              .sort((a, b) => Number(isGroupVertex(b)) - Number(isGroupVertex(a)))
              .map((v) => {
              const kind = pickVertexKind(v.style);
              const group = isGroupVertex(v);
              const ownerIcon = hasOwnerIcon(v);
              const text = decodeHtmlToText(v.value);
              const maxChars = Math.max(15, Math.floor(v.width / 7));
              const lines = wrapTextLines(text, maxChars);
              const baseFontSize = getFontSize(v.style, 12) * DIAGRAM_SCALE;
              const lineHeight = Math.max(4, Math.round(baseFontSize * 1.2));
              const spacingLeft = getSpacingLeft(v.style);

              const isStep = isStepNodeId(v.id);
              const isActiveStep = Boolean(activeNodeId && v.id === activeNodeId && isStep && activeNodeDetails?.body);
              const stepDetail = isActiveStep ? parseStepDetails(activeNodeDetails?.body || '') : null;
              const detailLines = isActiveStep ? wrapTextLines(activeNodeDetails?.body || '', maxChars) : [];
              const stepFit = isStep
                ? fitTextInBox(text, v.width - 8, v.height - 12, baseFontSize * 0.85)
                : null;
              const labelLines = isStep
                ? stepFit?.lines || lines
                : isActiveStep
                  ? wrapTextLines(text, maxChars)
                  : lines;
              const fontSize = isStep ? stepFit?.fontSize || baseFontSize : baseFontSize;
              const computedLineHeight = isStep ? stepFit?.lineHeight || lineHeight : lineHeight;

              const labelPaddingX = 10 + (ownerIcon ? Math.max(22, spacingLeft) : 0);
              const labelPaddingY = 14;

              const forceCenterLabel = isStep && kind === 'ellipse';
              const useTopLeftLabel = group || kind !== 'ellipse' || (isActiveStep && !isStep);
              const stepTitleOffset = forceCenterLabel && isActiveStep ? -v.height * 0.22 : 0;
              const stepTitleScale = forceCenterLabel && isActiveStep ? 0.22 : 1;
              const textX = forceCenterLabel ? v.x + v.width / 2 : useTopLeftLabel ? v.x + labelPaddingX : v.x + v.width / 2;
              const textY = forceCenterLabel
                ? v.y + v.height / 2 - ((labelLines.length - 1) * computedLineHeight) / 2 + stepTitleOffset
                : useTopLeftLabel
                  ? v.y + labelPaddingY
                  : v.y + v.height / 2 - ((labelLines.length - 1) * computedLineHeight) / 2;
              const effectiveFontSize = Math.max(6, Math.round(fontSize * stepTitleScale));
              const effectiveLineHeight = forceCenterLabel && isActiveStep
                ? Math.max(4, Math.round(computedLineHeight * stepTitleScale))
                : computedLineHeight;

              const maxDetailLines = isActiveStep && !isStep
                ? Math.max(0, Math.floor((v.height - labelPaddingY - labelLines.length * computedLineHeight - 10) / computedLineHeight))
                : 0;

                return (
                <g
                  key={v.id}
                  data-node-id={v.id}
                  style={{ cursor: group ? 'grab' : onNodeClick ? 'pointer' : 'default' }}
                >
                  {kind === 'rect' ? (
                    <rect
                      x={v.x}
                      y={v.y}
                      width={v.width}
                      height={v.height}
                      rx={6}
                      ry={6}
                      fill={group ? 'transparent' : 'var(--card)'}
                      stroke="var(--border)"
                      strokeWidth={1.5}
                      opacity={group ? 0.6 : 0.95}
                    />
                  ) : null}

                  {kind === 'ellipse' ? (
                    <ellipse
                      cx={v.x + v.width / 2}
                      cy={v.y + v.height / 2}
                      rx={v.width / 2}
                      ry={v.height / 2}
                      fill={group ? 'transparent' : 'var(--card)'}
                      stroke="var(--border)"
                      strokeWidth={1.5}
                      opacity={group ? 0.6 : 0.95}
                    />
                  ) : null}

                  {kind === 'terminator' ? (
                    <rect
                      x={v.x}
                      y={v.y}
                      width={v.width}
                      height={v.height}
                      rx={Math.max(8, v.height / 2)}
                      ry={Math.max(8, v.height / 2)}
                      fill={group ? 'transparent' : 'var(--card)'}
                      stroke="var(--border)"
                      strokeWidth={1.5}
                      opacity={group ? 0.6 : 0.95}
                    />
                  ) : null}

                  {kind === 'actor' ? (
                    <g>
                      <circle
                        cx={v.x + v.width / 2}
                        cy={v.y + Math.min(16, v.height * 0.25)}
                        r={Math.min(v.width, v.height) * 0.18}
                        fill="none"
                        stroke="var(--foreground)"
                        strokeWidth={2.25}
                      />
                      <line
                        x1={v.x + v.width / 2}
                        y1={v.y + v.height * 0.35}
                        x2={v.x + v.width / 2}
                        y2={v.y + v.height * 0.75}
                        stroke="var(--foreground)"
                        strokeWidth={2.25}
                      />
                      <line
                        x1={v.x + v.width * 0.2}
                        y1={v.y + v.height * 0.5}
                        x2={v.x + v.width * 0.8}
                        y2={v.y + v.height * 0.5}
                        stroke="var(--foreground)"
                        strokeWidth={2.25}
                      />
                      <line
                        x1={v.x + v.width / 2}
                        y1={v.y + v.height * 0.75}
                        x2={v.x + v.width * 0.25}
                        y2={v.y + v.height * 0.95}
                        stroke="var(--foreground)"
                        strokeWidth={2.25}
                      />
                      <line
                        x1={v.x + v.width / 2}
                        y1={v.y + v.height * 0.75}
                        x2={v.x + v.width * 0.75}
                        y2={v.y + v.height * 0.95}
                        stroke="var(--foreground)"
                        strokeWidth={2.25}
                      />
                    </g>
                  ) : null}

                  {kind === 'cube' ? (
                    <g>
                      {(() => {
                        const ox = v.width * 0.25;
                        const oy = v.height * 0.18;
                        const x = v.x + ox;
                        const y = v.y + oy;
                        const w = v.width - ox;
                        const h = v.height - oy;
                        const pTop = `${x},${y} ${x + ox},${y - oy} ${x + w + ox},${y - oy} ${x + w},${y}`;
                        const pSide = `${x + w},${y} ${x + w + ox},${y - oy} ${x + w + ox},${y + h - oy} ${x + w},${y + h}`;
                        const pFront = `${x},${y} ${x + w},${y} ${x + w},${y + h} ${x},${y + h}`;
                        return (
                          <>
                            <polygon points={pTop} fill="var(--card)" stroke="var(--border)" strokeWidth={1.5} />
                            <polygon points={pSide} fill="var(--card)" stroke="var(--border)" strokeWidth={1.5} />
                            <polygon points={pFront} fill="var(--card)" stroke="var(--border)" strokeWidth={1.5} />
                          </>
                        );
                      })()}
                    </g>
                  ) : null}

                  {/* text-only nodes: no shape */}

                  {ownerIcon ? (
                    <g opacity={0.85}>
                      <circle
                        cx={v.x + 16}
                        cy={v.y + 18}
                        r={8}
                        fill="none"
                        stroke="var(--muted-foreground)"
                        strokeWidth={2}
                      />
                      <path
                        d={`M ${v.x + 16} ${v.y + 26} v 16`}
                        fill="none"
                        stroke="var(--muted-foreground)"
                        strokeWidth={2}
                        strokeLinecap="round"
                      />
                      <path
                        d={`M ${v.x + 6} ${v.y + 34} h 20`}
                        fill="none"
                        stroke="var(--muted-foreground)"
                        strokeWidth={2}
                        strokeLinecap="round"
                      />
                    </g>
                  ) : null}

                  <text
                    x={textX}
                    y={textY}
                    textAnchor={forceCenterLabel ? 'middle' : useTopLeftLabel ? 'start' : 'middle'}
                    dominantBaseline={forceCenterLabel ? 'middle' : useTopLeftLabel ? 'text-before-edge' : 'middle'}
                    fontSize={effectiveFontSize}
                    fill="var(--card-foreground)"
                  >
                    {labelLines.map((ln, i) => (
                      <tspan key={i} x={textX} y={textY + i * effectiveLineHeight}>
                        {ln}
                      </tspan>
                    ))}
                  </text>

                  {isActiveStep && maxDetailLines > 0 ? (
                    <text
                      x={v.x + labelPaddingX}
                      y={v.y + labelPaddingY + labelLines.length * computedLineHeight + 6}
                      textAnchor="start"
                      dominantBaseline="text-before-edge"
                      fontSize={Math.max(8, Math.round(fontSize * 0.2))}
                      fill="var(--muted-foreground)"
                    >
                      {detailLines.slice(0, maxDetailLines).map((ln, i) => (
                        <tspan key={i} x={v.x + labelPaddingX} y={v.y + labelPaddingY + labelLines.length * computedLineHeight + 6 + i * computedLineHeight}>
                          {ln}
                        </tspan>
                      ))}
                    </text>
                  ) : null}

                  {isActiveStep && stepDetail ? (() => {
                    const detailScale = 0.25;
                    const stepW = v.width;
                    const stepH = v.height-100;
                    const pad = Math.max(10, Math.round(stepW * 0.01));

                    const descW = Math.max(80, Math.round(stepW * 2.5));
                    const descX = v.x + stepW / 2 - descW / 2;
                    const descY = v.y + stepH + pad / 2;
                    const descFont = Math.max(10, Math.round(fontSize * 0.38));
                    const descLineH = Math.max(13, Math.round(descFont * 1.25));
                    const descBaseChars = Math.max(8, Math.floor(descW / Math.max(1, descFont * 0.6)));
                    const descLines = wrapTextLines(stepDetail.description || 'Описание шага', descBaseChars);

                    const participantsText = stepDetail.participants || 'Участники не найдены в диалоге';
                    const roleText = stepDetail.role || (stepDetail.participants ? 'Должность' : 'Должность не найдена');
                    const nameText = stepDetail.name || (stepDetail.participants ? 'ФИО' : 'ФИО не найдено');
                    const roleFont = Math.max(10, Math.round(fontSize * 0.22));
                    const roleLineH = Math.max(12, Math.round(roleFont * 1.2));

                    const participantItems = stepDetail.participantsList.length
                      ? stepDetail.participantsList
                      : [{ role: roleText, name: nameText, raw: `${roleText} ${nameText}` }];
                    const maxParticipants = Math.min(4, participantItems.length);
                    const itemW = Math.max(70, Math.round(stepW * 0.3));
                    const itemH = Math.max(60, Math.round(stepH * 0.24));
                    const itemGap = Math.max(8, Math.round(itemW * 0.12));
                    const totalW = maxParticipants * itemW + (maxParticipants - 1) * itemGap;
                    const peopleX = v.x + stepW / 2 - totalW / 2;
                    const peopleY = v.y - pad - itemH - roleLineH * 0.6;
                    const peopleLabelY = peopleY - roleLineH * 1.1;

                    const prodW = Math.max(70, Math.round(stepW * 0.3));
                    const prodH = Math.max(60, Math.round(stepH * 0.26));
                    const prodX = v.x + stepW + pad;
                    const prodY = v.y + stepH * 0.65;
                    const productText = stepDetail.product || 'Продукт процесса не обнаружен';
                    const prodTextW = Math.max(120, Math.round(stepW * 1.4));
                    const prodTextX = prodX + prodW + pad;
                    const prodTextY = prodY - Math.round(prodH * 0.2);
                    const prodFont = Math.max(10, Math.round(fontSize * 0.22));
                    const prodLineH = Math.max(12, Math.round(prodFont * 1.25));
                    const prodLines = wrapTextLines(productText, Math.max(14, Math.floor(prodTextW / 8)));

                    const headR = Math.min(itemW, itemH) * 0.18;
                    const headCyOffset = itemH * 0.32;
                    const bodyTopOffset = itemH * 0.42;
                    const bodyBottomOffset = itemH * 0.8;
                    const armYOffset = itemH * 0.56;

                    const cubeOx = prodW * 0.25;
                    const cubeOy = prodH * 0.18;
                    const cubeX = prodX + cubeOx;
                    const cubeY = prodY + cubeOy;
                    const cubeW = prodW - cubeOx;
                    const cubeH = prodH - cubeOy;
                    const pTop = `${cubeX},${cubeY} ${cubeX + cubeOx},${cubeY - cubeOy} ${cubeX + cubeW + cubeOx},${cubeY - cubeOy} ${cubeX + cubeW},${cubeY}`;
                    const pSide = `${cubeX + cubeW},${cubeY} ${cubeX + cubeW + cubeOx},${cubeY - cubeOy} ${cubeX + cubeW + cubeOx},${cubeY + cubeH - cubeOy} ${cubeX + cubeW},${cubeY + cubeH}`;
                    const pFront = `${cubeX},${cubeY} ${cubeX + cubeW},${cubeY} ${cubeX + cubeW},${cubeY + cubeH} ${cubeX},${cubeY + cubeH}`;

                    const cx = v.x + stepW / 2;
                    const cy = v.y + stepH / 2;

                    return (
                      <g transform={`translate(${cx} ${cy}) scale(${detailScale}) translate(${-cx} ${-cy})`}>
                        <text
                          x={v.x + stepW / 2}
                          y={peopleLabelY}
                          textAnchor="middle"
                          dominantBaseline="text-before-edge"
                          fontSize={roleFont}
                          fill="var(--muted-foreground)"
                        >
                          Участники
                        </text>

                        {participantItems.slice(0, maxParticipants).map((p, idx) => {
                          const baseX = peopleX + idx * (itemW + itemGap);
                          const baseY = peopleY;
                          const cxItem = baseX + itemW / 2;
                          const cyItem = baseY + itemH / 2;
                          const headCy = baseY + headCyOffset;
                          const bodyTop = baseY + bodyTopOffset;
                          const bodyBottom = baseY + bodyBottomOffset;
                          const armY = baseY + armYOffset;
                          return (
                            <g key={`${p.raw}-${idx}`}>
                              <ellipse
                                cx={cxItem}
                                cy={cyItem}
                                rx={itemW / 2}
                                ry={itemH / 2}
                                fill="var(--card)"
                                stroke="var(--border)"
                                strokeWidth={1.5}
                                opacity={0.9}
                              />
                              <circle cx={cxItem} cy={headCy} r={headR} fill="none" stroke="var(--foreground)" strokeWidth={2} />
                              <line x1={cxItem} y1={bodyTop} x2={cxItem} y2={bodyBottom} stroke="var(--foreground)" strokeWidth={2} />
                              <line x1={cxItem - headR * 2} y1={armY} x2={cxItem + headR * 2} y2={armY} stroke="var(--foreground)" strokeWidth={2} />
                              <line
                                x1={cxItem}
                                y1={bodyBottom}
                                x2={cxItem - headR * 1.6}
                                y2={bodyBottom + headR * 2}
                                stroke="var(--foreground)"
                                strokeWidth={2}
                              />
                              <line
                                x1={cxItem}
                                y1={bodyBottom}
                                x2={cxItem + headR * 1.6}
                                y2={bodyBottom + headR * 2}
                                stroke="var(--foreground)"
                                strokeWidth={2}
                              />
                              {(p.role || p.name) ? (
                                <text
                                  x={cxItem}
                                  y={baseY + itemH + roleLineH * 0.2}
                                  textAnchor="middle"
                                  dominantBaseline="text-before-edge"
                                  fontSize={roleFont}
                                  fill="var(--muted-foreground)"
                                >
                                  {p.role ? <tspan x={cxItem} y={baseY + itemH + roleLineH * 0.2}>{p.role}</tspan> : null}
                                  {p.name ? <tspan x={cxItem} y={baseY + itemH + roleLineH * 1.2}>{p.name}</tspan> : null}
                                </text>
                              ) : null}
                            </g>
                          );
                        })}

                        {descLines.length ? (
                          <text
                            x={descX + descW / 2}
                            y={descY - descLineH}
                            textAnchor="middle"
                            dominantBaseline="text-before-edge"
                            fontSize={descFont}
                            fill="var(--muted-foreground)"
                          >
                            <tspan x={descX + descW / 2} y={descY - descLineH}>Описание процесса</tspan>
                            {descLines.map((ln, i) => (
                              <tspan key={i} x={descX + descW / 2} y={descY + i * descLineH}>
                                {ln}
                              </tspan>
                            ))}
                          </text>
                        ) : null}

                        <g>
                          <polygon points={pTop} fill="var(--card)" stroke="var(--border)" strokeWidth={1.5} />
                          <polygon points={pSide} fill="var(--card)" stroke="var(--border)" strokeWidth={1.5} />
                          <polygon points={pFront} fill="var(--card)" stroke="var(--border)" strokeWidth={1.5} />
                        </g>

                        {prodLines.length ? (
                          <text
                            x={prodTextX}
                            y={prodTextY - prodLineH}
                            textAnchor="start"
                            dominantBaseline="text-before-edge"
                            fontSize={prodFont}
                            fill="var(--muted-foreground)"
                          >
                            <tspan x={prodTextX} y={prodTextY - prodLineH}>Продукт процесса</tspan>
                            {prodLines.map((ln, i) => (
                              <tspan key={i} x={prodTextX} y={prodTextY + i * prodLineH}>
                                {ln}
                              </tspan>
                            ))}
                          </text>
                        ) : null}
                      </g>
                    );
                  })() : null}
                </g>
              );
            })}
        </svg>
      </div>
    </div>
  );
}
