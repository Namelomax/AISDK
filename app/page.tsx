'use client';

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Message, MessageContent } from '@/components/ai-elements/message';
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputMessage,
  PromptInputSubmit,
} from '@/components/ai-elements/prompt-input';
import { Response } from '@/components/ai-elements/response';
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool';

import { MessageSquare } from 'lucide-react';
import { useChat } from '@ai-sdk/react';
import type { UIMessage, UIMessagePart, ToolUIPart } from 'ai';
import { DefaultChatTransport } from 'ai';
import { useState } from 'react';

// Типизация для примера с погодой
type WeatherToolInput = {
  location: string;
  units: 'celsius' | 'fahrenheit';
};

type WeatherToolOutput = {
  location: string;
  temperature: string;
  conditions: string;
  humidity: string;
  windSpeed: string;
  lastUpdated: string;
};

type WeatherToolUIPart = ToolUIPart<{
  fetch_weather_data: {
    input: WeatherToolInput;
    output: WeatherToolOutput;
  };
}>;

export default function ChatPage() {
  const [input, setInput] = useState('');
  const [messagesBackup, setMessagesBackup] = useState<any[]>([]);
      // Создаём транспорт
  const { messages, sendMessage, status } = useChat({
  transport: new DefaultChatTransport({
    api: '/api/chat',
  }),
  onError: (error) => {
      console.error('Chat error:', error);

      // пушим сообщение об ошибке в локальный state, чтобы отобразить его
      setMessagesBackup((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: 'assistant',
          parts: [{ type: 'text', text: `⚠️ Ошибка: ${error.message || 'Что-то пошло не так'}` }],
        },
      ]);
    },
  });


  const handleSubmit = (message: PromptInputMessage, e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();

  if (message.text?.trim()) {
    sendMessage({ text: message.text });
    setInput('');
  }
};


  return (
    <div className="max-w-4xl mx-auto p-6 relative size-full rounded-lg border h-[600px]">
      <div className="flex flex-col h-full">
        <Conversation>
          <ConversationContent>
            {messages.length === 0 ? (
              <ConversationEmptyState
                icon={<MessageSquare className="size-12" />}
                title="Start a conversation"
                description="Type a message below to begin chatting"
              />
            ) : (
              messages.map((message: UIMessage) => (
                <Message from={message.role} key={message.id}>
                  <MessageContent>
                  <strong>{message.role === 'user' ? 'Вы: ' : 'Бот: '}</strong>
                  {message.parts.map((part: UIMessagePart<any, any>, i: number) => {
                    switch (part.type) {
                      case 'text':
                        return (
                          <Response key={`${message.id}-${i}`}>
                            {part.text}
                          </Response>
                        );

                      case 'tool-fetch_weather_data': {
                        const weatherTool = part as WeatherToolUIPart;
                        return (
                          <Tool key={`${message.id}-${i}`} defaultOpen={true}>
                            <ToolHeader type={part.type} state={weatherTool.state} />
                            <ToolContent>
                              <ToolInput input={weatherTool.input} />
                              <ToolOutput
                                output={
                                  weatherTool.output ? (
                                    <Response>
                                      {formatWeatherResult(weatherTool.output)}
                                    </Response>
                                  ) : undefined
                                }
                                errorText={weatherTool.errorText}
                              />
                            </ToolContent>
                          </Tool>
                        );
                      }

                      default:
                        return null;
                    }
                  })}

                  </MessageContent>
                </Message>
              ))
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        {/* Ввод сообщения */}
        <PromptInput
          onSubmit={handleSubmit}
          className="mt-4 w-full max-w-2xl mx-auto relative"
        >
          <PromptInputTextarea
            value={input}
            placeholder="Say something..."
            onChange={(e) => setInput(e.currentTarget.value)}
            className="pr-12"
          />
          <PromptInputSubmit
            status={status === 'streaming' ? 'streaming' : 'ready'}
            disabled={!input.trim()}
            className="absolute bottom-1 right-1"
          />
        </PromptInput>
      </div>
    </div>
  );
}

function formatWeatherResult(result: WeatherToolOutput): string {
  return `**Weather for ${result.location}**

**Temperature:** ${result.temperature}  
**Conditions:** ${result.conditions}  
**Humidity:** ${result.humidity}  
**Wind Speed:** ${result.windSpeed}  

*Last updated: ${result.lastUpdated}*`;
}
