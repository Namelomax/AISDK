'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  FileSpreadsheetIcon,
  FileText,
  ImageIcon,
  Paperclip,
  PencilIcon,
  PresentationIcon,
  X,
} from 'lucide-react';
import remarkBreaks from 'remark-breaks';

import { Response } from '@/components/ai-elements/response';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { LocalFlowDiagram } from '@/components/document/LocalFlowDiagram';

export type DocumentState = {
  title: string;
  content: string;
  isStreaming: boolean;
};

export type ProcessDiagramState = {
  organization?: { name?: string | null; activity?: string | null };
  process?: { name?: string | null; description?: string | null };
  owner?: { fullName?: string | null; position?: string | null };
  goal?: string | null;
  product?: string | null;
  consumers?: Array<
    | string
    | {
        kind?: 'person' | 'org' | 'group';
        name?: string | null;
        fullName?: string | null;
        position?: string | null;
      }
  >;
  boundaries?: { start?: string | null; end?: string | null };
  updatedAt?: string;
};

export type Attachment = {
  id?: string;
  name?: string;
  url?: string;
  mediaType?: string;
  bytes?: number;
};

type DocumentViewMode = 'document' | 'diagram';

type DocumentPanelProps = {
  document: DocumentState;
  onCopy?: (payload: { title: string; content: string }) => void;
  onEdit?: (payload: DocumentState) => void;
  attachments?: Attachment[];
  diagramState?: ProcessDiagramState | null;
};

function formatDocumentContent(raw: string) {
  if (!raw) return '';
  const normalized = raw.replace(/\r\n?/g, '\n');
  // Preserve manual indentation by converting leading spaces on each line to non-breaking spaces
  return normalized.replace(/^(\s+)/gm, (m) => m.replace(/ /g, '\u00A0'));
}

function extractTitleFromMarkdown(markdown?: string | null): string | null {
  const text = String(markdown || '').replace(/\r\n?/g, '\n');
  if (!text.trim()) return null;
  const lines = text.split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(/^#\s+(.+?)\s*$/);
    if (m?.[1]) return m[1].trim();
    break;
  }
  return null;
}

function sanitizeFilename(input: string, fallback: string) {
  const trimmed = String(input || '').trim();
  const safe = (trimmed || fallback)
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 140);
  return safe || fallback;
}

function getFileExt(name: string) {
  const n = String(name || '').trim();
  const m = n.match(/\.([A-Za-z0-9]+)$/);
  return (m?.[1] || '').toLowerCase();
}

function getAttachmentAccentClass(att: Attachment) {
  const name = att?.name || '';
  const ext = getFileExt(name);
  const mt = String(att?.mediaType || '').toLowerCase();

  if (mt.includes('pdf') || ext === 'pdf') return 'text-destructive';

  const isDocLike =
    mt.includes('word') || mt.includes('text') || ['doc', 'docx', 'txt', 'md', 'rtf'].includes(ext);
  // DOC/DOCX should be blue.
  if (isDocLike) return 'text-[color:var(--chart-1)]';

  const isPresentation =
    mt.includes('presentation') || mt.includes('powerpoint') || ['ppt', 'pptx'].includes(ext);
  // PPT/PPTX should be orange.
  if (isPresentation) return 'text-[color:var(--chart-3)]';

  const isSpreadsheet =
    mt.includes('spreadsheet') || mt.includes('excel') || ['xls', 'xlsx', 'csv'].includes(ext);
  if (isSpreadsheet) return 'text-[color:var(--chart-2)]';

  return 'text-muted-foreground';
}

function getAttachmentIcon(att: Attachment, className?: string) {
  const name = att?.name || '';
  const ext = getFileExt(name);
  const mt = String(att?.mediaType || '').toLowerCase();

  const isImage = mt.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext);
  if (isImage) return <ImageIcon className={className ? `size-4 ${className}` : 'size-4'} />;

  const isPresentation =
    mt.includes('presentation') || mt.includes('powerpoint') || ['ppt', 'pptx'].includes(ext);
  if (isPresentation) return <PresentationIcon className={className ? `size-4 ${className}` : 'size-4'} />;

  const isSpreadsheet =
    mt.includes('spreadsheet') || mt.includes('excel') || ['xls', 'xlsx', 'csv'].includes(ext);
  if (isSpreadsheet) return <FileSpreadsheetIcon className={className ? `size-4 ${className}` : 'size-4'} />;

  const isDocLike =
    mt.includes('pdf') ||
    mt.includes('word') ||
    mt.includes('text') ||
    ['pdf', 'doc', 'docx', 'txt', 'md', 'rtf'].includes(ext);
  if (isDocLike) return <FileText className={className ? `size-4 ${className}` : 'size-4'} />;

  return <Paperclip className={className ? `size-4 ${className}` : 'size-4'} />;
}

