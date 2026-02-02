'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

export type BoundaryNodeData = {
  label?: string;
  type: 'start' | 'end';
};

function BoundaryNode({ data }: NodeProps) {
  const nodeData = data as BoundaryNodeData;
  const isStart = nodeData.type === 'start';

  return (
    <div className="flex flex-col items-center">
      <span className="text-xs font-semibold mb-1 text-muted-foreground">
        {isStart ? 'Начало' : 'Конец'}
      </span>
      <div className="max-w-[80px] text-center text-xs text-foreground">
        {nodeData.label || ''}
      </div>
      {isStart ? (
        <Handle type="source" position={Position.Right} className="w-2 h-2" />
      ) : (
        <>
          <Handle type="target" position={Position.Left} className="w-2 h-2" />
          <Handle type="source" position={Position.Right} className="w-2 h-2" />
        </>
      )}
    </div>
  );
}

export default memo(BoundaryNode);
