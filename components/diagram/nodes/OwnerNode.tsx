'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { User } from 'lucide-react';

export type OwnerNodeData = {
  fullName?: string;
  position?: string;
};

function OwnerNode({ data }: NodeProps) {
  const nodeData = data as OwnerNodeData;

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-50 border-2 border-blue-300 dark:bg-blue-900/20 dark:border-blue-700">
      <div className="w-10 h-10 rounded-full bg-blue-200 dark:bg-blue-800 flex items-center justify-center">
        <User className="w-6 h-6 text-blue-600 dark:text-blue-300" />
      </div>
      <div>
        <div className="text-xs text-muted-foreground">
          {nodeData.position || 'Должность'}
        </div>
        <div className="text-sm font-medium text-foreground">
          {nodeData.fullName || 'ФИО'}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="opacity-0" />
    </div>
  );
}

export default memo(OwnerNode);
