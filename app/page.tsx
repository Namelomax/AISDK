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
  const [systemPrompt, setSystemPrompt] = useState(
  "Ты полезный AI-ассистент. Используй инструменты для поиска информации и создания документов по запросу пользователя."
);
  const [input, setInput] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [document, setDocument] = useState<DocumentState>({
    title: '',
    content: '',
    isStreaming: false,
  });
const [currentPrompt, setCurrentPrompt] = useState<string>('');
  const { messages, sendMessage, status, regenerate } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
    onError: (error) => console.error(error),
onData: (dataPart) => {
  console.log('Received data:', dataPart);
  
  //Проверяем, что это обычное сообщение
  if ('text' in dataPart && typeof dataPart.text === 'string') {
    try {
      const parsed = JSON.parse(dataPart.text);
      
      // Если есть документ - обновляем состояние
      if (parsed.document) {
        setDocument({
          title: parsed.document.title,
          content: parsed.document.content,
          isStreaming: false,
        });
      }
    } catch {
      // Не JSON - игнорируем
    }
  }

  // Обработка data-* событий
  if (dataPart.type === 'data-title') {
    console.log('Document title:', dataPart.data);
    setDocument((prev) => ({
      ...prev,
      title: String(dataPart.data),
      isStreaming: true,
    }));
  }

  if (dataPart.type === 'data-clear') {
    console.log('Clearing document');
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
}

  });

  const handleSubmit = (message: PromptInputMessage, e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (message.text?.trim()) {
      console.log(message)
      sendMessage({ text: message.text });
      setInput('');
    }
  };
useEffect(() => {
    console.log("qwer")
  fetch('/api/promts')
    .then(res => res.json())
    .then(data => setCurrentPrompt(data.prompt))
    .catch(err => console.error(err+"ags"));
}, [])
  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error(err);
    }
  };
// Компонент для отображения использованных агентов
const AgentInfo = ({ message, isStreaming }: { message: any; isStreaming: boolean }) => {
  const [isOpen, setIsOpen] = useState(false);
  
  // Проверяем, какой агент использовался
  const textParts = message.parts.filter((p: any) => p.type === 'text');
  const reasoningParts = message.parts.filter((p: any) => p.type === 'reasoning');
  
  let agentType = null;
  let agentData = null;
  
  for (const part of textParts) {
    try {
      const parsed = JSON.parse(part.text);
      if (parsed.results) {
        agentType = 'search';
        agentData = parsed;
      } else if (parsed.document) {
        agentType = 'document';
        agentData = parsed;
      }
    } catch {}
  }
  
  // ✅ Показываем если есть reasoning (агент начал работу) или уже есть результат
  const shouldShow = (reasoningParts.length > 0 || agentType) && message.role === 'assistant';
  
  if (!shouldShow) return null;
  
  // ✅ Определяем статус
  const isProcessing = isStreaming && !agentData;
  const isCompleted = agentData !== null;
  
  return (
    <div className="w-full my-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        {agentType === 'search' ? '🔍' : agentType === 'document' ? '📝' : '🤖'}
        <span>
          {agentType === 'search' ? 'Поиск в интернете' : 
           agentType === 'document' ? 'Создание документа' : 
           'Обработка запроса'}
        </span>
        
        {/* ✅ Динамический статус */}
        {isProcessing && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-700 animate-pulse">
            В процессе...
          </span>
        )}
        {isCompleted && (
          <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700">
            Готово
          </span>
        )}
        
        <span className="text-xs">{isOpen ? '▼' : '▶'}</span>
      </button>

      {isOpen && agentData && (
        <div className="mt-2 space-y-2 pl-6 border-l-2 border-border">
          <div className="bg-muted/50 rounded-lg border p-3 space-y-2">
            {agentType === 'search' && agentData?.results && (
              <>
                <div className="text-sm font-medium">Найденные результаты:</div>
                <div className="space-y-2">
                  {agentData.results.map((result: any, idx: number) => (
                    <div key={idx} className="text-xs">
                      <a 
                        href={result.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-blue-600 hover:underline"
                      >
                        {result.title}
                      </a>
                      <p className="text-muted-foreground mt-1">{result.snippet}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
            
            {agentType === 'document' && agentData?.document && (
              <>
                <div className="text-sm font-medium">Параметры документа:</div>
                <pre className="text-xs p-2 bg-background rounded overflow-auto">
                  {JSON.stringify({
                    title: agentData.document.title,
                    contentLength: agentData.document.content.length
                  }, null, 2)}
                </pre>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
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
                   {textParts.map((part, i) => {
  try {
    const parsed = JSON.parse(part.text);

    return (
      <div key={`${message.id}-text-${i}`} className="space-y-2">
        {/* Основной ответ AI */}
        {parsed.text && <Response>{parsed.text}</Response>}

        {/* Результаты поиска */}
        {parsed.results && parsed.results.length > 0 && (
          <div className="mt-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Источники:</p>
            {parsed.results.map((result: any, idx: number) => (
              <a
                key={`${message.id}-result-${idx}`}
                href={result.link}
                target="_blank"
                rel="noopener noreferrer"
                className="block p-2 text-xs border rounded-lg hover:bg-muted transition-colors"
              >
                <div className="font-medium text-blue-600">{result.title}</div>
                <div className="text-muted-foreground mt-1">{result.snippet}</div>
              </a>
            ))}
          </div>
        )}
      </div>
    );
  } catch {
    // Если part.text не JSON — просто выводим как обычный ответ
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
<AgentInfo message={message} isStreaming={status === 'streaming' && isLastMessage} />
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