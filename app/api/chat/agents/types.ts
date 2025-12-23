import { ModelMessage} from 'ai';

export interface AgentContext {
  messages: ModelMessage[];
  userPrompt: string | null;
  userId?: string | null;
  conversationId?: string | null;
  documentContent?: string; // State Injection
  model: any; // The language model instance
}

export interface AgentResponse {
  stream: ReadableStream;
}
