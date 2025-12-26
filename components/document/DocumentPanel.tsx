'use client';

import { useState, useRef, useEffect } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { Response } from '@/components/ai-elements/response';

const formatDocumentContent = (raw: string) => {
  if (!raw) return '';
  const normalized = raw.replace(/\r\n?/g, '\n');
  return normalized
    .replace(
      /(\*\*\d+\.\s.*?\*\*)(\s*)(?=\n?\s*\d+\.\d)/g,
      (_match, heading) => `${heading}\n\n`
    )
    .replace(
      /(\d+\.\d+\.\s.*?)(\s*)(?=\n?\s*\d+\.\d+\.)/g,
      (_match, heading) => `${heading}\n`
    )
    .replace(/\n(?=\d+\.)/g, '\n\n');
};

type DocumentPanelProps = {
  document: DocumentState;
  onCopy?: (payload: { title: string; content: string }) => void;
  onEdit?: (payload: DocumentState) => void;
};

export type DocumentState = {
  title: string;
  content: string;
  isStreaming: boolean;
};

export const DocumentPanel = ({ document, onCopy, onEdit }: DocumentPanelProps) => {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
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
    if (!document.title) return;
    const formatted = `# ${document.title}\n\n${document.content}`;

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
    if (!document.title) return;
    const formatted = `# ${document.title}\n\n${document.content}`;
    
    // Create blob and download
    const blob = new Blob([formatted], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a');
    
    // Sanitize filename
    const filename = document.title
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

  const shouldRender =
    document.isStreaming ||
    Boolean(localDoc.title) ||
    Boolean(localDoc.content.trim().length);

  if (!shouldRender) return null;

  const displayTitle = localDoc.title || (localDoc.isStreaming ? 'Генерация документа…' : 'Документ');

  const formattedContent = formatDocumentContent(localDoc.content);

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
          {localDoc.title && !editing && (
            <button
              onClick={startEdit}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Редактировать
            </button>
          )}
          {editing && (
            <div className="flex items-center gap-2">
              <button
                onClick={saveEdit}
                className="flex items-center gap-1 text-sm text-foreground px-3 py-1 rounded border hover:bg-accent transition-colors"
              >
                Сохранить
              </button>
              <button
                onClick={cancelEdit}
                className="flex items-center gap-1 text-sm text-muted-foreground px-3 py-1 rounded border hover:bg-accent transition-colors"
              >
                Отмена
              </button>
            </div>
          )}

          {localDoc.title && !editing && (
            <>
              <button
                onClick={handleDownload}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <Download size={16} />
                Скачать
              </button>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? 'Скопировано!' : 'Скопировать'}
              </button>
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
          <Response className="prose prose-sm max-w-none dark:prose-invert">
            {formattedContent}
          </Response>
        )}
      </div>
    </div>
  );
};
