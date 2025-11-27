'use client';
import {
  PromptInputAttachments,
  PromptInputAttachment,
  PromptInputActionMenu,
  PromptInputActionMenuTrigger,
  PromptInputActionMenuContent,
  PromptInputActionAddAttachments,
} from '@/components/ai-elements/prompt-input';

import { useState, useEffect, useMemo } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, FileUIPart } from 'ai';
import { extractTextFromFileUIPart, isTextExtractable } from '@/lib/utils';
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
import { RefreshCcw, Copy, Check, Wrench, Pencil } from 'lucide-react';
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
  const [authUser, setAuthUser] = useState<{ id: string; username: string } | null>(null);
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  // initialMessages теперь используется только как начальное пустое значение;
  // дальнейшая загрузка идет напрямую через setMessages из useChat
  const [initialMessages] = useState<any[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [document, setDocument] = useState<DocumentState>({
    title: '',
    content: '',
    isStreaming: false,
  });

  // Custom fetch to inject userId and conversationId into every chat request body
  const [conversationsList, setConversationsList] = useState<any[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);

  // Нормализация сообщений из БД в формат UIMessage
  function toUIMessages(raw: any[]): any[] {
    if (!Array.isArray(raw)) return [];
    return raw.map(m => ({
      id: m.id,
      role: m.role === 'assistant' ? 'assistant' : 'user',
      parts: Array.isArray(m.parts) && m.parts.length > 0
        ? m.parts
        : [{ type: 'text', text: m.text || '' }],
      metadata: m.metadata || {},
    }));
  }

  // Build transport API URL with userId and conversationId as query params
  const transport = useMemo(() => {
    const base = '/api/chat';
    const params: string[] = [];
    if (authUser?.id) params.push(`userId=${encodeURIComponent(authUser.id)}`);
    if (conversationId) params.push(`conversationId=${encodeURIComponent(conversationId)}`);
    const api = params.length ? `${base}?${params.join('&')}` : base;
    return new DefaultChatTransport({ api });
  }, [authUser?.id, conversationId]);

  const chatKey = `${conversationId ?? 'no'}-${authUser?.id ?? 'anon'}`;
  const { messages, sendMessage, status, regenerate, setMessages } = useChat({
    transport,
    messages: initialMessages,
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

  // Persist conversation after each assistant response finishes streaming
  const [lastSavedAssistantId, setLastSavedAssistantId] = useState<string | null>(null);
  useEffect(() => {
    if (!authUser?.id || !conversationId) return;
    if (String(conversationId).startsWith('local-')) return; // don't persist local placeholder
    if (status === 'streaming') return;
    const last = messages.at(-1);
    if (!last || last.role !== 'assistant') return;
    if (last.id === lastSavedAssistantId) return;
    (async () => {
      try {
        const resp = await fetch('/api/conversations', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId, messages }),
        });
        const j = await resp.json();
        if (j?.success) {
          setLastSavedAssistantId(last.id);
          // локально обновляем сохранённый разговор без повторной загрузки
          setConversationsList(prev => prev.map(conv => conv.id === conversationId ? { ...conv, messages: messages } : conv));
        }
      } catch (e) {
        console.warn('Failed to persist conversation after finish', e);
      }
    })();
  }, [status, messages, authUser?.id, conversationId, lastSavedAssistantId]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('authUser');
      if (raw) setAuthUser(JSON.parse(raw));
    } catch (e) {
      /* ignore */
    }
  }, []);

  // When authUser is present (including after page reload), fetch conversations
  useEffect(() => {
    if (!authUser?.id) return;
    (async () => {
      try {
        const resp = await fetch(`/api/conversations?userId=${encodeURIComponent(authUser.id)}`);
        const j = await resp.json();
        if (j?.success) {
            // Ensure we parse `messages_raw` fallback if server didn't provide `messages` array.
            const convs = (j.conversations || []).map((c: any) => {
              let msgs = c.messages;
              if ((!Array.isArray(msgs) || msgs.length === 0) && c.messages_raw) {
                try {
                  const parsed = JSON.parse(c.messages_raw);
                  if (Array.isArray(parsed)) msgs = parsed;
                } catch (e) {
                  // ignore
                }
              }
              return { ...c, messages: msgs };
            });
            setConversationsList(convs);
            // Try to restore the last active conversation from localStorage
            const savedConvId = localStorage.getItem('activeConversationId');
            let activeConv = null;
            
            if (savedConvId && j.conversations) {
              activeConv = j.conversations.find((c: any) => c.id === savedConvId);
            }
            
            // If no saved conversation, use first one
            if (!activeConv && j.conversations && j.conversations.length > 0) {
              activeConv = j.conversations[0];
            }
            
            if (activeConv) {
              setConversationId(activeConv.id);
              setMessages(toUIMessages(activeConv.messages));
              localStorage.setItem('activeConversationId', activeConv.id);
            } else {
                      // don't auto-create an empty conversation here; wait until the user sends the first message
                      setConversationsList([]);
                      setConversationId(null);
            }
        }
      } catch (e) {
        console.warn('Failed to fetch conversations on load', e);
      }
    })();
  }, [authUser?.id]);

  const handleAuth = async () => {
    if (!authUsername || !authPassword) return;
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: authMode, username: authUsername, password: authPassword }),
      });
      const json = await res.json();
      if (json?.success && json.user) {
        setAuthUser(json.user);
        localStorage.setItem('authUser', JSON.stringify(json.user));
        setAuthPassword('');
        // Load user's last conversation if provided
        if (Array.isArray(json.conversations) && json.conversations.length > 0) {
          try {
            const convs = json.conversations.map((c: any) => {
              let msgs = c.messages;
              if ((!Array.isArray(msgs) || msgs.length === 0) && c.messages_raw) {
                try {
                  const parsed = JSON.parse(c.messages_raw);
                  if (Array.isArray(parsed)) msgs = parsed;
                } catch (e) {
                  /* ignore */
                }
              }
              return { ...c, messages: msgs };
            });
            setConversationsList(convs);
            const first = convs[0];
            if (first) {
              setConversationId(first.id ?? null);
              setMessages(toUIMessages(first.messages));
            }
          } catch (e) {
            console.warn('Failed to normalize conversations from auth response', e);
          }
        }
        // if no conversations in response, try to fetch list
        if ((!json.conversations || json.conversations.length === 0) && json.user) {
          try {
            const resp = await fetch(`/api/conversations?userId=${encodeURIComponent(json.user.id)}`);
            const j = await resp.json();
            if (j?.success) setConversationsList(j.conversations || []);
          } catch (e) { /* ignore */ }
        }
      } else {
        alert(json?.message || 'Auth failed');
      }
    } catch (err) {
      console.error(err);
      alert('Request failed');
    }
  };

  const handleLogout = () => {
    setAuthUser(null);
    localStorage.removeItem('authUser');
    localStorage.removeItem('activeConversationId');
    setConversationsList([]);
    setConversationId(null);
    setMessages([]);
    setDocument({ title: '', content: '', isStreaming: false });
    setInput('');
    setLastSavedAssistantId(null);
  };

  const handleRenameConversation = async (conv: any) => {
    let newTitle = prompt('Введите новое название чата', conv.title || 'Чат');
    if (newTitle === null) return;
    newTitle = newTitle.trim();
    if (!newTitle) return;

    if (String(conv.id).startsWith('local-')) {
      setConversationsList(prev => prev.map(c => c.id === conv.id ? { ...c, title: newTitle } : c));
      return;
    }

    try {
      const resp = await fetch('/api/conversations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: conv.id, title: newTitle }),
      });
      const j = await resp.json();
      if (!j?.success) {
        throw new Error(j?.message || 'rename failed');
      }
      const updated = j.conversation;
      setConversationsList(prev => prev.map(c => c.id === conv.id ? { ...c, title: updated?.title ?? newTitle } : c));
    } catch (e) {
      console.error('Failed to rename conversation', e);
      // revert on failure
      setConversationsList(prev => prev.map(c => c.id === conv.id ? { ...c, title: conv.title } : c));
      return;
    }
  };

