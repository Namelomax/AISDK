import { AgentContext } from './types';
import { classifyIntent } from './classifier';
import { decideNextAction } from './orchestrator';
import { runChatAgent } from './chat-agent';
import { runDocumentAgent } from './document-agent';

export async function runMainAgent(context: AgentContext, systemPrompt: string, userPrompt: string) {
  // 1. Classify Intent
  const intent = await classifyIntent(context);
  
  // 2. Orchestrate Decision
  const decision = decideNextAction(context, intent);

  console.log('🧭 Orchestrator decision:', decision);

  // 3. Route to Agent
  if (decision.route === 'document') {
    return runDocumentAgent(context);
  }

  return runChatAgent(context, systemPrompt, userPrompt);
}
