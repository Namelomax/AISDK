'use client';

import { useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';

export default function ChatPage() {
  const [input, setInput] = useState('');

  // useChat с транспортом к нашему API
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat', // наш API route
    }),
  });

  return (
    <div className="flex flex-col w-full max-w-md py-24 mx-auto">
      <div className="flex-1 overflow-y-auto space-y-2">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`whitespace-pre-wrap p-2 rounded ${
              message.role === 'user' ? 'bg-blue-100 text-right ml-auto' : 'bg-gray-100 text-left mr-auto'
            }`}
          >
            <strong>{message.role === 'user' ? 'Вы: ' : 'Бот: '}</strong>
            {message.parts.map((part: any, i: number) => {
              if (part.type === 'text') return <div key={i}>{part.text}</div>;
              return null;
            })}
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim()) return;
          sendMessage({ text: input });
          setInput('');
        }}
        className="mt-4 flex gap-2"
      >
        <input
          type="text"
          className="flex-1 p-2 border rounded"
          placeholder="Напишите сообщение..."
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          disabled={status !== 'ready'}
        />
        <button
          type="submit"
          className="px-4 py-2 bg-blue-500 text-white rounded"
          disabled={status !== 'ready' || !input.trim()}
        >
          Отправить
        </button>
      </form>
    </div>
  );
}
