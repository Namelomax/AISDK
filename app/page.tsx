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
import { PromptInput, PromptInputTextarea, PromptInputSubmit,PromptInputMessage } from '@/components/ai-elements/prompt-input';
import { Response } from '@/components/ai-elements/response';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning';
import { Actions, Action } from '@/components/ai-elements/actions';
import { Loader } from '@/components/ai-elements/loader';

import { RefreshCcwIcon, CopyIcon, CheckIcon  } from 'lucide-react';

type UIMessagePartAny = {
  type: string;
  text?: string;
  input?: any;
  output?: any;
  state?: string;
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

const handleCopyToolResult = async (output: any, toolId: string) => {
  try {
    const text = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
    await navigator.clipboard.writeText(text);
    setCopiedId(`tool-${toolId}`);
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
// Добавь эти типы после импортов
type SerpToolUIPart = {
  type: 'tool-serp';
  toolCallId: string;
  state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
  input: unknown;
  output?: {
    results?: Array<{
      title?: string;
      link?: string;
      snippet?: string;
      position?: number;
    }>;
    searchParameters?: {
      q: string;
      location?: string;
    };
  };
};

type WeatherToolUIPart = {
  type: 'tool-fetch_weather_data';
  toolCallId: string;
  state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
  input: unknown;
  output?: {
    temperature?: number;
    condition?: string;
    location?: string;
    humidity?: number;
    windSpeed?: number;
  };
};

type UIMessagePart = SerpToolUIPart | WeatherToolUIPart | {
  type: string;
  text?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
};
  return (
    <div className="h-screen flex bg-background">
      {/* Left Chat */}
      <div className="flex-1 flex flex-col border-r">
        <Conversation>
          <ConversationContent>
            {messages.map((message) => {
              const textParts = message.parts.filter(p => p.type === 'text');
              const reasoningParts = message.parts.filter(p => p.type === 'reasoning');
              const toolParts = message.parts.filter(p => p.type.startsWith('tool-'));
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

{/* Right Tools Panel */}
<div className="w-96 bg-muted/30 overflow-auto">
  <div className="p-6">
    <h2 className="text-lg font-semibold mb-4 sticky top-0 bg-muted/30 pb-2">
      Инструменты и Reasoning
    </h2>

    {messages.length === 0 && (
      <p className="text-sm text-muted-foreground">
        Информация об использовании инструментов будет здесь
      </p>
    )}

    {messages.map((message) => {
      const toolParts = message.parts.filter(p => p.type.startsWith('tool-'));
      if (!toolParts.length) return null;

      return toolParts.map((part, i) => {
        // Serp tool
        if (part.type === 'tool-serp') {
          const serpTool = part as SerpToolUIPart;
          return (
            <div key={`${message.id}-${i}`} className="bg-background rounded-lg border p-3 space-y-2 mb-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Поиск в интернете</span>
                <span className={`text-xs px-2 py-0.5 rounded ${
                  serpTool.state === 'output-available' ? 'bg-green-100 text-green-700' :
                  serpTool.state === 'output-error' ? 'bg-red-100 text-red-700' :
                  'bg-yellow-100 text-yellow-700'
                }`}>
                  {serpTool.state === 'output-available' ? 'Готово' :
                   serpTool.state === 'output-error' ? 'Ошибка' :
                   'В процессе'}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                <div><strong>Запрос:</strong></div>
                <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-auto">
                  {JSON.stringify(serpTool.input, null, 2)}
                </pre>
              </div>
              {serpTool.output && (
                <div className="text-xs text-muted-foreground">
                  <div><strong>Результаты:</strong></div>
                  <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-auto max-h-60">
                    {JSON.stringify(safeSerpOutput(serpTool.output), null, 2)}
                  </pre>
                </div>
              )}
            </div>
          );
        }

        // Weather tool
        if (part.type === 'tool-fetch_weather_data') {
          const weatherTool = part as WeatherToolUIPart;
          return (
            <div key={`${message.id}-${i}`} className="bg-background rounded-lg border p-3 space-y-2 mb-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Получение погоды</span>
                <span className={`text-xs px-2 py-0.5 rounded ${
                  weatherTool.state === 'output-available' ? 'bg-green-100 text-green-700' :
                  weatherTool.state === 'output-error' ? 'bg-red-100 text-red-700' :
                  'bg-yellow-100 text-yellow-700'
                }`}>
                  {weatherTool.state === 'output-available' ? 'Готово' :
                   weatherTool.state === 'output-error' ? 'Ошибка' :
                   'В процессе'}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                <div><strong>Запрос:</strong></div>
                <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-auto">
                  {JSON.stringify(weatherTool.input, null, 2)}
                </pre>
              </div>
              {weatherTool.output && (
                <div className="text-xs text-muted-foreground">
                  <div><strong>Данные о погоде:</strong></div>
                  <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-auto">
                    {JSON.stringify(weatherTool.output, null, 2)}
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
