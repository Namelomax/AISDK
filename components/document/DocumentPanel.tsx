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
import { LocalFlowDiagram } from '@/components/document/LocalFlowDiagram';
import { ProcessFlowDiagram } from '@/components/diagram';
import type { Attachment, DocumentState, ProcessDiagramState } from '@/lib/document/types';
import { extractTitleFromMarkdown, formatDocumentContent, sanitizeFilename } from '@/lib/document/formatting';
import { buildDrawioXmlFromState } from '@/lib/document/drawio';

type DocumentViewMode = 'document' | 'diagram';

type DocumentPanelProps = {
  document: DocumentState;
  onCopy?: (payload: { title: string; content: string }) => void;
  onEdit?: (payload: DocumentState) => void;
  attachments?: Attachment[];
  diagramState?: ProcessDiagramState | null;
  diagramSteps?: any[];
  isLoading?: boolean;
};

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

export const DocumentPanel = ({ document, onCopy, onEdit, attachments, diagramState, diagramSteps, isLoading }: DocumentPanelProps) => {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [isBundling, setIsBundling] = useState(false);
  const [viewMode, setViewMode] = useState<DocumentViewMode>('diagram');
  const [userToggledView, setUserToggledView] = useState(false);
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

  // Auto-switch to document view is disabled - diagram is default
  // useEffect(() => {
  //   if (userToggledView) return;
  //   const hasDocContent = Boolean(document.isStreaming || document.title?.trim() || document.content?.trim());
  //   if (hasDocContent && viewMode !== 'document') {
  //     setViewMode('document');
  //   }
  // }, [document.isStreaming, document.title, document.content, userToggledView, viewMode]);

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

  const drawioXml = useMemo(
    () => buildDrawioXmlFromState(displayTitle, diagramState, attachments || []),
    [displayTitle, diagramState, attachments]
  );

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

    const templateMap: Record<string, string> = {
      'WUNQLDYkCMDTQONQ86G9-3': 'PROC',
      'N9EBFPKTY8XSMP5IMMAE-20': 'GOAL',
      'N9EBFPKTY8XSMP5IMMAE-26': 'START',
      'N9EBFPKTY8XSMP5IMMAE-27': 'END',
      'N9EBFPKTY8XSMP5IMMAE-9': 'OWNER_POS',
      'N9EBFPKTY8XSMP5IMMAE-13': 'OWNER_NAME',
      'N9EBFPKTY8XSMP5IMMAE-33': 'PRODUCT',
      'N9EBFPKTY8XSMP5IMMAE-34': 'PRODUCT',
      'N9EBFPKTY8XSMP5IMMAE-39': 'CONS1',
      'N9EBFPKTY8XSMP5IMMAE-43': 'CONS2',
      'N9EBFPKTY8XSMP5IMMAE-47': 'CONS3',
    };

    const mapped = templateMap[id] || id;

    if (mapped === 'PROC') {
      const name = String(s?.process?.name || '').trim();
      const desc = String(s?.process?.description || '').trim();
      return build('Процесс', [name, desc].filter(Boolean).join('\n\n'));
    }
    if (mapped === 'ORG') {
      const name = String(s?.organization?.name || '').trim();
      const activity = String(s?.organization?.activity || '').trim();
      return build('Организация', [name, activity].filter(Boolean).join('\n\n'));
    }
    if (mapped === 'GOAL') {
      return build('Цель', String(s?.goal || '').trim());
    }
    if (mapped === 'OWNER' || mapped === 'OWNER_NAME' || mapped === 'OWNER_POS') {
      const fullName = String(s?.owner?.fullName || '').trim();
      const position = String(s?.owner?.position || '').trim();
      return build('Владелец', [fullName, position].filter(Boolean).join('\n'));
    }
    if (mapped === 'PRODUCT') {
      return build('Продукт', String(s?.product || '').trim());
    }
    if (mapped === 'START') {
      return build('Начало', String(s?.boundaries?.start || '').trim());
    }
    if (mapped === 'END') {
      return build('Конец', String(s?.boundaries?.end || '').trim());
    }
    const m = mapped.match(/^CONS(\d+)$/i);
    if (m?.[1]) {
      const idx = Math.max(0, Number(m[1]) - 1);
      const c = getConsumersArray()[idx] as any;
      const label = typeof c === 'string' ? String(c).trim() : String(c?.fullName || c?.name || '').trim();
      const extra = typeof c === 'string' ? '' : String(c?.position || '').trim();
      return build('Потребитель', [label, extra].filter(Boolean).join('\n'));
    }

    const stepSlots = ['N9EBFPKTY8XSMP5IMMAE-28', 'N9EBFPKTY8XSMP5IMMAE-29', 'N9EBFPKTY8XSMP5IMMAE-30', 'N9EBFPKTY8XSMP5IMMAE-31'];
    const stepIdx = stepSlots.indexOf(id);
    const extraMatch = id.match(/^STEP_(\d+)$/i);
    const extraIdx = extraMatch?.[1] ? Math.max(0, Number(extraMatch[1]) - 1) : -1;
    const idx = stepIdx >= 0 ? stepIdx : extraIdx;
    if (idx >= 0) {
      const graphNodes = Array.isArray(s?.graph?.nodes) ? s!.graph!.nodes! : [];
      const node = graphNodes.filter((n) => {
        const t = String(n?.type || '').toLowerCase();
        return t !== 'doc' && t !== 'document';
      })[idx];
      if (node) {
        const label = String(node.label || '').trim() || `Шаг ${idx + 1}`;
        const details = String((node as any)?.details || '').trim();
        return build(label, details);
      }
    }

    const graphNodes = Array.isArray(s?.graph?.nodes) ? s!.graph!.nodes! : [];
    if (graphNodes.length) {
      const node = graphNodes.find((n) => String(n?.id || '').trim().toUpperCase() === id);
      if (node) {
        const label = String(node.label || '').trim() || id;
        const details = String((node as any)?.details || '').trim();
        return build(label, details);
      }
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
                onClick={() => {
                  setUserToggledView(true);
                  setViewMode('document');
                }}
                aria-label="Показать документ"
                title="Документ"
              >
                Документ
              </Button>
              <Button
                type="button"
                size="sm"
                variant={viewMode === 'diagram' ? 'secondary' : 'outline'}
                onClick={() => {
                  setUserToggledView(true);
                  setViewMode('diagram');
                }}
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
            <div className={viewMode === 'diagram' ? 'w-full h-[80vh] relative' : 'hidden'}>
              {diagramState ? (
                <>
                  <ProcessFlowDiagram
                    className="w-full h-full"
                    state={diagramState}
                    steps={diagramSteps || []}
                  />
                  {isLoading && (
                    <div className="absolute top-3 right-3 flex items-center gap-2 bg-background/90 backdrop-blur-sm border rounded-full px-3 py-1.5 shadow-sm z-10">
                      <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                      <span className="text-xs text-muted-foreground">Обновление схемы...</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center justify-center h-full min-h-[200px]">
                  {isLoading ? (
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
                      <span className="text-sm text-muted-foreground">Формирование схемы...</span>
                    </div>
                  ) : (
                    <div className="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
                      Недостаточно данных для схемы. Продолжайте диалог — схема заполняется из фактов чата.
                    </div>
                  )}
                </div>
              )}
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