function isImageAttachment(att: Attachment) {
  const name = att?.name || '';
  const ext = getFileExt(name);
  const mt = String(att?.mediaType || '').toLowerCase();
  return Boolean(
    (mt.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) && att?.url
  );
}

function escapeXml(input: string) {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapForDrawioLabel(input: string) {
  const t = String(input || '').trim();
  if (!t) return '';
  // mxGraph labels accept HTML when html=1, but draw.io files are XML.
  // That means the label must be XML-escaped: `<br/>` must become `&lt;br/&gt;`.
  // We first inject `<br/>` (for draw.io's HTML labels), then escape as XML.
  return escapeXml(t.replace(/\r\n?|\n/g, '<br/>'));
}

function buildDrawioXmlFromState(documentTitle: string, state: ProcessDiagramState | null | undefined): string {
  const s = state || null;
  if (!s) return '';

  const short = (input: any, max = 72) => {
    const t = String(input ?? '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    if (t.length <= max) return t;
    return `${t.slice(0, Math.max(0, max - 1))}…`;
  };

  const orgName = String(s.organization?.name || '').trim();
  const orgActivity = String(s.organization?.activity || '').trim();
  const procName = String(s.process?.name || '').trim();
  const procDesc = String(s.process?.description || '').trim();
  const ownerName = String(s.owner?.fullName || '').trim();
  const ownerPos = String(s.owner?.position || '').trim();
  const goal = String(s.goal || '').trim();
  const product = String(s.product || '').trim();
  const start = String(s.boundaries?.start || '').trim();
  const end = String(s.boundaries?.end || '').trim();
  const consumers = Array.isArray(s.consumers) ? s.consumers : [];

  const hasAny = Boolean(
    orgName ||
      orgActivity ||
      procName ||
      procDesc ||
      ownerName ||
      ownerPos ||
      goal ||
      product ||
      start ||
      end ||
      consumers.length
  );
  if (!hasAny) return '';

  const processTitle = procName || documentTitle || 'Процесс';

  // Layout resembles a "project/process scheme":
  // - Context (org / owner / goal) grouped, not necessarily connected.
  // - Process flow (start -> process -> product -> end).
  // - Consumers grouped separately.
  const canvasW = 1200;
  const canvasH = 800;

  const node = (
    id: string,
    value: string,
    style: string,
    x: number,
    y: number,
    w: number,
    h: number,
    parentId: string = '1'
  ) => {
    const v = wrapForDrawioLabel(value);
    return `    <mxCell id="${escapeXml(id)}" value="${v}" style="${escapeXml(style)}" vertex="1" parent="${escapeXml(parentId)}">\n      <mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/>\n    </mxCell>`;
  };

  const edge = (id: string, source: string, target: string, style: string) => {
    return `    <mxCell id="${escapeXml(id)}" style="${escapeXml(style)}" edge="1" parent="1" source="${escapeXml(source)}" target="${escapeXml(target)}">\n      <mxGeometry relative="1" as="geometry"/>\n    </mxCell>`;
  };

  const styles = {
    group: 'group=1;rounded=0;whiteSpace=wrap;html=1;fillColor=none;align=left;verticalAlign=top;spacing=10;',
    process: 'rounded=0;whiteSpace=wrap;html=1;align=center;verticalAlign=middle;spacing=8;',
    terminator: 'shape=terminator;whiteSpace=wrap;html=1;align=center;verticalAlign=middle;spacing=8;',
    ellipse: 'ellipse;whiteSpace=wrap;html=1;align=center;verticalAlign=middle;spacing=8;',
    // Text blocks without outlines.
    textOnlyLeft: 'text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;whiteSpace=wrap;',
    // Small clickable tag-like blocks.
    tag: 'rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacing=8;',
    // Owner label: icon + text, no oval.
    ownerLabel: 'text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;whiteSpace=wrap;spacingLeft=28;ownerIcon=1;',
    edge: 'endArrow=block;endFill=1;html=1;rounded=0;',
  };

  const cells: string[] = [];
  const edges: string[] = [];

  // Group containers (outline only)
  // Note: groups are vertices too; local renderer draws them as transparent outlines.
  const context = { id: 'GROUP_CONTEXT', x: 40, y: 20, w: 760, h: 140 };
  const flow = { id: 'GROUP_FLOW', x: 40, y: 180, w: 760, h: 560 };
  const consumersG = { id: 'GROUP_CONSUMERS', x: 820, y: 180, w: 340, h: 560 };

  cells.push(node(context.id, 'Контекст', styles.group, context.x, context.y, context.w, context.h));
  cells.push(node(flow.id, processTitle || 'Процесс', styles.group, flow.x, flow.y, flow.w, flow.h));
  cells.push(node(consumersG.id, 'Потребители', styles.group, consumersG.x, consumersG.y, consumersG.w, consumersG.h));

  // Organization (collapsed: name only; activity in details drawer)
  if (orgName || orgActivity) {
    const label = orgName ? `Организация: ${orgName}` : 'Организация';
    cells.push(node('ORG', label, styles.textOnlyLeft, 15, 42, 700, 40, context.id));
  }

  // Goal (collapsed: label only; full goal in details drawer)
  if (goal) {
    cells.push(node('GOAL', `Цель: ${short(goal)}`, styles.tag, 15, 84, 260, 50, context.id));
  }

  // Owner appears only when the role/position is known.
  // If we only have a name without a role, do not render it (avoids the "fio without role" issue).
  if (ownerPos) {
    const ownerLabel = [ownerName, ownerPos].filter(Boolean).join(' - ');
    // Place within context group.
    cells.push(node('OWNER', ownerLabel || ownerPos, styles.ownerLabel, 320, 84, 420, 50, context.id));
  }

  // Flow nodes
  const flowX = 260;
  const flowW = 440;
  const startY = 70;
  const gapY = 130;

  if (start) {
    cells.push(node('START', 'Начало', styles.terminator, 50, startY, 220, 70, flow.id));
  }

  // Process (collapsed: title only; description in details drawer)
  cells.push(node('PROC', `Процесс: ${processTitle}`, styles.process, flowX, startY, flowW, 110, flow.id));

  if (product) {
    cells.push(node('PRODUCT', `Продукт: ${short(product)}`, styles.process, flowX, startY + gapY, flowW, 100, flow.id));
  }

  if (end) {
    cells.push(node('END', 'Конец', styles.terminator, flowX, startY + gapY * 2, flowW, 70, flow.id));
  }

  // Minimal arrows, like a flow.
  if (start) edges.push(edge('E_START_PROC', 'START', 'PROC', styles.edge));
  if (product) edges.push(edge('E_PROC_PRODUCT', 'PROC', 'PRODUCT', styles.edge));
  if (product && end) edges.push(edge('E_PRODUCT_END', 'PRODUCT', 'END', styles.edge));

  // Consumers (collapsed labels; details in drawer)
  if (consumers.length) {
    const max = Math.min(10, consumers.length);
    for (let i = 0; i < max; i++) {
      const c: any = consumers[i];
      const kind = typeof c === 'string' ? '' : String(c?.kind || '').trim();
      const label = typeof c === 'string' ? String(c).trim() : String(c?.fullName || c?.name || '').trim();
      const extra = typeof c === 'string' ? '' : String(c?.position || '').trim();
      const shown = [label || (kind === 'org' ? 'Организация' : kind === 'group' ? 'Группа' : 'Персона'), extra]
        .filter(Boolean)
        .join('\n');
      const id = `CONS${i + 1}`;
      const x = 30;
      const y = 60 + i * 90;
      cells.push(node(id, shown, styles.ellipse, x, y, 280, 70, consumersG.id));
      if (product) edges.push(edge(`E_PRODUCT_${id}`, 'PRODUCT', id, styles.edge));
    }
  }

  const mxGraphModelXml = [
    `<mxGraphModel dx="${canvasW}" dy="${canvasH}" grid="1" gridSize="10" guides="1" tooltips="1" connect="0" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827" math="0" shadow="0">`,
    '  <root>',
    '    <mxCell id="0"/>',
    '    <mxCell id="1" parent="0"/>',
    ...cells,
    ...edges,
    '  </root>',
    '</mxGraphModel>',
  ].join('\n');

  const now = new Date().toISOString();
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<mxfile host="app.diagrams.net" modified="${escapeXml(now)}" agent="AISDK" version="22.1.0" type="device">`,
    '  <diagram id="diagram-1" name="Page-1">',
    `    ${mxGraphModelXml.replace(/\n/g, '\n    ')}`,
    '  </diagram>',
    '</mxfile>',
  ].join('\n');
}

export const DocumentPanel = ({ document, onCopy, onEdit, attachments, diagramState }: DocumentPanelProps) => {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [isBundling, setIsBundling] = useState(false);
  const [viewMode, setViewMode] = useState<DocumentViewMode>('document');
  const [selectedDiagramNodeId, setSelectedDiagramNodeId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState(document.title);
  const [draftContent, setDraftContent] = useState(document.content);
  const [localDoc, setLocalDoc] = useState<DocumentState>(document);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep local view in sync when not editing
  useEffect(() => {
    if (!editing) {
      setLocalDoc(document);
      setDraftTitle(document.title);
      setDraftContent(document.content);
    }
  }, [document, editing]);

  // Auto-scroll to bottom when content changes during streaming
  useEffect(() => {
    if (document.isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [document.content, document.isStreaming]);

  const isEmpty = !localDoc.isStreaming && !localDoc.title && !localDoc.content.trim().length;

  const displayTitle = (() => {
    const raw = String(localDoc.title || '').trim();
    if (localDoc.isStreaming) {
      return raw || 'Генерация документа…';
    }

    const generic =
      !raw ||
      raw.toLowerCase() === 'чат' ||
      raw.toLowerCase() === 'документ' ||
      raw.toLowerCase() === 'пример документа';
    const fromContent = extractTitleFromMarkdown(localDoc.content);
    return generic && fromContent ? fromContent : raw || 'Пример документа';
  })();

  const viewContent = isEmpty ? 'Описание: пример описания.' : localDoc.content;

  const formattedContent = useMemo(() => formatDocumentContent(viewContent), [viewContent]);

  const drawioXml = useMemo(() => buildDrawioXmlFromState(displayTitle, diagramState), [displayTitle, diagramState]);

  const selectedDetails = useMemo(() => {
    const id = (selectedDiagramNodeId || '').toUpperCase();
    if (!id) return null;

    if (id.startsWith('GROUP_')) return null;

    const s = diagramState || null;
    const getConsumersArray = () => (Array.isArray(s?.consumers) ? s!.consumers! : []);

    const build = (title: string, body: string) => {
      const cleaned = String(body || '').trim();
      return cleaned ? { title, body: cleaned } : null;
    };

    if (id === 'PROC') {
      const name = String(s?.process?.name || '').trim();
      const desc = String(s?.process?.description || '').trim();
      return build('Процесс', [name, desc].filter(Boolean).join('\n\n'));
    }
    if (id === 'ORG') {
      const name = String(s?.organization?.name || '').trim();
      const activity = String(s?.organization?.activity || '').trim();
      return build('Организация', [name, activity].filter(Boolean).join('\n\n'));
    }
    if (id === 'GOAL') {
      return build('Цель', String(s?.goal || '').trim());
    }
    if (id === 'OWNER') {
      const fullName = String(s?.owner?.fullName || '').trim();
      const position = String(s?.owner?.position || '').trim();
      return build('Владелец', [fullName, position].filter(Boolean).join('\n'));
    }
    if (id === 'PRODUCT') {
      return build('Продукт', String(s?.product || '').trim());
    }
    if (id === 'START') {
      return build('Начало', String(s?.boundaries?.start || '').trim());
    }
    if (id === 'END') {
      return build('Конец', String(s?.boundaries?.end || '').trim());
    }
    const m = id.match(/^CONS(\d+)$/i);
    if (m?.[1]) {
      const idx = Math.max(0, Number(m[1]) - 1);
      const c = getConsumersArray()[idx] as any;
      const label = typeof c === 'string' ? String(c).trim() : String(c?.fullName || c?.name || '').trim();
      const extra = typeof c === 'string' ? '' : String(c?.position || '').trim();
      return build('Потребитель', [label, extra].filter(Boolean).join('\n'));
    }

    return null;
  }, [diagramState, selectedDiagramNodeId]);

  const handleCopy = async () => {
    const formatted = `# ${displayTitle}\n\n${viewContent}`;

    try {
      await navigator.clipboard.writeText(formatted);
      setCopied(true);
      onCopy?.({ title: document.title, content: document.content });
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Ошибка при копировании:', err);
    }
  };

  const handleDownloadBundle = async () => {
    if (isBundling) return;

    setIsBundling(true);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      const docFilename = sanitizeFilename(displayTitle, 'document') + '.md';
      const docBody = `# ${displayTitle}\n\n${viewContent}`;
      zip.file(docFilename, docBody);

      const list = Array.isArray(attachments) ? attachments : [];
      if (list.length > 0) {
        const folder = zip.folder('Загруженные документы');
        const usedNames = new Set<string>();

        for (const att of list) {
          const url = att?.url;
          if (!url) continue;

          const base = sanitizeFilename(att?.name || '', 'attachment');
          let candidate = base;
          let i = 1;
          while (usedNames.has(candidate)) {
            candidate = `${base}-${i++}`;
          }
          usedNames.add(candidate);

          try {
            const res = await fetch(url);
            if (!res.ok) continue;
            const buf = await res.arrayBuffer();
            folder?.file(candidate, buf);
          } catch {
            // skip broken attachment
          }
        }
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const objectUrl = URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = objectUrl;
      link.download = sanitizeFilename(displayTitle, 'documents') + '.zip';
      window.document.body.appendChild(link);
      link.click();
      window.document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
    } finally {
      setIsBundling(false);
    }
  };

  const handleDownloadAttachment = async (att: Attachment) => {
    const url = att?.url;
    if (!url) return;

    const filename = (att?.name || 'attachment')
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 140);

    try {
      if (url.startsWith('data:')) {
        const link = window.document.createElement('a');
        link.href = url;
        link.download = filename;
        window.document.body.appendChild(link);
        link.click();
        window.document.body.removeChild(link);
        return;
      }

      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch attachment');
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      window.document.body.appendChild(link);
      link.click();
      window.document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      console.warn('Failed to download attachment', e);
    }
  };

  const startEdit = () => {
    setEditing(true);
    setDraftTitle(localDoc.title);
    setDraftContent(localDoc.content);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraftTitle(localDoc.title);
    setDraftContent(localDoc.content);
  };

  const saveEdit = () => {
    const updated: DocumentState = {
      ...localDoc,
      title: draftTitle,
      content: draftContent,
    };
    setLocalDoc(updated);
    setEditing(false);
    onEdit?.(updated);
  };

  return (
    <div className="flex-1 bg-background border-l overflow-hidden flex flex-col">
      <div className="flex items-center justify-between p-4 border-b bg-background z-10">
        <h2 className="text-xl font-semibold truncate" title={displayTitle}>
          {displayTitle}
        </h2>

        <div className="flex items-center gap-2 shrink-0">
          {document.isStreaming && (
            <span className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700 animate-pulse">Генерация...</span>
          )}

          {!editing && (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant={viewMode === 'document' ? 'secondary' : 'outline'}
                onClick={() => setViewMode('document')}
                aria-label="Показать документ"
                title="Документ"
              >
                Документ
              </Button>
              <Button
                type="button"
                size="sm"
                variant={viewMode === 'diagram' ? 'secondary' : 'outline'}
                onClick={() => setViewMode('diagram')}
                aria-label="Показать схему"
                title="Схема"
              >
                Схема
              </Button>
            </div>
          )}

          {!editing ? (
            <>
              <Button
                variant="outline"
                size="icon"
                onClick={startEdit}
                type="button"
                title="Редактировать"
                aria-label="Редактировать"
              >
                <PencilIcon className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handleDownloadBundle}
                type="button"
                title="Скачать ZIP (документ + вложения)"
                aria-label="Скачать ZIP (документ + вложения)"
                disabled={isBundling}
              >
                <Download className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handleCopy}
                type="button"
                title={copied ? 'Скопировано' : 'Скопировать'}
                aria-label={copied ? 'Скопировано' : 'Скопировать'}
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="icon"
                onClick={saveEdit}
                type="button"
                title="Сохранить"
                aria-label="Сохранить"
              >
                <Check className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={cancelEdit}
                type="button"
                title="Отмена"
                aria-label="Отмена"
              >
                <X className="size-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto p-6">
        {editing ? (
          <div className="space-y-3">
            <input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder="Заголовок"
              className="w-full border rounded px-3 py-2 text-sm"
            />
            <textarea
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              placeholder="Markdown содержимое"
              className="w-full h-[60vh] border rounded px-3 py-2 text-sm font-mono whitespace-pre-wrap"
            />
          </div>
        ) : (
          <>
            <div className={viewMode === 'diagram' ? '' : 'hidden'}>
              {drawioXml ? (
                <LocalFlowDiagram
                  className="w-full h-[60vh]"
                  xml={drawioXml}
                  ariaLabel="Схема документа"
                  onNodeClick={(nodeId) => {
                    setSelectedDiagramNodeId((prev) => (prev?.toUpperCase() === nodeId.toUpperCase() ? null : nodeId));
                  }}
                />
              ) : (
                <div className="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
                  Недостаточно данных для схемы. Продолжайте диалог — схема заполняется из фактов чата.
                </div>
              )}

              <Collapsible open={Boolean(selectedDetails)}>
                <CollapsibleContent>
                  {selectedDetails ? (
                    <div className="mt-3 rounded-md border bg-background p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-sm font-semibold">{selectedDetails.title}</div>
                        <Button type="button" size="sm" variant="outline" onClick={() => setSelectedDiagramNodeId(null)}>
                          Скрыть
                        </Button>
                      </div>
                      <div className="mt-2 whitespace-pre-wrap text-sm text-foreground">{selectedDetails.body}</div>
                    </div>
                  ) : null}
                </CollapsibleContent>
              </Collapsible>
            </div>

            <div className={viewMode === 'document' ? '' : 'hidden'}>
              <Response className="prose prose-sm max-w-none dark:prose-invert" remarkPlugins={[remarkBreaks]}>
                {formattedContent}
              </Response>
            </div>
          </>
        )}
      </div>

      {Array.isArray(attachments) && attachments.length > 0 && (
        <div className="border-t bg-background px-4 py-2">
          <div className="flex items-center gap-2">
            <div className="text-xs font-medium text-muted-foreground">Загруженные документы</div>
          </div>
          <div className="mt-2 max-h-40 overflow-y-auto no-scrollbar pr-1">
            <div className="flex flex-wrap gap-2">
              {attachments.map((att, idx) => {
                const name = att?.name || 'attachment';
                const canDownload = Boolean(att?.url);
                const extension = (att?.name || '').split('.').pop()?.toUpperCase();
                const showImage = isImageAttachment(att);
                const accent = getAttachmentAccentClass(att);

                return (
                  <div
                    key={att?.id || `${name}-${idx}`}
                    className={`group relative h-14 w-14 overflow-hidden rounded-md border bg-muted/20 transition-colors ${canDownload ? 'cursor-pointer hover:bg-muted/30' : ''}`}
                    title={name}
                    role={canDownload ? 'button' : undefined}
                    tabIndex={canDownload ? 0 : -1}
                    onClick={() => {
                      if (!canDownload) return;
                      handleDownloadAttachment(att);
                    }}
                    onKeyDown={(e) => {
                      if (!canDownload) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleDownloadAttachment(att);
                      }
                    }}
                  >
                    {showImage ? (
                      <img alt={name} className="size-full rounded-md object-cover" height={56} src={att?.url} width={56} />
                    ) : (
                      <div className="flex size-full flex-col items-center justify-center gap-1">
                        <span className={accent}>{getAttachmentIcon(att, accent)}</span>
                        <span className="text-[10px] font-medium uppercase tracking-wide">{extension || 'FILE'}</span>
                      </div>
                    )}

                    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-black/60 px-1 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                      <span className="truncate" title={name}>
                        {name}
                      </span>
                    </div>

                    <Button
                      aria-label="Скачать файл"
                      className="-right-1.5 -top-1.5 absolute h-6 w-6 rounded-full opacity-0 group-hover:opacity-100"
                      disabled={!canDownload}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownloadAttachment(att);
                      }}
                      size="icon"
                      type="button"
                      variant="outline"
                      title="Скачать файл"
                    >
                      <Download className="h-3 w-3" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
