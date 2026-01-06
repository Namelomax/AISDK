'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Check,
  Copy,
  Download,
  FileSpreadsheetIcon,
  FileText,
  FolderDown,
  ImageIcon,
  Paperclip,
  PencilIcon,
  PresentationIcon,
  X,
} from 'lucide-react';
import { Response } from '@/components/ai-elements/response';
import remarkBreaks from 'remark-breaks';
import { Button } from '@/components/ui/button';

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

function getAttachmentIcon(att: Attachment) {
  const name = att?.name || '';
  const ext = getFileExt(name);
  const mt = String(att?.mediaType || '').toLowerCase();

  const isImage = mt.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext);
  if (isImage) return <ImageIcon className="size-4" />;

  const isPresentation =
    mt.includes('presentation') || mt.includes('powerpoint') || ['ppt', 'pptx'].includes(ext);
  if (isPresentation) return <PresentationIcon className="size-4" />;

  const isSpreadsheet =
    mt.includes('spreadsheet') || mt.includes('excel') || ['xls', 'xlsx', 'csv'].includes(ext);
  if (isSpreadsheet) return <FileSpreadsheetIcon className="size-4" />;

  const isDocLike =
    mt.includes('pdf') || mt.includes('word') || mt.includes('text') || ['pdf', 'doc', 'docx', 'txt', 'md', 'rtf'].includes(ext);
  if (isDocLike) return <FileText className="size-4" />;

  return <Paperclip className="size-4" />;
}

export const DocumentPanel = ({ document, onCopy, onEdit, attachments }: DocumentPanelProps) => {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [isBundling, setIsBundling] = useState(false);
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

  const handleDownload = () => {
    const formatted = `# ${displayTitle}\n\n${viewContent}`;
    
    // Create blob and download
    const blob = new Blob([formatted], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a');
    
    // Sanitize filename
    const filename = displayTitle
      .replace(/[<>:"/\\|?*]/g, '') // Remove invalid characters
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .slice(0, 100) // Limit length
      + '.md';
    
    link.href = url;
    link.download = filename;
    window.document.body.appendChild(link);
    link.click();
    window.document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadBundle = async () => {
    if (isBundling) return;
    if (!Array.isArray(attachments) || attachments.length === 0) {
      // Still allow downloading the document itself.
      handleDownload();
      return;
    }

    setIsBundling(true);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      const docFilename = sanitizeFilename(displayTitle, 'document') + '.md';
      const docBody = `# ${displayTitle}\n\n${viewContent}`;
      zip.file(docFilename, docBody);

      const folder = zip.folder('attachments');
      const usedNames = new Set<string>();

      for (const att of attachments) {
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

      const blob = await zip.generateAsync({ type: 'blob' });
      const objectUrl = URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = objectUrl;
      link.download = sanitizeFilename(displayTitle, 'documents') + '_bundle.zip';
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

  const displayTitle =
    localDoc.title || (localDoc.isStreaming ? 'Генерация документа…' : 'Пример документа');

  const viewContent = isEmpty ? 'Описание: пример описания.' : localDoc.content;

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
                title="Скачать папку (ZIP) со всеми файлами"
                aria-label="Скачать папку (ZIP) со всеми файлами"
                disabled={isBundling}
              >
                <FolderDown className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handleDownload}
                type="button"
                title="Скачать документ"
                aria-label="Скачать документ"
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
          <Response
            className="prose prose-sm max-w-none dark:prose-invert"
            remarkPlugins={[remarkBreaks]}
          >
            {formattedContent}
          </Response>
        )}
      </div>

      {Array.isArray(attachments) && attachments.length > 0 && (
        <div className="border-t bg-background px-4 py-2">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
            {attachments.map((att, idx) => {
              const name = att?.name || 'attachment';
              const canDownload = Boolean(att?.url);
              return (
                <div
                  key={att?.id || `${name}-${idx}`}
                  className="group relative flex h-10 w-10 items-center justify-center rounded-md border bg-muted/30"
                  title={name}
                >
                  <span className="text-muted-foreground">{getAttachmentIcon(att)}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    disabled={!canDownload}
                    onClick={() => handleDownloadAttachment(att)}
                    className="absolute right-0 top-0 h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100"
                    title="Скачать файл"
                    aria-label="Скачать файл"
                  >
                    <Download className="size-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
