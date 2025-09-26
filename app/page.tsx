"use client";

import { useState } from "react";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, ModelMessage } from "ai";
import { Conversation } from "@/components/ai-elements/conversation";
import { Message } from "@/components/ai-elements/message";
import { PromptInput, PromptInputMessage } from "@/components/ai-elements/prompt-input";
const openrouter = createOpenRouter({
  apiKey: process.env.NEXT_PUBLIC_OPENROUTER_API_KEY!,
});

// Свой тип для сообщений
type ChatMessage = {
  id: string;
  from: "user" | "assistant" | "system"; // ✅ вместо role
  content: string;
};


export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: "1", from: "assistant", content: "🤖 Привет! Я твой AI-бот." },
  ]);



const handleSend = async (message: PromptInputMessage, event: React.FormEvent<HTMLFormElement>) => {
  event.preventDefault(); // чтобы форма не перезагружала страницу

  const userMessage: ChatMessage = {
  id: Date.now().toString(),
  from: "user",
  content: message.text ?? "", // ✅ правильно
};


  const newMessages = [...messages, userMessage];
  setMessages(newMessages);

  try {
    const aiMessages: ModelMessage[] = newMessages.map((m) => ({
  role: m.from,       // 'user' | 'assistant' | 'system'
  content: m.content, // string
}));

const result = await generateText({
  model: openrouter("x-ai/grok-4-fast:free"),
  messages: aiMessages,
  maxOutputTokens: 500,
});

    setMessages([
      ...newMessages,
      { id: crypto.randomUUID(), from: "assistant", content: result.text },
    ]);
  } catch (error: any) {
    console.error("Ошибка генерации:", error.message);
  }
};

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <Conversation>
        {messages.map((m) => (
          <Message key={m.id} from={m.from}>
          {m.content}
          </Message>
        ))}
      </Conversation>
      <PromptInput onSubmit={handleSend} />
    </div>
  );
}
