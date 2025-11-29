'use client';

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Loader } from '@/components/ai-elements/loader';
import { MessageRenderer } from '@/components/chat/MessageRenderer';

type ConversationAreaProps = {
  chatKey: string;
  messages: any[];
  status: string;
  copiedId: string | null;
  onRegenerate: () => void;
  onCopy: (text: string, id: string) => void;
};

export const ConversationArea = ({
  chatKey,
  messages,
  status,
  copiedId,
  onRegenerate,
  onCopy,
}: ConversationAreaProps) => {
  const lastMessageId = messages.at(-1)?.id;

  return (
    <Conversation key={chatKey}>
      <ConversationContent>
        {messages.map((message) => (
          <MessageRenderer
            key={message.id}
            message={message}
            isLastMessage={message.id === lastMessageId}
            status={status}
            copiedId={copiedId}
            onRegenerate={onRegenerate}
            onCopy={onCopy}
          />
        ))}

        {status === 'submitted' && <Loader />}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
};
