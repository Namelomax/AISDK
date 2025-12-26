import { AgentContext } from './types';
import { IntentType } from './classifier';

export interface OrchestratorDecision {
  route: IntentType;
  reason: string;
}

// The orchestrator is now a thin layer: it trusts the classifier (LLM-driven) and routes accordingly.
export function decideNextAction(_: AgentContext, intent: IntentType): OrchestratorDecision {
  if (intent === 'document') {
    return { route: 'document', reason: 'Classifier selected document generation.' };
  }

  return { route: 'chat', reason: 'Classifier selected chat.' };
}
