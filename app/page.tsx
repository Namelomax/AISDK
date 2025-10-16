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
import { RefreshCcwIcon, CopyIcon, CheckIcon } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

type DocumentState = {
  title: string;
  content: string;
  isStreaming: boolean;
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
    onFinish: () => {
      setDocument(prev => ({ ...prev, isStreaming: false }));
    },
  });
// использовать функцию
useEffect(() => {
  messages.forEach((msg) => {
    msg.parts.forEach((part: any) => {
      if (part.type === 'data-title') {
        setDocument(prev => ({ ...prev, title: part.data, isStreaming: true }));
      } else if (part.type === 'data-clear') {
        setDocument(prev => ({ ...prev, content: '', isStreaming: true }));
      } else if (part.type === 'data-documentDelta') {
        setDocument(prev => ({ ...prev, content: prev.content + part.data }));
      } else if (part.type === 'data-finish') {
        setDocument(prev => ({ ...prev, isStreaming: false }));
      }
    });
  });
}, [messages]);


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
    <div className="h-screen flex bg-background">
      {/* Left Chat */}
      <div className="flex-1 flex flex-col border-r">
        <Conversation>
          <ConversationContent>
            {messages.map((message) => {
              const textParts = message.parts.filter(
                (p): p is { type: 'text'; text: string } => p.type === 'text'
              );
              const reasoningParts = message.parts.filter(p => p.type === 'reasoning');
              const messageText = textParts.map(p => p.text).join('\n');

              return (
                <Message from={message.role} key={message.id}>
                  <MessageContent>
                    {/* Text parts */}
                    {textParts.map((part, i) => (
                      <Response key={i}>{part.text}</Response>
                    ))}

                    {/* Reasoning parts */}
                    {reasoningParts.map((part, i) => (
                      <Reasoning
                        key={i}
                        className="w-full"
                        isStreaming={
                          status === 'streaming' &&
                          i === reasoningParts.length - 1 &&
                          message.id === messages.at(-1)?.id
                        }
                      >
                        <ReasoningTrigger />
                        <ReasoningContent>{part.text}</ReasoningContent>
                      </Reasoning>
                    ))}

                    {/* Actions */}
                    {textParts.length > 0 && status !== 'streaming' && (
                      <Actions>
                        <Action onClick={() => regenerate()} label="Retry">
                          <RefreshCcwIcon className="size-3" />
                        </Action>
                        <Action 
                          onClick={() => handleCopy(messageText, message.id)} 
                          label={copiedId === message.id ? 'Скопировано!' : 'Copy'}
                        >
                          {copiedId === message.id ? (
                            <CheckIcon className="size-3" />
                          ) : (
                            <CopyIcon className="size-3" />
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

        {/* Input */}
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

      {/*Использовать Response Middle Document Panel */}
      {document.title && (
        <div className="w-[600px] bg-background border-r overflow-auto">
          <div className="p-6">
            <div className="flex items-center justify-between mb-4 sticky top-0 bg-background pb-2 border-b">
              <h2 className="text-xl font-semibold">{document.title}</h2>
              {document.isStreaming && (
                <span className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700">
                  Генерация...
                </span>
              )}
            </div>
            <div className="prose prose-sm max-w-none">
              <ReactMarkdown>{document.content}</ReactMarkdown>
            </div>
          </div>
        </div>
      )}

      {/* Использовать Response Right Tools Panel */}
      <div className="w-96 bg-muted/30 overflow-auto">
        <div className="p-6">
          <h2 className="text-lg font-semibold mb-4 sticky top-0 bg-muted/30 pb-2">
            Инструменты
          </h2>

          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Информация об использовании инструментов будет здесь
            </p>
          )}

          {messages.map((message) => {
            const toolParts = message.parts.filter(p => 
              p.type.startsWith('tool-') && !p.type.startsWith('tool-data')
            );
            if (!toolParts.length) return null;

            return toolParts.map((part: any, i) => {
              // Serp tool
              if (part.type === 'tool-serp') {
                return (
                  <div key={`${message.id}-${i}`} className="bg-background rounded-lg border p-3 space-y-2 mb-2">
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
                      <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-auto">
                        {JSON.stringify(part.input, null, 2)}
                      </pre>
                    </div>
                    {part.output && (
                      <div className="text-xs text-muted-foreground">
                        <div><strong>Результаты:</strong></div>
                        <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-auto max-h-60">
                          {JSON.stringify(safeSerpOutput(part.output), null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              }

              // Document tools
              if (part.type === 'tool-createDocument' || part.type === 'tool-updateDocument') {
                const isCreate = part.type === 'tool-createDocument';
                return (
                  <div key={`${message.id}-${i}`} className="bg-background rounded-lg border p-3 space-y-2 mb-2">
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
                      <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-auto">
                        {JSON.stringify(part.input, null, 2)}
                      </pre>
                    </div>
                    {part.output && (
                      <div className="text-xs text-muted-foreground">
                        <div><strong>Результат:</strong></div>
                        <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-auto">
                          {JSON.stringify(part.output, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              }

              return null;
            });
          })}
        </div>
      </div>
    </div>
  );
}