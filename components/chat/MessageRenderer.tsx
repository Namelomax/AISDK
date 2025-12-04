'use client';

import { useState } from 'react';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning';
import { Response } from '@/components/ai-elements/response';
import { Actions, Action } from '@/components/ai-elements/actions';
import { RefreshCcw, Copy, Check, Wrench } from 'lucide-react';

const ToolsDisplay = ({ tools, isStreaming }: { tools: any[]; isStreaming: boolean }) => {
  const [isOpen, setIsOpen] = useState(true);

  if (tools.length === 0) return null;

  return (
    <div className="w-full my-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <Wrench className="size-4" />
        <span>Использование инструментов ({tools.length})</span>
        <span className="text-xs">{isOpen ? '▼' : '▶'}</span>
        {isStreaming && (
          <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">
            В процессе...
          </span>
        )}
      </button>

      {isOpen && (
        <div className="mt-2 space-y-2 pl-6 border-l-2 border-border">
          <div className="bg-muted/50 rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">
              Используются специальные агенты для обработки запроса
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

type MessageRendererProps = {
  message: any;
  isLastMessage: boolean;
  status: string;
  copiedId: string | null;
  onRegenerate: () => void;
  onCopy: (text: string, id: string) => void;
};

const sanitizeUserText = (text: string) => {
  const hiddenPattern = /<AI-HIDDEN>[\s\S]*?<\/AI-HIDDEN>/gi;
  const hadHidden = /<AI-HIDDEN>[\s\S]*?<\/AI-HIDDEN>/i.test(text);
  const visible = text.replace(hiddenPattern, '').trim();
  return { visible, hadHidden };
};

const renderTextResponse = (rawText: string, key: string) => {
  const { visible, hadHidden } = sanitizeUserText(rawText);

  if (visible) {
    return <Response key={key}>{visible}</Response>;
  }

  if (hadHidden) {
    return (
      <Response key={key} className="text-muted-foreground text-sm italic">
        Текст, извлечённый из вложения, скрыт и отправлен модели.
      </Response>
    );
  }

  return <Response key={key}>{rawText}</Response>;
};

export const MessageRenderer = ({
  message,
  isLastMessage,
  status,
  copiedId,
  onRegenerate,
  onCopy,
}: MessageRendererProps) => {
  const textParts = message.parts.filter(
    (part: any): part is { type: 'text'; text: string } => part.type === 'text'
  );
  const reasoningParts = message.parts.filter((part: any) => part.type === 'reasoning');
  const toolParts = message.parts.filter(
    (part: any) => part.type.startsWith('tool-') && !part.type.startsWith('tool-data')
  );

  const isToolsStreaming = status === 'streaming' && isLastMessage && toolParts.length > 0;

  return (
    <Message from={message.role}>
      <MessageContent>
        {reasoningParts.map((part: any, index: number) => (
          <Reasoning
            key={index}
            className="w-full"
            isStreaming={status === 'streaming' && index === reasoningParts.length - 1 && isLastMessage}
          >
            <ReasoningTrigger />
            <ReasoningContent>{part.text}</ReasoningContent>
          </Reasoning>
        ))}

        {textParts.map((part: any, index: number) => {
          try {
            const parsed = JSON.parse(part.text);

            if (parsed.text && !parsed.document && !parsed.results) {
              return renderTextResponse(parsed.text, `${message.id}-text-${index}`);
            }

            if (parsed.results) {
              return (
                <div key={`${message.id}-search-${index}`} className="space-y-2">
                  {renderTextResponse(parsed.text || 'Результаты поиска:', `${message.id}-search-heading-${index}`)}
                  <div className="mt-2 space-y-2 text-sm">
                    {parsed.results.map((result: any, resultIndex: number) => (
                      <div key={resultIndex} className="p-3 bg-muted/50 rounded-lg">
                        <a
                          href={result.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-blue-600 hover:underline"
                        >
                          {result.title}
                        </a>
                        <p className="text-xs text-muted-foreground mt-1">{result.snippet}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            }

            return renderTextResponse(part.text, `${message.id}-text-${index}`);
          } catch {
            return renderTextResponse(part.text, `${message.id}-text-${index}`);
          }
        })}

        {toolParts.length > 0 && <ToolsDisplay tools={toolParts} isStreaming={isToolsStreaming} />}

        {textParts.length > 0 && status !== 'streaming' && (
          <Actions>
            <Action onClick={onRegenerate} label="Retry">
              <RefreshCcw className="size-3" />
            </Action>
            <Action
              onClick={() => {
                const text = textParts
                  .map((part: any) => {
                    try {
                      const parsed = JSON.parse(part.text);
                      const candidate = parsed.text || part.text;
                      return sanitizeUserText(candidate).visible || candidate;
                    } catch {
                      const { visible } = sanitizeUserText(part.text);
                      return visible || part.text;
                    }
                  })
                  .join('\n');
                onCopy(text, message.id);
              }}
              label={copiedId === message.id ? 'Скопировано!' : 'Copy'}
            >
              {copiedId === message.id ? <Check className="size-3" /> : <Copy className="size-3" />}
            </Action>
          </Actions>
        )}
      </MessageContent>
    </Message>
  );
};
