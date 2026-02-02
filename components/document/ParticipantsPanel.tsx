'use client';

import { Users } from 'lucide-react';
import type { ProcessDiagramState } from '@/lib/document/types';

type ParticipantsPanelProps = {
  diagramState?: ProcessDiagramState | null;
  className?: string;
};

export function ParticipantsPanel({ diagramState, className }: ParticipantsPanelProps) {
  const participants = diagramState?.participants || [];

  if (participants.length === 0) {
    return null;
  }

  return (
    <div className={`border-r bg-background ${className || ''}`}>
      <div className="p-4 border-b">
        <div className="flex items-center gap-2">
          <Users className="size-5 text-muted-foreground" />
          <h3 className="font-semibold text-sm">Участники процесса</h3>
        </div>
      </div>
      <div className="p-4 space-y-3 overflow-y-auto max-h-[70vh]">
        {participants.map((participant, index) => {
          const displayName = participant.fullName || participant.name;
          const hasRole = Boolean(participant.role);
          
          return (
            <div
              key={`${displayName}-${index}`}
              className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
            >
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Users className="size-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                {hasRole && (
                  <div className="text-xs font-medium text-muted-foreground mb-0.5">
                    {participant.role}
                  </div>
                )}
                <div className="text-sm font-medium truncate">
                  {displayName}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
