'use client';

import { Dispatch, SetStateAction, FormEvent } from 'react';
import { FileUIPart } from 'ai';
import {
  PromptInput,
  PromptInputAttachments,
  PromptInputAttachment,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputActionAddAttachments,
  PromptInputTextarea,
  PromptInputSubmit,
  PromptInputMessage,
  usePromptInputAttachments,
} from '@/components/ai-elements/prompt-input';
import { extractTextFromFileUIPart, isTextExtractable } from '@/lib/utils';

const AttachmentsSection = () => {
  const attachments = usePromptInputAttachments();

  if (attachments.files.length === 0) return null;

  return (
    <PromptInputAttachments>
      {(attachment) => <PromptInputAttachment data={attachment} />}
    </PromptInputAttachments>
  );
};

const ensureConversationCreated = async (
  authUser: { id: string; username: string } | null,
  conversationId: string | null,
  setConversationsList: Dispatch<SetStateAction<any[]>>,
  setConversationId: Dispatch<SetStateAction<string | null>>,
  setMessages: (messages: any[]) => void,
  initialText: string
) => {
  if (!authUser || (conversationId && !String(conversationId).startsWith('local-'))) {
    return conversationId;
  }

  try {
    const userMsg = {
      id: `m-${Date.now()}`,
      role: 'user',
      content: initialText,
      parts: [{ type: 'text', text: initialText }],
      metadata: {},
    };

    const resp = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: authUser.id,
        title: `Conversation ${new Date().toLocaleString()}`,
        messages: [userMsg],
      }),
    });

    const json = await resp.json();
    if (json?.success && json.conversation) {
      setConversationsList((prev) => {
        const withoutLocal = prev.filter((conv) => !String(conv.id).startsWith('local-'));
        return [json.conversation, ...withoutLocal];
      });
      setConversationId(json.conversation.id);
      setMessages([]);
      localStorage.setItem('activeConversationId', json.conversation.id);
      await new Promise((resolve) => setTimeout(resolve, 60));
      return json.conversation.id;
    }
  } catch (error) {
    console.error('Failed to create conversation before sending message', error);
  }

  return conversationId;
};

type PromptInputWrapperProps = {
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  status: string;
  authUser: { id: string; username: string } | null;
  conversationId: string | null;
  setConversationId: Dispatch<SetStateAction<string | null>>;
  setConversationsList: Dispatch<SetStateAction<any[]>>;
  setMessages: (messages: any[]) => void;
  sendMessage: (payload: { text: string; files?: FileUIPart[] }) => void;
  className?: string;
};

export const PromptInputWrapper = ({
  input,
  setInput,
  status,
  authUser,
  conversationId,
  setConversationId,
  setConversationsList,
  setMessages,
  sendMessage,
  className,
}: PromptInputWrapperProps) => {
  const handleSubmit = async (
    message: PromptInputMessage,
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    if (status !== 'ready') return;

    const hasText = Boolean(message.text);
    const hasAttachments = Boolean(message.files?.length);
    if (!(hasText || hasAttachments)) return;

    let hiddenPart = '';
    const preparedFiles: FileUIPart[] = [];

    if (message.files?.length) {
      for (const file of message.files as FileUIPart[]) {
        const mime = file.mediaType;

        if (isTextExtractable(mime)) {
          try {
            const extracted = await extractTextFromFileUIPart(file);
            hiddenPart += `<AI-HIDDEN>\n${extracted}\n</AI-HIDDEN>\n`;
            continue;
          } catch (error) {
            console.error('Failed extraction:', error);
          }
        }
        preparedFiles.push(file);
      }
    }

    const outgoingText = `${hiddenPart}${(message.text || '').trim()}`;

    await ensureConversationCreated(
      authUser,
      conversationId,
      setConversationsList,
      setConversationId,
      setMessages,
      outgoingText
    );

    sendMessage({
      text: outgoingText,
      files: preparedFiles,
    });

    setInput('');
  };

return (
  <div className={className}>
    <PromptInput
      onSubmit={handleSubmit}
      className="border rounded-lg shadow-sm p-3 flex flex-col gap-2"
      multiple
      globalDrop
    >
      {/* Attachments*/}
      <AttachmentsSection />

      {/* Input Area*/}
      <div className="flex items-end relative">
        <PromptInputTextarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Напишите сообщение или прикрепите файл..."
          className="min-h-[40px] resize-none w-full pr-20"
        />

        {/* Actions*/}
        <div className="absolute right-0 bottom-1 flex items-center gap-2">
          <PromptInputActionMenu>
            <PromptInputActionMenuTrigger />
            <PromptInputActionMenuContent>
              <PromptInputActionAddAttachments />
            </PromptInputActionMenuContent>
          </PromptInputActionMenu>

          <PromptInputSubmit
            status={status === 'streaming' ? 'streaming' : 'ready'}
            disabled={status !== 'ready' || !input.trim()}
          />
        </div>
      </div>

    </PromptInput>
  </div>
);

};
