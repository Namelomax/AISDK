'use client';

import { useMemo } from 'react';

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Loader } from '@/components/ai-elements/loader';
import { MessageRenderer } from '@/components/chat/MessageRenderer';
import { useStickToBottomContext } from 'use-stick-to-bottom';
import { useEffect } from 'react';

const AutoScrollOnUpdates = ({ deps }: { deps: unknown }) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  useEffect(() => {
    if (!isAtBottom) return;

    const raf = requestAnimationFrame(() => {
      scrollToBottom({ animation: 'instant' });
    });

    return () => cancelAnimationFrame(raf);
  }, [deps, isAtBottom, scrollToBottom]);

  return null;
};

type ConversationAreaProps = {
  chatKey: string;
  messages: any[];
  status: string;
  copiedId: string | null;
  onRegenerate: (id: string) => void;
  onCopy: (text: string, id: string) => void;
  onEdit?: (id: string, newContent: string) => void;
};

export const ConversationArea = ({
  chatKey,
  messages,
  status,
  copiedId,
  onRegenerate,
  onCopy,
  onEdit,
}: ConversationAreaProps) => {
  const normalizedMessages = useMemo(() => {
    const list = Array.isArray(messages) ? messages : [];
    const seen = new Set<string>();
    const result: any[] = [];
    for (const msg of list) {
      const id = msg?.id ? String(msg.id) : '';
      if (!id) {
        result.push(msg);
        continue;
      }
      if (seen.has(id)) continue;
      seen.add(id);
      result.push(msg);
    }
    return result;
  }, [messages]);

  const lastMessageId = normalizedMessages.at(-1)?.id;

  return (
    <Conversation key={chatKey}>
      <ConversationContent>
        {normalizedMessages.map((message) => (
          <MessageRenderer
            key={message.id}
            message={message}
            isLastMessage={message.id === lastMessageId}
            status={status}
            copiedId={copiedId}
            onRegenerate={onRegenerate}
            onCopy={onCopy}
            onEdit={onEdit}
          />
        ))}

        {status === 'submitted' && <Loader />}

        <AutoScrollOnUpdates deps={messages} />
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
};
