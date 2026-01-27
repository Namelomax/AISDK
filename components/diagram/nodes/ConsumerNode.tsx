'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { User } from 'lucide-react';

export type ConsumerNodeData = {
  name?: string;
};

function ConsumerNode({ data }: NodeProps) {
  const nodeData = data as ConsumerNodeData;

  return (
    <div className="flex flex-col items-center p-3">
      <div className="w-24 h-16 rounded-full bg-purple-100 border-2 border-purple-400 dark:bg-purple-900/30 dark:border-purple-600 flex items-center justify-center">
        <User className="w-8 h-8 text-purple-500 dark:text-purple-400" />
      </div>
      <span className="text-xs mt-2 text-center max-w-[100px] text-foreground">
        {nodeData.name || 'Потребитель'}
      </span>
      <Handle type="target" position={Position.Left} className="w-2 h-2" />
    </div>
  );
}

export default memo(ConsumerNode);
