'use client';
import { useState, useEffect, useMemo } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { DocumentPanel, DocumentState } from '@/components/document/DocumentPanel';
import { PromptsManager } from './api/promts/PromtsManager';
import { Header } from '@/components/chat/Header';
import { Sidebar } from '@/components/chat/Sidebar';
import { ConversationArea } from '@/components/chat/ConversationArea';
import { PromptInputWrapper } from '@/components/chat/PromptInputWrapper';

export default function ChatPage() {
  const [input, setInput] = useState('');
  const [authUser, setAuthUser] = useState<{ id: string; username: string } | null>(null);
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const toggleAuthMode = () => setAuthMode((prev) => (prev === 'login' ? 'register' : 'login'));
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
  const [lastSavedAssistantId, setLastSavedAssistantId] = useState<string | null>(null);
  useEffect(() => {
    if (!authUser?.id || !conversationId) return;
    if (String(conversationId).startsWith('local-')) return;
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
          setConversationsList(prev => prev.map(conv => conv.id === conversationId ? { ...conv, messages: messages } : conv));
        }
      } catch (e) {
        console.warn('Failed to persist conversation after finish', e);
      }
    })();
  }, [status, messages, authUser?.id, conversationId, lastSavedAssistantId]);

  useEffect(() => {
      const raw = localStorage.getItem('authUser');
      if (raw) setAuthUser(JSON.parse(raw));
  }, []);

  // When authUser is present, fetch conversations
  useEffect(() => {
    if (!authUser?.id) return;
    (async () => {
      try {
        const resp = await fetch(`/api/conversations?userId=${encodeURIComponent(authUser.id)}`);
        const j = await resp.json();
        if (j?.success) {
            const convs = (j.conversations || []).map((c: any) => {
              let msgs = c.messages;
              if ((!Array.isArray(msgs) || msgs.length === 0) && c.messages_raw) {
                  const parsed = JSON.parse(c.messages_raw);
                  if (Array.isArray(parsed)) msgs = parsed;
              }
              return { ...c, messages: msgs };
            });
            setConversationsList(convs);
            const savedConvId = localStorage.getItem('activeConversationId');
            let activeConv = null;
            
            if (savedConvId && j.conversations) {
              activeConv = j.conversations.find((c: any) => c.id === savedConvId);
            }
            
            if (!activeConv && j.conversations && j.conversations.length > 0) {
              activeConv = j.conversations[0];
            }
            
            if (activeConv) {
              setConversationId(activeConv.id);
              setMessages(toUIMessages(activeConv.messages));
              localStorage.setItem('activeConversationId', activeConv.id);
            } else {
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
        // Load last conversation
        if (Array.isArray(json.conversations) && json.conversations.length > 0) {
          try {
            const convs = json.conversations.map((c: any) => {
              let msgs = c.messages;
              if ((!Array.isArray(msgs) || msgs.length === 0) && c.messages_raw) {
                  const parsed = JSON.parse(c.messages_raw);
                  if (Array.isArray(parsed)) msgs = parsed;
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
        if ((!json.conversations || json.conversations.length === 0) && json.user) {
            const resp = await fetch(`/api/conversations?userId=${encodeURIComponent(json.user.id)}`);
            const j = await resp.json();
            if (j?.success) setConversationsList(j.conversations || []);
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

  const removeConversationFromState = (convId: string) => {
    setConversationsList((prev) => {
      const updated = prev.filter((c) => c.id !== convId);
      if (conversationId === convId) {
        if (updated.length > 0) {
          const nextConv = updated[0];
          setConversationId(nextConv.id ?? null);
          if (nextConv?.messages) {
            setMessages(toUIMessages(nextConv.messages));
          } else {
            setMessages([]);
          }
          if (nextConv?.id) {
            localStorage.setItem('activeConversationId', nextConv.id);
          }
        } else {
          setConversationId(null);
          setMessages([]);
          localStorage.removeItem('activeConversationId');
          setDocument({ title: '', content: '', isStreaming: false });
        }
      }
      return updated;
    });
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
      setConversationsList(prev => prev.map(c => c.id === conv.id ? { ...c, title: conv.title } : c));
      return;
    }
  };

  const handleDeleteConversation = async (conv: any) => {
    if (!conv?.id) return;
    const confirmed = window.confirm('Удалить этот чат?');
    if (!confirmed) return;

    if (String(conv.id).startsWith('local-')) {
      removeConversationFromState(conv.id);
      return;
    }

    if (!authUser?.id) {
      alert('Необходимо войти, чтобы удалить сохранённый чат');
      return;
    }

    try {
      const resp = await fetch('/api/conversations', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: conv.id, userId: authUser.id }),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok || !j?.success) {
        throw new Error(j?.message || 'delete failed');
      }
      removeConversationFromState(conv.id);
    } catch (err) {
      console.error('Failed to delete conversation', err);
      alert('Не удалось удалить чат');
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

  const handleNewLocalConversation = () => {
    if (!authUser?.id) return;
    const localId = `local-${Date.now()}`;
    const localConv = {
      id: localId,
      title: `Новый чат ${new Date().toLocaleTimeString()}`,
      created: new Date().toISOString(),
      messages: [],
      local: true,
    } as any;
    setConversationsList((prev) => [localConv, ...prev]);
    setConversationId(localId);
    setMessages([]);
    localStorage.setItem('activeConversationId', localId);
  };

  const handleSelectConversation = (conversation: any) => {
    if (!conversation?.id) return;
    setConversationId(conversation.id);
    setMessages(toUIMessages(conversation.messages));
    localStorage.setItem('activeConversationId', conversation.id);
  };

  return (
    <div className="h-screen flex flex-col bg-background">

      <Header
        authUser={authUser}
        authUsername={authUsername}
        authPassword={authPassword}
        authMode={authMode}
        onAuth={handleAuth}
        onLogout={handleLogout}
        setAuthUsername={setAuthUsername}
        setAuthPassword={setAuthPassword}
        toggleAuthMode={toggleAuthMode}
      />

      {/* Основная область */}
      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          conversations={conversationsList}
          activeId={conversationId}
          onSelect={handleSelectConversation}
          onNewLocal={handleNewLocalConversation}
          onRename={handleRenameConversation}
          onDelete={handleDeleteConversation}
        />
        {/* Центральная часть — чат */}
        <div className="flex flex-col w-[700px] border-r shrink-0">
          <ConversationArea
            chatKey={chatKey}
            messages={messages}
            status={status}
            copiedId={copiedId}
            onRegenerate={regenerate}
            onCopy={handleCopy}
          />

          {/* Поле ввода и менеджер промптов */}
          <div className="border-t p-4">
            <div className="max-w-3xl mx-auto space-y-3">
              <PromptInputWrapper
                className="w-full"
                input={input}
                setInput={setInput}
                status={status}
                authUser={authUser}
                conversationId={conversationId}
                setConversationId={setConversationId}
                setConversationsList={setConversationsList}
                setMessages={setMessages}
                sendMessage={sendMessage}
              />
              <PromptsManager
                className="w-full"
                onPromptSelect={async (content) => {
                  try {
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
        </div>
        {/* Правая часть — документ */}
        <DocumentPanel document={document} />
      </div>
    </div>
  );
}