const handleSubmit = async (message: PromptInputMessage, e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();

  if (status !== 'ready') {
    return;
  }

  const hasText = Boolean(message.text);
  const hasAttachments = Boolean(message.files?.length);
  if (!(hasText || hasAttachments)) return;

  let hiddenPart = "";
  const preparedFiles: FileUIPart[] = [];

  if (message.files?.length) {
    for (const file of message.files as FileUIPart[]) {
      const mime = file.mediaType;

      if (isTextExtractable(mime)) {
        try {
          const extracted = await extractTextFromFileUIPart(file);

          hiddenPart += `<AI-HIDDEN>\n${extracted}\n</AI-HIDDEN>\n`;

          // ❗ DOCX/XLSX НЕ передаём Gemini как файлы
          continue;
        } catch (e) {
          console.error("Failed extraction:", e);
        }
      }

      // другие форматы — как есть
      preparedFiles.push(file);
    }
  }

  // If user is signed in but there's no conversationId yet,
  // create a conversation first so the server doesn't create one
  // that the client can't reference later.
  if (authUser && (!conversationId || String(conversationId).startsWith('local-'))) {
    try {
      // Prepare the initial user message payload so it's persisted with the conversation
      const userMsg = {
        id: `m-${Date.now()}`,
        role: 'user',
        content: `${hiddenPart}${(message.text || '').trim()}`,
        parts: [{ type: 'text', text: `${hiddenPart}${(message.text || '').trim()}` }],
        metadata: {},
      };

      const resp = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: authUser.id, title: `Conversation ${new Date().toLocaleString()}`, messages: [userMsg] }),
      });
      const j = await resp.json();
      if (j?.success && j.conversation) {
        // Replace any local placeholder with the created conversation record
        setConversationsList(prev => {
          const withoutLocal = prev.filter(p => !String(p.id).startsWith('local-'));
          return [j.conversation, ...withoutLocal];
        });
        setConversationId(j.conversation.id);
        setMessages([]);
        localStorage.setItem('activeConversationId', j.conversation.id);
        // wait a short moment for React to re-render and update the transport
        await new Promise((r) => setTimeout(r, 60));
      }
    } catch (e) {
      console.error('Failed to create conversation before sending message', e);
    }
  }

  sendMessage({
    text: `${hiddenPart}${(message.text || "").trim()}`,
    files: preparedFiles, // только FileUIPart[]
  });

  // messages will be saved on the server side using conversationId from useChat body

  setInput("");
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

      {/* Auth header */}
      <div className="p-3 border-b bg-muted/5">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="text-sm text-muted-foreground">Регламентер</div>
          <div>
            {authUser ? (
              <div className="flex items-center gap-3">
                <div className="text-sm">Signed in as <strong>{authUser.username}</strong></div>
                <button onClick={handleLogout} className="text-sm px-2 py-1 border rounded">Logout</button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  className="border px-2 py-1 rounded text-sm"
                  placeholder="Username"
                  value={authUsername}
                  onChange={(e) => setAuthUsername(e.target.value)}
                />
                <input
                  className="border px-2 py-1 rounded text-sm"
                  type="password"
                  placeholder="Password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                />
                <button onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')} className="text-sm px-2 py-1 border rounded">
                  {authMode === 'login' ? 'Register' : 'Login'}
                </button>
                <button onClick={handleAuth} className="text-sm px-3 py-1 bg-primary text-black rounded">
                  {authMode === 'login' ? 'Login' : 'Create'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Multi-chat disabled: single conversation mode only */}

      {/* Основная область */}
      <div className="flex-1 flex overflow-hidden">
        {/* Сайдбар со списком чатов */}
        <div className="w-42 border-r flex flex-col shrink-0 bg-muted/10">
          <div className="p-2 flex items-center justify-between border-b">
            <span className="text-xs font-medium">Ваши чаты</span>
            <button
              onClick={async () => {
                if (!authUser?.id) return;
                // Create a local placeholder conversation - persist only when first message is sent
                const localId = `local-${Date.now()}`;
                const localConv = {
                  id: localId,
                  title: `Новый чат ${new Date().toLocaleTimeString()}`,
                  created: new Date().toISOString(),
                  messages: [],
                  local: true,
                } as any;
                setConversationsList(prev => [localConv, ...prev]);
                setConversationId(localId);
                setMessages([]);
                localStorage.setItem('activeConversationId', localId);
              }}
              className="text-xs px-2 py-1 border rounded"
            >Новый</button>
          </div>
          <div className="flex-1 overflow-auto">
            <ul className="text-sm">
              {conversationsList.map(c => (
                <li
                  key={c.id}
                  className={`px-2 py-1 cursor-pointer border-b hover:bg-muted/30 ${c.id === conversationId ? 'bg-muted/50 font-medium' : ''}`}
                  onClick={() => {
                    setConversationId(c.id);
                    setMessages(toUIMessages(c.messages));
                    localStorage.setItem('activeConversationId', c.id);
                  }}
                >
                  <div className="flex items-center gap-1 truncate" title={c.title || 'Чат'}>
                    <span className="flex-1 truncate">{c.title || 'Чат'}</span>
                    <button
                      className="shrink-0 p-0.5 rounded hover:bg-muted"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRenameConversation(c);
                      }}
                    >
                      <Pencil className="w-3 h-3 opacity-70" />
                    </button>
                  </div>
                  <div className="text-[10px] opacity-60 truncate">{c.created?.slice(0, 19)}</div>
                </li>
              ))}
              {conversationsList.length === 0 && (
                <li className="px-2 py-2 text-xs opacity-60">Нет сохранённых чатов</li>
              )}
            </ul>
          </div>
        </div>
        {/* Центральная часть — чат */}
        <div className="flex flex-col w-[700px] border-r shrink-0">
          <Conversation key={chatKey}>
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
{textParts.map((part, i) => {
  // --- Скрываем только AI-HIDDEN ---
  const clean = part.text.trimStart();

  // --- Остальное как раньше ---
  try {
    const parsed = JSON.parse(part.text);

    if (parsed.text && !parsed.document && !parsed.results) {
      return (
        <Response key={`${message.id}-text-${i}`}>
          {parsed.text}
        </Response>
      );
    }

    if (parsed.results) {
      return (
        <div key={`${message.id}-search-${i}`} className="space-y-2">
          <Response>{parsed.text || "Результаты поиска:"}</Response>
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
                <p className="text-xs text-muted-foreground mt-1">
                  {result.snippet}
                </p>
              </div>
            ))}
          </div>
        </div>
      );
    }

    return (
      <Response key={`${message.id}-text-${i}`}>
        {part.text}
      </Response>
    );
  } catch {
    return (
      <Response key={`${message.id}-text-${i}`}>
        {part.text}
      </Response>
    );
  }
})}

                      

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
              <PromptInput
                onSubmit={handleSubmit}
                className="relative border rounded-lg shadow-sm"
                multiple
                globalDrop
              >
                <PromptInputAttachments>
                  {(attachment) => (
                      <PromptInputAttachment data={attachment} />
                    )}
                </PromptInputAttachments>

                <PromptInputTextarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Напишите сообщение или прикрепите файл..."
                  className="min-h-[60px] pr-12 resize-none"
                />

                <PromptInputActionMenu>
                  <PromptInputActionMenuTrigger className="absolute right-10 bottom-3" />
                  <PromptInputActionMenuContent>
                    <PromptInputActionAddAttachments />
                  </PromptInputActionMenuContent>
                </PromptInputActionMenu>

                <PromptInputSubmit
                  status={status === 'streaming' ? 'streaming' : 'ready'}
                  disabled={status !== 'ready' || !input.trim()}
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
    try {
      // When selecting a prompt, only update the global system prompt.
      // Saving prompts to a user's private collection should be an explicit action.
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [], newSystemPrompt: content }),
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