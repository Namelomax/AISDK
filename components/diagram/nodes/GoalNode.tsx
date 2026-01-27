'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Target } from 'lucide-react';
import { useNodeDetails } from '../ProcessFlowDiagram';

export type GoalNodeData = {
  label?: string;
  description?: string;
};

function GoalNode({ data, selected, id }: NodeProps) {
  const { openNodeId, setOpenNodeId, focusOnNode, restoreView } = useNodeDetails();
  const showDetails = openNodeId === id;
  const nodeData = data as GoalNodeData;

  const handleClick = () => {
    if (showDetails) {
      restoreView();
      setOpenNodeId(null);
    } else {
      setOpenNodeId(id);
      focusOnNode(id);
    }
  };

  const handleClose = () => {
    restoreView();
    setOpenNodeId(null);
  };

  return (
    <div className="relative">
      <div
        onClick={handleClick}
        className={`flex flex-col items-center cursor-pointer p-2
          ${selected ? 'ring-2 ring-blue-500 ring-offset-2 rounded-lg' : ''}
          hover:opacity-80 transition-opacity`}
      >
        <span className="text-xs font-bold mb-1 text-foreground">Цель</span>
        <div className="w-16 h-16 flex items-center justify-center">
          <Target className="w-12 h-12 text-amber-500" />
        </div>
      </div>

      <Handle type="target" position={Position.Left} className="opacity-0" />

      {/* Details popup */}
      {showDetails && nodeData.description && (
        <div
          className="absolute top-24 left-1/2 -translate-x-1/2 z-50 w-72 p-4 rounded-lg shadow-xl
            bg-card border border-border"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-sm font-bold mb-2 text-foreground">Цель процесса</div>
          <div className="text-sm text-foreground">{nodeData.description}</div>
          <button
            onClick={handleClose}
            className="mt-2 w-full text-xs text-center py-1.5 rounded bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
          >
            Закрыть
          </button>
        </div>
      )}
    </div>
  );
}

export default memo(GoalNode);
