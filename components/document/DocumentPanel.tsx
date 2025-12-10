'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
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
};

export type DocumentState = {
  title: string;
  content: string;
  isStreaming: boolean;
};

export const DocumentPanel = ({ document, onCopy }: DocumentPanelProps) => {
  const [copied, setCopied] = useState(false);

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

  const shouldRender =
    document.isStreaming ||
    Boolean(document.title) ||
    Boolean(document.content.trim().length);

  if (!shouldRender) return null;

  const displayTitle = document.title || (document.isStreaming ? 'Генерация документа…' : 'Документ');

  const formattedContent = formatDocumentContent(document.content);

  return (
    <div className="flex-1 bg-background border-l overflow-auto">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4 sticky top-0 bg-background pb-2 border-b z-10">
          <h2 className="text-xl font-semibold">{displayTitle}</h2>

          {document.title && (
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? 'Скопировано!' : 'Скопировать'}
            </button>
          )}

          {document.isStreaming && (
            <span className="ml-3 text-xs px-2 py-1 rounded bg-blue-100 text-blue-700 animate-pulse">
              Генерация...
            </span>
          )}
        </div>

        <Response className="prose prose-sm max-w-none dark:prose-invert">
          {formattedContent}
        </Response>
      </div>
    </div>
  );
};
