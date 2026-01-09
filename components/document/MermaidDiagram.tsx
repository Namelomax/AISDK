'use client';

import { Check, Copy, Download, Minus, Plus, RefreshCcw } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';

type MermaidDiagramProps = {
  code: string;
  className?: string;
  ariaLabel?: string;
};

type ViewportTransform = {
  x: number;
  y: number;
  scale: number;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function readSvgViewport(svgEl: SVGSVGElement | null): { width: number; height: number } {
  if (!svgEl) return { width: 800, height: 600 };

  const viewBox = svgEl.getAttribute('viewBox');
  if (viewBox) {
    const parts = viewBox.trim().split(/\s+/).map((v) => Number(v));
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      const w = Math.max(1, parts[2]);
      const h = Math.max(1, parts[3]);
      return { width: w, height: h };
    }
  }

  const widthAttr = svgEl.getAttribute('width');
  const heightAttr = svgEl.getAttribute('height');
  const w = widthAttr ? Number.parseFloat(widthAttr) : NaN;
  const h = heightAttr ? Number.parseFloat(heightAttr) : NaN;
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return { width: w, height: h };
  }

  return { width: 800, height: 600 };
}

export function MermaidDiagram({ code, className, ariaLabel }: MermaidDiagramProps) {
  const unique = useId();
  const renderId = useMemo(() => `mermaid-${unique.replace(/[:]/g, '')}`, [unique]);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [transform, setTransform] = useState<ViewportTransform>({ x: 0, y: 0, scale: 1 });
  const hasUserTransformRef = useRef(false);
  const dragState = useRef<{ active: boolean; pointerId: number | null; lastX: number; lastY: number }>(
    { active: false, pointerId: null, lastX: 0, lastY: 0 },
  );

  const MIN_SCALE = 0.1;
  const MAX_SCALE = 200;

  const centerOnFirstNode = useMemo(() => {
    return (scale: number) => {
      const container = containerRef.current;
      const content = contentRef.current;
      if (!container || !content) return;

      const rect = container.getBoundingClientRect();
      const cw = Math.max(1, rect.width);
      const ch = Math.max(1, rect.height);

      const svgEl = content.querySelector('svg') as SVGSVGElement | null;
      let targetCenterX = 0;
      let targetCenterY = 0;

      // Mermaid nodes are typically rendered as <g class="node">…</g>
      const firstNode = (content.querySelector('g.node') as SVGGElement | null) ??
        (content.querySelector('.node') as SVGGElement | null);

      if (firstNode && typeof (firstNode as any).getBBox === 'function') {
        try {
          const box = (firstNode as any).getBBox() as { x: number; y: number; width: number; height: number };
          targetCenterX = box.x + box.width / 2;
          targetCenterY = box.y + box.height / 2;
        } catch {
          // ignore
        }
      }

      if (!Number.isFinite(targetCenterX) || !Number.isFinite(targetCenterY) || (targetCenterX === 0 && targetCenterY === 0)) {
        const { width, height } = readSvgViewport(svgEl);
        targetCenterX = width / 2;
        targetCenterY = height / 2;
      }

      const s = clamp(scale, MIN_SCALE, MAX_SCALE);
      const x = cw / 2 - targetCenterX * s;
      const y = ch / 2 - targetCenterY * s;
      setTransform({ x, y, scale: s });
    };
  }, []);

  const resetViewToFirstNode = useMemo(() => {
    return () => {
      const container = containerRef.current;
      const content = contentRef.current;
      if (!container || !content) return;

      const rect = container.getBoundingClientRect();
      const cw = Math.max(1, rect.width);
      const ch = Math.max(1, rect.height);

      const svgEl = content.querySelector('svg') as SVGSVGElement | null;
      const { width, height } = readSvgViewport(svgEl);

      // Fit, but never start too tiny: clamp to at least 0.9 so the first node is readable.
      const fitScale = Math.min(cw / width, ch / height) * 0.95;
      const startScale = clamp(Math.max(fitScale, 1.2), MIN_SCALE, MAX_SCALE);
      centerOnFirstNode(startScale);
    };
  }, [centerOnFirstNode]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const trimmed = String(code || '').trim();
      if (!trimmed) {
        setSvg('');
        setError('');
        return;
      }

      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          flowchart: {
            htmlLabels: true,
          },
        });

        const { svg } = await mermaid.render(renderId, trimmed);
        if (cancelled) return;
        setSvg(svg);
        setError('');
        hasUserTransformRef.current = false;
      } catch (e) {
        if (cancelled) return;
        setSvg('');
        setError(e instanceof Error ? e.message : 'Failed to render diagram');
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [code, renderId]);

  // When SVG changes, center immediately (more reliable than measuring inside the render effect).
  useLayoutEffect(() => {
    if (!svg) return;
    if (hasUserTransformRef.current) return;
    resetViewToFirstNode();
  }, [resetViewToFirstNode, svg]);

  // Keep it fitted on resize (but don't override user pan/zoom).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!svg) return;

    const ro = new ResizeObserver(() => {
      if (hasUserTransformRef.current) return;
      resetViewToFirstNode();
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, [resetViewToFirstNode, svg]);

  const applyZoomAtPoint = (nextScale: number, clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;

    setTransform((t) => {
      const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
      const worldX = (px - t.x) / t.scale;
      const worldY = (py - t.y) / t.scale;
      const x = px - worldX * scale;
      const y = py - worldY * scale;
      return { x, y, scale };
    });
  };

  const zoomBy = (delta: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    applyZoomAtPoint(
      transform.scale * (delta > 0 ? 1.25 : 1 / 1.25),
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
  };

  const resetView = () => {
    if (!svg) return;
    hasUserTransformRef.current = false;
    resetViewToFirstNode();
  };

  const buildMermaidMarkdown = () => {
    const trimmed = String(code || '').trim();
    if (!trimmed) return '';

    // Keep formatting consistent across renderers (e.g., Obsidian).
    // Mermaid supports init directives inside code blocks.
    const init = "%%{init: {'flowchart': {'htmlLabels': true}} }%%";
    return ['```mermaid', init, trimmed, '```', ''].join('\n');
  };

  const handleCopyMarkdown = async () => {
    const md = buildMermaidMarkdown();
    if (!md) return;
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.warn('Failed to copy mermaid markdown', e);
    }
  };

  const downloadSvg = () => {
    const svgString = String(svg || '').trim();
    if (!svgString) return;

    const withXml = svgString.startsWith('<?xml')
      ? svgString
      : `<?xml version="1.0" encoding="UTF-8"?>\n${svgString}`;

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

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      // Zoom on wheel; prevent the outer panel from scrolling when hovering the diagram.
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1 / 1.2 : 1.2;
      hasUserTransformRef.current = true;
      applyZoomAtPoint(transform.scale * factor, e.clientX, e.clientY);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel as any);
  }, [transform.scale]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return;
    dragState.current = { active: true, pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
    hasUserTransformRef.current = true;
    el.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current.active) return;
    if (dragState.current.pointerId !== e.pointerId) return;

    const dx = e.clientX - dragState.current.lastX;
    const dy = e.clientY - dragState.current.lastY;
    dragState.current.lastX = e.clientX;
    dragState.current.lastY = e.clientY;

    setTransform((t) => ({ ...t, x: t.x + dx, y: t.y + dy }));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return;
    if (!dragState.current.active) return;
    if (dragState.current.pointerId !== e.pointerId) return;
    dragState.current.active = false;
    dragState.current.pointerId = null;
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  if (error) {
    return (
      <div className={className} role="alert" aria-label={ariaLabel || 'Diagram error'}>
        <div className="text-sm text-destructive">Не удалось построить схему.</div>
        <div className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{error}</div>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className={className} aria-label={ariaLabel || 'Diagram'}>
        <div className="text-sm text-muted-foreground">
          Нет структуры для схемы. Используй заголовки (#, ##, ###) и списки с подпунктами.
        </div>
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
            title={copied ? 'Скопировано' : 'Скопировать в Markdown (Mermaid)'}
            aria-label={copied ? 'Скопировано' : 'Скопировать в Markdown (Mermaid)'}
            onClick={handleCopyMarkdown}
            disabled={!code?.trim()}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? 'Скопировано' : 'Копировать' }
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            title="Скачать SVG (качество без потерь)"
            aria-label="Скачать SVG (качество без потерь)"
            onClick={downloadSvg}
            disabled={!svg?.trim()}
          >
            <Download className="size-4" />
            Скачать SVG
          </Button>
        </div>

        <div className="flex items-center gap-2">
        <Button
          type="button"
          size="icon"
          variant="outline"
          title="Приблизить"
          aria-label="Приблизить"
          onClick={() => {
            hasUserTransformRef.current = true;
            zoomBy(0.2);
          }}
        >
          <Plus className="size-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="outline"
          title="Отдалить"
          aria-label="Отдалить"
          onClick={() => {
            hasUserTransformRef.current = true;
            zoomBy(-0.2);
          }}
        >
          <Minus className="size-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="outline"
          title="Сбросить вид"
          aria-label="Сбросить вид"
          onClick={resetView}
        >
          <RefreshCcw className="size-4" />
        </Button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative h-full w-full overflow-hidden rounded-md border bg-background"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ touchAction: 'none', cursor: dragState.current.active ? 'grabbing' : 'grab' }}
      >
        <div
          ref={contentRef}
          className="absolute left-0 top-0"
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: '0 0',
          }}
          // Mermaid returns an SVG string.
          // biome-ignore lint/security/noDangerouslySetInnerHtml: Mermaid renders trusted SVG generated from our own code string.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>
  );
}
