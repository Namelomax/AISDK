'use client';

import { Check, Copy, Download, RefreshCcw } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';

type LocalFlowDiagramProps = {
  xml: string;
  className?: string;
  ariaLabel?: string;
  onNodeClick?: (nodeId: string) => void;
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
  source: string;
  target: string;
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
  const s = String(input || '');
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
  const rawLines = String(text || '').split(/\r\n?|\n/g);
  const lines: string[] = [];

  for (const raw of rawLines) {
    const t = raw.trim();
    if (!t) {
      lines.push('');
      continue;
    }

    const words = t.split(/\s+/g);
    let current = '';
    for (const w of words) {
      if (!current) {
        current = w;
        continue;
      }
      if ((current + ' ' + w).length <= maxChars) {
        current += ' ' + w;
      } else {
        lines.push(current);
        current = w;
      }
    }
    if (current) lines.push(current);
  }

  // Trim trailing empty lines
  while (lines.length > 0 && !lines[lines.length - 1]?.trim()) lines.pop();
  return lines;
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
      const source = (el.getAttribute('source') || '').trim();
      const target = (el.getAttribute('target') || '').trim();
      if (!source || !target) continue;
      edges.push({ id, style, source, target });
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

function getSpacingLeft(style: string) {
  const m = parseStyle(style);
  const v = m.get('spacingleft');
  const n = v ? Number(v) : 0;
  return Number.isFinite(n) ? n : 0;
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

export function LocalFlowDiagram({ xml, className, ariaLabel, onNodeClick }: LocalFlowDiagramProps) {
  const [copied, setCopied] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const [camera, setCamera] = useState<CameraViewBox>({ x: 0, y: 0, w: 800, h: 600 });
  const hasUserTransformRef = useRef(false);
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

  const MIN_SCALE = 0.1;
  const MAX_SCALE = 200;

  const parsed = useMemo(() => parseMxfileXml(xml), [xml]);

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
    const current = computeBounds(buildWorldVertices(model.vertices));
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

  const worldVerticesById = useMemo(() => {
    const m = new Map<string, Vertex>();
    for (const v of worldVertices) m.set(v.id, v);
    return m;
  }, [worldVertices]);

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
    setCamera({ x: fitted.x, y: fitted.y, w: fitted.width, h: fitted.height });
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

  const zoomToWorldRect = (rect: { x: number; y: number; width: number; height: number }) => {
    const container = containerRef.current;
    if (!container) return;
    const cr = container.getBoundingClientRect();
    const cw = Math.max(1, cr.width);
    const ch = Math.max(1, cr.height);
    const aspect = cw / ch;

    const margin = 40;
    const base = {
      x: rect.x - margin,
      y: rect.y - margin,
      width: rect.width + margin * 2,
      height: rect.height + margin * 2,
    };
    const fitted = fitRectToAspect(base, aspect);
    hasUserTransformRef.current = true;
    setCamera({ x: fitted.x, y: fitted.y, w: fitted.width, h: fitted.height });
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
      const nextW = clamp(camera.w * zoomFactor, 60, 20000);
      const nextH = clamp(camera.h * zoomFactor, 60, 20000);

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

    // Middle mouse button (wheel press): pan
    if (e.button === 1) {
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
    dragState.current.active = false;
    dragState.current.mode = null;
    dragState.current.pointerId = null;
    setIsDragging(false);
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (dragMovedRef.current) {
      dragMovedRef.current = false;
      return;
    }

    const target = e.target as Element | null;
    const nodeEl = target?.closest('[data-node-id]') as Element | null;
    const id = (nodeEl?.getAttribute('data-node-id') || '').trim();
    if (!id) return;
    if (/^GROUP_/i.test(id)) return;
    if (onNodeClick) onNodeClick(id);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as Element | null;
    const nodeEl = target?.closest('[data-node-id]') as Element | null;
    const id = (nodeEl?.getAttribute('data-node-id') || '').trim();
    if (!id) {
      hasUserTransformRef.current = false;
      resetView();
      return;
    }
    const v = worldVerticesById.get(id);
    if (!v) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
    const margin = 40;
    const base = { x: v.x - margin, y: v.y - margin, width: v.width + margin * 2, height: v.height + margin * 2 };
    const fitted = fitRectToAspect(base, aspect);
    hasUserTransformRef.current = true;
    setCamera({ x: fitted.x, y: fitted.y, w: fitted.width, h: fitted.height });
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
        style={{ touchAction: 'none', cursor: isDragging ? 'grabbing' : 'default' }}
      >
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
              const s = worldVerticesById.get(e.source);
              const t = worldVerticesById.get(e.target);
              if (!s || !t) return null;

              const sc = getCenter(s);
              const tc = getCenter(t);
              const a1 = getAnchorPoint(s, tc.x, tc.y);
              const a2 = getAnchorPoint(t, sc.x, sc.y);

              const x1 = a1.x;
              const y1 = a1.y;
              const x2 = a2.x;
              const y2 = a2.y;
              return (
                <line
                  key={e.id}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="var(--muted-foreground)"
                  strokeWidth={1.5}
                  markerEnd="url(#arrow)"
                  opacity={0.8}
                />
              );
            })}

            {/* vertices */}
            {[...worldVertices]
              .sort((a, b) => Number(isGroupVertex(b)) - Number(isGroupVertex(a)))
              .map((v) => {
              const kind = pickVertexKind(v.style);
              const group = isGroupVertex(v);
              const ownerIcon = hasOwnerIcon(v);
              const text = decodeHtmlToText(v.value);
              const maxChars = Math.max(12, Math.floor(v.width / 7));
              const lines = wrapTextLines(text, maxChars);
              const lineHeight = 14;
              const spacingLeft = getSpacingLeft(v.style);

              const labelPaddingX = 10 + (ownerIcon ? Math.max(22, spacingLeft) : 0);
              const labelPaddingY = 14;

              const useTopLeftLabel = group || kind !== 'ellipse';
              const textX = useTopLeftLabel ? v.x + labelPaddingX : v.x + v.width / 2;
              const textY = useTopLeftLabel
                ? v.y + labelPaddingY
                : v.y + v.height / 2 - ((lines.length - 1) * lineHeight) / 2;

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
                    textAnchor={useTopLeftLabel ? 'start' : 'middle'}
                    dominantBaseline={useTopLeftLabel ? 'text-before-edge' : 'middle'}
                    fontSize={12}
                    fill="var(--card-foreground)"
                  >
                    {lines.map((ln, i) => (
                      <tspan key={i} x={textX} y={textY + i * lineHeight}>
                        {ln}
                      </tspan>
                    ))}
                  </text>
                </g>
              );
            })}
        </svg>
      </div>
    </div>
  );
}
