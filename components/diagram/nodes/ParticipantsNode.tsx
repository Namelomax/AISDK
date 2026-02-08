'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Users } from 'lucide-react';

export type ParticipantsNodeData = {
  participants: Array<{
    role?: string | null;
    name: string;
    fullName?: string | null;
  }>;
};

function ParticipantsNode({ data }: NodeProps) {
  const nodeData = data as ParticipantsNodeData;
  const participants = nodeData.participants || [];

  if (participants.length === 0) {
    return null;
  }

  return (
    <div className="bg-card border-2 border-border rounded-lg p-4 shadow-lg min-w-[220px] max-w-[280px]">
      <Handle type="target" position={Position.Top} className="w-2 h-2" />
      
      <div className="flex items-center gap-2 mb-3 pb-2 border-b">
        <Users className="size-5 text-primary" />
        <h3 className="font-semibold text-sm">Участники процесса</h3>
      </div>
      
      <div className="space-y-2 max-h-[400px] overflow-y-auto">
        {participants.map((participant, index) => {
          const displayName = participant.fullName || participant.name;
          const hasRole = Boolean(participant.role);
          
          return (
            <div
              key={`${displayName}-${index}`}
              className="flex items-start gap-2 p-2 rounded border bg-background/50"
            >
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Users className="size-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                {hasRole && (
                  <div className="text-xs font-medium text-muted-foreground mb-0.5">
                    {participant.role}
                  </div>
                )}
                <div className="text-xs font-medium truncate">
                  {displayName}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      
      <Handle type="source" position={Position.Bottom} className="w-2 h-2" />
    </div>
  );
}

export default memo(ParticipantsNode);
