'use client';

import { useState, useEffect } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { 
  PromptInput, 
  PromptInputTextarea, 
  PromptInputSubmit,
  PromptInputMessage 
} from '@/components/ai-elements/prompt-input';
import { Response } from '@/components/ai-elements/response';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning';
import { Actions, Action } from '@/components/ai-elements/actions';
import { Loader } from '@/components/ai-elements/loader';
import { RefreshCcw, Copy, Check, Wrench } from 'lucide-react';
import { SlidingTabBar } from '@/components/SlidingTabBar';
import { PromptsManager } from './api/promts/PromtsManager';
// Типы для документа
type DocumentState = {
  title: string;
  content: string;
  isStreaming: boolean;
};

// Компонент для отображения инструментов
const ToolsDisplay = ({ tools, isStreaming }: { tools: any[], isStreaming: boolean }) => {
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

export const DocumentPanel = ({ document }: { document: DocumentState }) => {
  const [copied, setCopied] = useState(false);
  const [buffer, setBuffer] = useState('');
useEffect(() => {
  if (!document.isStreaming) {
    setBuffer(document.content);
    return;
  }

  const timeout = setTimeout(() => {
    setBuffer(document.content);
  }, 100);

  return () => clearTimeout(timeout);
}, [document.content, document.isStreaming]);

  // Функция для автоформатирования Markdown
const normalizeMarkdown = (text: string) => {
  return (
    text
      // Добавляем перевод после заголовков, если его нет
      .replace(/(#+ [^\n]+)(?!\n)/g, '$1\n')
      // Добавляем перенос перед следующим заголовком
      .replace(/([^\n])\n(##+)/g, '$1\n\n$2')
      // Убираем тройные переводы строк
      .replace(/\n{3,}/g, '\n\n')
      // 🧹 Убираем пробелы в конце каждой строки (это ключевая строка!)
      .replace(/[ \t]+$/gm, '')
      .trim()
  );
};


  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(`# ${document.title}\n\n${document.content}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Ошибка при копировании:', err);
    }
  };

  if (!document.title) return null;

  return (
    <div className="flex-1 bg-background border-l overflow-auto">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4 sticky top-0 bg-background pb-2 border-b z-10">
          <h2 className="text-xl font-semibold">{document.title}</h2>

          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? 'Скопировано!' : 'Скопировать'}
          </button>

          {document.isStreaming && (
            <span className="ml-3 text-xs px-2 py-1 rounded bg-blue-100 text-blue-700 animate-pulse">
              Генерация...
            </span>
          )}

        </div>

        {/* Отображение Markdown-текста */}
        <Response className="prose prose-sm max-w-none dark:prose-invert">
          {buffer.replace(/\\n/g, '\n')}
        </Response>
      </div>
    </div>
  );
};


export default function ChatPage() {
  const [input, setInput] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [document, setDocument] = useState<DocumentState>({
    title: '',
    content: '',
    isStreaming: false,
  });

  const { messages, sendMessage, status, regenerate } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
    onError: (error) => console.error('Chat error:', error),
    onData: (dataPart) => {
      console.log('📥 Received data:', dataPart);
      
      // Обработка событий документа
      if (dataPart.type === 'data-title') {
        console.log('📄 Document title:', dataPart.data);
        setDocument((prev) => ({
          ...prev,
          title: String(dataPart.data),
          isStreaming: true,
        }));
      }

      if (dataPart.type === 'data-clear') {
        console.log('🧹 Clearing document');
        setDocument((prev) => ({
          ...prev,
          content: '',
          isStreaming: true,
        }));
      }

      if (dataPart.type === 'data-documentDelta') {
        setDocument((prev) => ({
          ...prev,
          content: prev.content + dataPart.data,
        }));
      }

      if (dataPart.type === 'data-finish') {
        console.log('✅ Document finished');
        setDocument((prev) => ({
          ...prev,
          isStreaming: false,
        }));
      }
    },
  });

  const handleSubmit = (message: PromptInputMessage, e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (message.text?.trim()) {
      sendMessage({
  text: message.text,
  metadata: { currentDocument: document },
});

      
      setInput('');
    }
  };

  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Верхняя плашка с вкладками */}
      <div className="border-b p-3 shrink-0">
        <SlidingTabBar onSendPrompt={(promptText) => sendMessage({ text: promptText })} />
      </div>

      {/* Основная область */}
      <div className="flex-1 flex overflow-hidden">
        {/* Левая часть — чат */}
        <div className="w-[700px] flex flex-col border-r shrink-0">
          <Conversation>
            <ConversationContent>
              {messages.map((message) => {
                const textParts = message.parts.filter(
                  (p): p is { type: 'text'; text: string } => p.type === 'text'
                );
                const reasoningParts = message.parts.filter((p) => p.type === 'reasoning');
                const toolParts = message.parts.filter(
                  (p) => p.type.startsWith('tool-') && !p.type.startsWith('tool-data')
                );

                const isLastMessage = message.id === messages.at(-1)?.id;
                const isToolsStreaming = status === 'streaming' && isLastMessage && toolParts.length > 0;

                return (
                  <Message from={message.role} key={message.id}>
                    <MessageContent>
                      {textParts.map((part, i) => {
                        try {
                          const parsed = JSON.parse(part.text);
                          
                          // Если есть только текст - выводим его
                          if (parsed.text && !parsed.document && !parsed.results) {
                            return <Response key={`${message.id}-text-${i}`}>{parsed.text}</Response>;
                          }

                          // Если есть результаты поиска - выводим их
                          if (parsed.results) {
                            return (
                              <div key={`${message.id}-search-${i}`} className="space-y-2">
                                <Response>{parsed.text || 'Результаты поиска:'}</Response>
                                <div className="mt-2 space-y-2 text-sm">
                                  {parsed.results.map((result: any, idx: number) => (
                                    <div key={idx} className="p-3 bg-muted/50 rounded-lg">
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

                          // Обычный текст
                          return <Response key={`${message.id}-text-${i}`}>{part.text}</Response>;
                        } catch {
                          // Не JSON - выводим как есть
                          return <Response key={`${message.id}-text-${i}`}>{part.text}</Response>;
                        }
                      })}

                      {reasoningParts.map((part, i) => (
                        <Reasoning
                          key={i}
                          className="w-full"
                          isStreaming={
                            status === 'streaming' &&
                            i === reasoningParts.length - 1 &&
                            isLastMessage
                          }
                        >
                          <ReasoningTrigger />
                          <ReasoningContent>{part.text}</ReasoningContent>
                        </Reasoning>
                      ))}

                      {toolParts.length > 0 && (
                        <ToolsDisplay tools={toolParts} isStreaming={isToolsStreaming} />
                      )}

                      {textParts.length > 0 && status !== 'streaming' && (
                        <Actions>
                          <Action onClick={() => regenerate()} label="Retry">
                            <RefreshCcw className="size-3" />
                          </Action>
                          <Action
                            onClick={() => {
                              const text = textParts.map(p => {
                                try {
                                  const parsed = JSON.parse(p.text);
                                  return parsed.text || p.text;
                                } catch {
                                  return p.text;
                                }
                              }).join('\n');
                              handleCopy(text, message.id);
                            }}
                            label={copiedId === message.id ? 'Скопировано!' : 'Copy'}
                          >
                            {copiedId === message.id ? (
                              <Check className="size-3" />
                            ) : (
                              <Copy className="size-3" />
                            )}
                          </Action>
                        </Actions>
                      )}
                    </MessageContent>
                  </Message>
                );
              })}

              {status === 'submitted' && <Loader />}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          {/* Поле ввода */}
          <div className="border-t p-4">
            <div className="max-w-3xl mx-auto">
              <PromptInput onSubmit={handleSubmit} className="relative">
                <PromptInputTextarea
                  value={input}
                  placeholder="Напишите сообщение..."
                  onChange={(e) => setInput(e.target.value)}
                  className="min-h-[60px] pr-12 resize-none"
                />
                <PromptInputSubmit
                  status={status === 'streaming' ? 'streaming' : 'ready'}
                  disabled={!input.trim()}
                  className="absolute bottom-3 right-3"
                />
              </PromptInput>
            </div>
          </div>
           {/* Менеджер промптов под полем ввода */}
      <div className="flex justify-between items-center mt-1">
<PromptsManager
  className="mb-4"
  onPromptSelect={async (content) => {
    // ⚡ Отправляем промт в API сразу
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [],           // пустой массив сообщений
          newSystemPrompt: content,  // текст выбранного промта
        }),
      });

      if (!res.ok) throw new Error('Failed to update system prompt');
      console.log('✅ System prompt updated');
    } catch (err) {
      console.error('Failed to send prompt to /api/chat:', err);
    }
  }}
/>

      </div>
        </div>

        {/* Правая часть — документ */}
        <DocumentPanel document={document} />
      </div>
    </div>
  );
}