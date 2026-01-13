'use client';

import { Check, Copy, Download, RefreshCcw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';

type DrawioDiagramProps = {
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

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function decodeDataUriToString(dataUri: string): string {
  const s = String(dataUri || '').trim();
  if (!s.startsWith('data:')) return s;

  const comma = s.indexOf(',');
  if (comma === -1) return '';
  const meta = s.slice(5, comma);
  const data = s.slice(comma + 1);

  const isBase64 = /;base64/i.test(meta);
  if (!isBase64) {
    try {
      return decodeURIComponent(data);
    } catch {
      return data;
    }
  }

  // Base64 → Uint8Array → UTF-8
  try {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return '';
  }
}

export function DrawioDiagram({ xml, className, ariaLabel, onNodeClick }: DrawioDiagramProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const exportTimeoutRef = useRef<number | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [transform, setTransform] = useState<ViewportTransform>({ x: 0, y: 0, scale: 1 });
  const hasUserTransformRef = useRef(false);
  const dragState = useRef<{ active: boolean; pointerId: number | null; lastX: number; lastY: number }>(
    { active: false, pointerId: null, lastX: 0, lastY: 0 },
  );
  const [isDragging, setIsDragging] = useState(false);
  const dragMovedRef = useRef(false);

  const MIN_SCALE = 0.1;
  const MAX_SCALE = 200;

  const embedOrigin = 'https://embed.diagrams.net';
  const embedUrl = useMemo(() => {
    // Embed mode + JSON protocol. Hide save/exit buttons.
    const params = new URLSearchParams({
      embed: '1',
      ui: 'min',
      proto: 'json',
      spin: '1',
      libraries: '0',
      noSaveBtn: '1',
      saveAndExit: '0',
      noExitBtn: '1',
    });
    return `${embedOrigin}/?${params.toString()}`;
  }, []);

  const exportSvg = useMemo(() => {
    return (xmlToExport: string) => {
      const w = iframeRef.current?.contentWindow;
      if (!w) return;
      if (exportTimeoutRef.current) {
        window.clearTimeout(exportTimeoutRef.current);
        exportTimeoutRef.current = null;
      }
      // If draw.io doesn't respond, surface a helpful error.
      exportTimeoutRef.current = window.setTimeout(() => {
        setError('draw.io не вернул SVG. Проверьте, что iframe загрузился и протокол embed доступен (CSP/AdBlock).');
      }, 6000);
      const payload = { action: 'export', format: 'svg', xml: xmlToExport };
      w.postMessage(payload, embedOrigin);
    };
  }, []);

  const sendInit = useMemo(() => {
    return () => {
      const w = iframeRef.current?.contentWindow;
      if (!w) return;
      // Per embed protocol: parent should send init.
      w.postMessage({ event: 'init' }, embedOrigin);
    };
  }, [embedOrigin]);

  useEffect(() => {
    const onMessage = (evt: MessageEvent) => {
      if (evt.origin !== embedOrigin) return;

      const msg = (() => {
        const d: any = evt.data;
        if (!d) return null;
        if (typeof d === 'string') {
          try {
            return JSON.parse(d);
          } catch {
            return null;
          }
        }
        return d;
      })();

      if (!msg) return;

      if (msg.event === 'init') {
        setIsReady(true);
        return;
      }

      if (msg.event === 'export') {
        if (exportTimeoutRef.current) {
          window.clearTimeout(exportTimeoutRef.current);
          exportTimeoutRef.current = null;
        }
        const dataUri = String(msg.data || '').trim();
        const svgText = decodeDataUriToString(dataUri).trim();
        if (!svgText) {
          setError('Не удалось получить SVG из draw.io.');
          setSvg('');
          return;
        }
        setSvg(svgText);
        setError('');
        hasUserTransformRef.current = false;
        return;
      }

      if (msg.error) {
        setError(String(msg.error));
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    // Some embed builds require parent-initiated init.
    if (isReady) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries++;
      sendInit();
      if (tries >= 20) window.clearInterval(timer);
    }, 300);
    return () => window.clearInterval(timer);
  }, [isReady, sendInit]);

  useEffect(() => {
    const trimmed = String(xml || '').trim();
    if (!trimmed) {
      setSvg('');
      setError('');
      return;
    }
    if (!isReady) return;

    setError('');
    exportSvg(trimmed);
  }, [exportSvg, isReady, xml]);

  const resetView = () => {
    if (!svg) return;
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const rect = container.getBoundingClientRect();
    const cw = Math.max(1, rect.width);
    const ch = Math.max(1, rect.height);

    const svgEl = content.querySelector('svg') as SVGSVGElement | null;
    const viewBox = svgEl?.getAttribute('viewBox');
    let w = 800;
    let h = 600;
    if (viewBox) {
      const parts = viewBox.trim().split(/\s+/).map((v) => Number(v));
      if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
        w = Math.max(1, parts[2]);
        h = Math.max(1, parts[3]);
      }
    }

    const fitScale = Math.min(cw / w, ch / h) * 0.95;
    const scale = clamp(Math.max(fitScale, 1.2), MIN_SCALE, MAX_SCALE);
    const x = cw / 2 - (w / 2) * scale;
    const y = ch / 2 - (h / 2) * scale;
    setTransform({ x, y, scale });
  };

  useEffect(() => {
    if (!svg) return;
    if (hasUserTransformRef.current) return;
    resetView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svg]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!svg) return;

    const ro = new ResizeObserver(() => {
      if (hasUserTransformRef.current) return;
      resetView();
    });

    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svg]);

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

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
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
    setIsDragging(true);
    dragMovedRef.current = false;
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

    if (Math.abs(dx) + Math.abs(dy) > 2) dragMovedRef.current = true;

    setTransform((t) => ({ ...t, x: t.x + dx, y: t.y + dy }));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return;
    if (!dragState.current.active) return;
    if (dragState.current.pointerId !== e.pointerId) return;
    dragState.current.active = false;
    dragState.current.pointerId = null;
    setIsDragging(false);
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const extractNodeIdFromSvg = (target: Element | null): string | null => {
    if (!target) return null;
    const el = target.closest('[id]') as Element | null;
    const raw = (el?.getAttribute('id') || '').trim();
    if (!raw) return null;

    const known = raw.match(/\b(PROC|ORG|START|GOAL|OWNER|PRODUCT|END|CONS\d+)\b/i);
    if (known?.[1]) return known[1].toUpperCase();

    return null;
  };

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (dragMovedRef.current) {
      dragMovedRef.current = false;
      return;
    }

    const nodeId = extractNodeIdFromSvg(e.target as Element);
    if (nodeId && onNodeClick) onNodeClick(nodeId);
  };

  const copyXml = async () => {
    const trimmed = String(xml || '').trim();
    if (!trimmed) return;
    try {
      await navigator.clipboard.writeText(trimmed);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const downloadSvg = () => {
    const svgString = String(svg || '').trim();
    if (!svgString) return;

    const withXml = svgString.startsWith('<?xml') ? svgString : `<?xml version="1.0" encoding="UTF-8"?>\n${svgString}`;
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

  if (error) {
    return (
      <div className={className} role="alert" aria-label={ariaLabel || 'Diagram error'}>
        <div className="text-sm text-destructive">Не удалось построить схему.</div>
        <div className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{error}</div>
        <iframe ref={iframeRef} src={embedUrl} className="hidden" title="drawio-export" onLoad={sendInit} />
      </div>
    );
  }

  if (!String(xml || '').trim()) {
    return (
      <div className={className} aria-label={ariaLabel || 'Diagram'}>
        <div className="text-sm text-muted-foreground">Нет данных для схемы.</div>
        <iframe ref={iframeRef} src={embedUrl} className="hidden" title="drawio-export" onLoad={sendInit} />
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
            disabled={!svg?.trim()}
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
        style={{ touchAction: 'none', cursor: isDragging ? 'grabbing' : 'grab' }}
      >
        <div
          ref={contentRef}
          className="absolute left-0 top-0"
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: '0 0',
            transition: isDragging ? 'none' : 'transform 140ms ease-out',
          }}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG is rendered by draw.io exporter from our generated XML.
          dangerouslySetInnerHTML={{ __html: svg }}
        />

        <iframe ref={iframeRef} src={embedUrl} className="hidden" title="drawio-export" onLoad={sendInit} />
      </div>
    </div>
  );
}
