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

// ✅ Обновлённый компонент DocumentPanel со стримингом через <Response>
const DocumentPanel = ({ messages }: { messages: any[] }) => {
  // Находим последнее сообщение, связанное с документом
  const lastDocMessage = messages.findLast(
    (msg) =>
      msg.parts.some((p: any) =>
        ['data-title', 'data-documentDelta', 'data-clear', 'data-finish'].includes(p.type)
      )
  );

  if (!lastDocMessage) return null;

  const titlePart = lastDocMessage.parts.find((p: any) => p.type === 'data-title');
  const title = titlePart?.data || 'Новый документ';

  const isFinished = lastDocMessage.parts.some((p: any) => p.type === 'data-finish');
  const isStreaming = !isFinished;

  const documentChunks = lastDocMessage.parts.filter(
    (p: any) => p.type === 'data-documentDelta'
  );

  // Для очистки документа при новом создании
  const clearCount = messages.filter((msg) =>
    msg.parts.some((p: any) => p.type === 'data-clear')
  ).length;

  return (
    <div className="w-[600px] bg-background border-r overflow-auto">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4 sticky top-0 bg-background pb-2 border-b">
          <h2 className="text-xl font-semibold">{title}</h2>
          {isStreaming && (
            <span className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700">
              Генерация...
            </span>
          )}
        </div>

        <div key={clearCount} className="prose prose-sm max-w-none">
          {documentChunks.map((part: any, i: number) => (
            <Response key={i}>{part.data}</Response>
          ))}
        </div>
      </div>
    </div>
  );
};

export default function ChatPage() {
  const [input, setInput] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { messages, sendMessage, status, regenerate } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
    onError: (error) => console.error(error),
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
                disabled={!input.trim() || status === 'streaming'}
                className="absolute bottom-3 right-3"
              />
            </PromptInput>
          </div>
        </div>
      </div>

      {/* Правая часть — документ */}
      <DocumentPanel messages={messages} />
    </div>
  );
}
