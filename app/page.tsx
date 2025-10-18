'use client';

import { useState } from 'react';
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
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SlidingTabBar } from '@/components/SlidingTabBar';

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

  const safeSerpOutput = (output: any) => {
    const seen = new WeakSet();
    return JSON.parse(JSON.stringify(output, (k, v) => {
      if (v && typeof v === 'object') {
        if (seen.has(v)) return '[Circular]';
        seen.add(v);
      }
      return v;
    }));
  };

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
          {tools.map((part: any, i) => {
            if (part.type === 'tool-serp') {
              return (
                <div key={i} className="bg-muted/50 rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">🔍 Поиск в интернете</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      part.state === 'output-available' ? 'bg-green-100 text-green-700' :
                      part.state === 'output-error' ? 'bg-red-100 text-red-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      {part.state === 'output-available' ? 'Готово' :
                       part.state === 'output-error' ? 'Ошибка' :
                       'В процессе'}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <div><strong>Запрос:</strong></div>
                    <pre className="mt-1 p-2 bg-background rounded text-xs overflow-auto">
                      {JSON.stringify(part.input, null, 2)}
                    </pre>
                  </div>
                  {part.output && (
                    <div className="text-xs text-muted-foreground">
                      <div><strong>Результаты:</strong></div>
                      <pre className="mt-1 p-2 bg-background rounded text-xs overflow-auto max-h-40">
                        {JSON.stringify(safeSerpOutput(part.output), null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            }

            if (part.type === 'tool-createDocument' || part.type === 'tool-updateDocument') {
              const isCreate = part.type === 'tool-createDocument';
              return (
                <div key={i} className="bg-muted/50 rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {isCreate ? '📝 Создание документа' : '✏️ Обновление документа'}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      part.state === 'output-available' ? 'bg-green-100 text-green-700' :
                      part.state === 'output-error' ? 'bg-red-100 text-red-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      {part.state === 'output-available' ? 'Готово' :
                       part.state === 'output-error' ? 'Ошибка' :
                       'В процессе'}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <div><strong>Параметры:</strong></div>
                    <pre className="mt-1 p-2 bg-background rounded text-xs overflow-auto">
                      {JSON.stringify(part.input, null, 2)}
                    </pre>
                  </div>
                  {part.output && (
                    <div className="text-xs text-muted-foreground">
                      <div><strong>Результат:</strong></div>
                      <pre className="mt-1 p-2 bg-background rounded text-xs overflow-auto">
                        {JSON.stringify(part.output, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            }

            return null;
          })}
        </div>
      )}
    </div>
  );
};

const DocumentPanel = ({ document }: { document: DocumentState }) => {
  if (!document.title) return null;

  return (
    <div className=" flex-1 w-[600px] bg-background border-r overflow-auto">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4 sticky top-0 bg-background pb-2 border-b z-10">
          <h2 className="text-xl font-semibold">{document.title}</h2>
          {document.isStreaming && (
            <span className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700 animate-pulse">
              Генерация...
            </span>
          )}
        </div>
      <div className="prose prose-sm max-w-none dark:prose-invert flex 1">
        <Response>{document.content}</Response>
      </div>
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
    onError: (error) => console.error(error),
    onData: (dataPart) => {
      console.log('Received data:', dataPart);
     if (dataPart.type === 'data-title') {
  console.log('Document title:', dataPart.data);
  setDocument((prev) => ({
    ...prev,
    title: String(dataPart.data),
    isStreaming: true,
  }));
}
      // Очистка документа
      if (dataPart.type === 'data-clear') {
        console.log('Clearing document');
        setDocument((prev) => ({
          ...prev,
          content: '',
          isStreaming: true,
        }));
      }
      // Добавление частей документа
      if (dataPart.type === 'data-documentDelta') {
        setDocument((prev) => ({
          ...prev,
          content: prev.content + dataPart.data,
        }));
      }

      // Завершение документа
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
      sendMessage({ text: message.text });
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
    <div className="h-screen flex bg-background">
      {/* Верхняя плашка с вкладками */}
    <div className="border-b p-3">
      <SlidingTabBar onSendPrompt={(promptText) => sendMessage({ text: promptText })} />
    </div>
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
              const messageText = textParts.map((p) => p.text).join('\n');

              const isLastMessage = message.id === messages.at(-1)?.id;
              const isToolsStreaming =
                status === 'streaming' && isLastMessage && toolParts.length > 0;

              return (
                <Message from={message.role} key={message.id}>
                  <MessageContent>
                    {textParts.map((part, i) => (
                      <Response key={i}>{part.text}</Response>
                    ))}

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
                          onClick={() => handleCopy(messageText, message.id)}
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
      </div>

      {/* Правая часть — документ */}
      <DocumentPanel document={document} />
    </div>
  );
}