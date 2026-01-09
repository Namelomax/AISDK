'use client';

import { useMemo, useState, useRef, useEffect } from 'react';
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
import { Response } from '@/components/ai-elements/response';
import remarkBreaks from 'remark-breaks';
import { Button } from '@/components/ui/button';
import { MermaidDiagram } from '@/components/document/MermaidDiagram';

const formatDocumentContent = (raw: string) => {
  if (!raw) return '';
  const normalized = raw.replace(/\r\n?/g, '\n');
  // Preserve manual indentation by converting leading spaces on each line to non-breaking spaces
  return normalized.replace(/^(\s+)/gm, (m) => m.replace(/ /g, '\u00A0'));
};

type DocumentPanelProps = {
  document: DocumentState;
  onCopy?: (payload: { title: string; content: string }) => void;
  onEdit?: (payload: DocumentState) => void;
  attachments?: Attachment[];
};

export type Attachment = {
  id?: string;
  name?: string;
  url?: string;
  mediaType?: string;
};

export type DocumentState = {
  title: string;
  content: string;
  isStreaming: boolean;
};

type DocumentViewMode = 'document' | 'diagram';

type OutlineNode = {
  text: string;
  level: number;
  children: OutlineNode[];
};

function escapeHtml(input: string) {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeMermaidString(input: string) {
  // Escapes for Mermaid quoted strings: ["..."]
  return String(input || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, ' ');
}

function wrapWords(input: string, maxCharsPerLine: number) {
  const text = String(input || '').trim().replace(/\s+/g, ' ');
  if (!text) return [] as string[];

  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const w of words) {
    if (!current) {
      current = w;
      continue;
    }
    if ((current + ' ' + w).length <= maxCharsPerLine) {
      current = current + ' ' + w;
    } else {
      lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function buildMermaidLabel(input: string, maxCharsPerLine: number) {
  const lines = wrapWords(input, maxCharsPerLine);
  const html = lines.map((l) => escapeHtml(l)).join('<br/>');
  return escapeMermaidString(html);
}

function parseMarkdownToOutline(markdown: string): OutlineNode[] {
  const text = String(markdown || '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');

  const root: OutlineNode = { text: '__root__', level: 0, children: [] };
  const stack: OutlineNode[] = [root];
  let inCodeFence = false;
  let lastHeadingLevel = 1;

  for (const rawLine of lines) {
    const line = rawLine ?? '';
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('```')) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      if (!text) continue;
      lastHeadingLevel = level;

      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      const parent = stack[stack.length - 1] || root;
      const node: OutlineNode = { text, level, children: [] };
      parent.children.push(node);
      stack.push(node);
      continue;
    }

    const listMatch = line.match(/^(\s*)(?:[-*+]|\d+\.)\s+(.+?)\s*$/);
    if (listMatch) {
      const indent = (listMatch[1] || '').replace(/\t/g, '    ').length;
      const depth = Math.floor(indent / 2);
      const level = Math.min(20, lastHeadingLevel + 1 + depth);
      const text = listMatch[2].trim();
      if (!text) continue;

      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      const parent = stack[stack.length - 1] || root;
      const node: OutlineNode = { text, level, children: [] };
      parent.children.push(node);
      stack.push(node);
      continue;
    }
  }

  return root.children;
}

function outlineToMermaidFlowchart(title: string, outline: OutlineNode[]): string {
  const safeTitle = title || 'Документ';
  const lines: string[] = ['flowchart TD'];
  const makeId = (() => {
    let i = 0;
    return () => `n${i++}`;
  })();

  const rootId = makeId();
  lines.push(`  ${rootId}[\"${buildMermaidLabel(safeTitle, 34)}\"]`);

  const emit = (parentId: string, nodes: OutlineNode[]) => {
    for (const node of nodes) {
      const id = makeId();
      const label = buildMermaidLabel(node.text, 34);
      lines.push(`  ${id}["${label}"]`);
      lines.push(`  ${parentId} --> ${id}`);
      if (node.children?.length) emit(id, node.children);
    }
  };

  emit(rootId, outline);
  return lines.join('\n');
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
    mt.includes('pdf') || mt.includes('word') || mt.includes('text') || ['pdf', 'doc', 'docx', 'txt', 'md', 'rtf'].includes(ext);
  if (isDocLike) return <FileText className={className ? `size-4 ${className}` : 'size-4'} />;

  return <Paperclip className={className ? `size-4 ${className}` : 'size-4'} />;
}

function isImageAttachment(att: Attachment) {
  const name = att?.name || '';
  const ext = getFileExt(name);
  const mt = String(att?.mediaType || '').toLowerCase();
  return Boolean(
    (mt.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) &&
      att?.url
  );
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

export const DocumentPanel = ({ document, onCopy, onEdit, attachments }: DocumentPanelProps) => {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [isBundling, setIsBundling] = useState(false);
  const [viewMode, setViewMode] = useState<DocumentViewMode>('document');
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
    return generic && fromContent ? fromContent : (raw || 'Пример документа');
  })();

  const viewContent = isEmpty ? 'Описание: пример описания.' : localDoc.content;

  const diagramSource = editing ? draftContent : viewContent;
  const mermaidCode = useMemo(() => {
    const outline = parseMarkdownToOutline(diagramSource);
    if (!outline.length) return '';
    return outlineToMermaidFlowchart(displayTitle, outline);
  }, [diagramSource, displayTitle]);

  const formattedContent = formatDocumentContent(viewContent);

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
        <h2 className="text-xl font-semibold truncate" title={displayTitle}>{displayTitle}</h2>

        <div className="flex items-center gap-2 shrink-0">
          {document.isStreaming && (
            <span className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700 animate-pulse">
              Генерация...
            </span>
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
              <MermaidDiagram
                className="w-full h-[60vh]"
                code={mermaidCode}
                ariaLabel="Схема документа"
              />
            </div>
            <div className={viewMode === 'document' ? '' : 'hidden'}>
              <Response
                className="prose prose-sm max-w-none dark:prose-invert"
                remarkPlugins={[remarkBreaks]}
              >
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
                    <img
                      alt={name}
                      className="size-full rounded-md object-cover"
                      height={56}
                      src={att?.url}
                      width={56}
                    />
                  ) : (
                    <div className="flex size-full flex-col items-center justify-center gap-1">
                      <span className={accent}>{getAttachmentIcon(att, accent)}</span>
                      <span className="text-[10px] font-medium uppercase tracking-wide">
                        {extension || 'FILE'}
                      </span>
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
