'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

export type HeaderNodeData = {
  label: string;
  type: 'organization' | 'process';
};

function HeaderNode({ data }: NodeProps) {
  const nodeData = data as HeaderNodeData;
  const isOrg = nodeData.type === 'organization';
  
  return (
    <div
      className={`px-6 py-4 rounded-lg border-2 min-w-[400px] text-center ${
        isOrg
          ? 'bg-gray-100 border-gray-400 dark:bg-gray-800 dark:border-gray-600'
          : 'bg-white border-gray-300 dark:bg-gray-900 dark:border-gray-700'
      }`}
    >
      <div className="text-lg font-semibold text-foreground">
        {nodeData.label || (isOrg ? 'Организация' : 'Процесс')}
      </div>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </div>
  );
}

export default memo(HeaderNode);
