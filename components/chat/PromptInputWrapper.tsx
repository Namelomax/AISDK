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

const SubmitButton = ({ status, input }: { status: string; input: string }) => {
  const attachments = usePromptInputAttachments();
  const canSend = status === 'ready' && (input.trim().length > 0 || attachments.files.length > 0);

  return (
    <PromptInputSubmit
      status={status === 'streaming' ? 'streaming' : 'ready'}
      disabled={!canSend}
    />
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
  sendMessage: (payload: any, options?: any) => void;
  className?: string;
  selectedPromptId?: string | null;
  documentContent?: string;
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
  selectedPromptId,
  documentContent,
}: PromptInputWrapperProps) => {
  const handleSubmit = async (
    message: PromptInputMessage,
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    if (status !== 'ready') return;

    const preparedFiles: FileUIPart[] = [];
    const extractedHiddenTexts: string[] = [];
    const trimmedText = (message.text || '').trim();

    if (message.files?.length) {
      for (const file of message.files as FileUIPart[]) {
        const mime = file.mediaType;

        if (mime && isTextExtractable(mime)) {
          try {
            const extracted = await extractTextFromFileUIPart(file);
            if (extracted.trim().length > 0) {
              extractedHiddenTexts.push(extracted.trim());
            }
          } catch (error) {
            console.error('Failed extraction:', error);
          }
        }

        // Always keep the file as an attachment so it is visible in the UI/history
        preparedFiles.push(file);
      }
    }

    const hasPayload = Boolean(trimmedText) || preparedFiles.length > 0 || extractedHiddenTexts.length > 0;
    if (!hasPayload) return;

    await ensureConversationCreated(
      authUser,
      conversationId,
      setConversationsList,
      setConversationId,
      setMessages,
      trimmedText
    );

    sendMessage({
      text: trimmedText,
      files: preparedFiles,
      // pass hidden extracted text for server-side system injection
      ...(extractedHiddenTexts.length ? { metadata: { hiddenTexts: extractedHiddenTexts } } : {}),
    } as any, {
      body: { 
        selectedPromptId,
        documentContent: documentContent || undefined 
      }
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

          <SubmitButton status={status} input={input} />
        </div>
      </div>

    </PromptInput>
  </div>
);

};
