'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Box, FileText, CheckCircle, Users } from 'lucide-react';
import { useNodeDetails } from '../ProcessFlowDiagram';

export type ProductNodeData = {
  label?: string;
  description?: string;
  requirements?: string;
  consumers?: string;
  artifacts?: string;
};

function ProductNode({ data, selected, id }: NodeProps) {
  const { openNodeId, setOpenNodeId, focusOnNode, restoreView } = useNodeDetails();
  const showDetails = openNodeId === id;
  const nodeData = data as ProductNodeData;

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
        className={`flex flex-col items-center cursor-pointer
          ${selected ? 'ring-2 ring-blue-500 ring-offset-2 rounded-lg' : ''}
          hover:opacity-80 transition-opacity`}
      >
        {/* Isometric cube representation */}
        <div className="w-20 h-20 relative">
          <svg viewBox="0 0 100 100" className="w-full h-full">
            {/* Top face */}
            <polygon
              points="50,10 90,30 50,50 10,30"
              className="fill-red-200 stroke-red-400 dark:fill-red-900/50 dark:stroke-red-600"
              strokeWidth="2"
            />
            {/* Left face */}
            <polygon
              points="10,30 50,50 50,90 10,70"
              className="fill-red-300 stroke-red-400 dark:fill-red-800/50 dark:stroke-red-600"
              strokeWidth="2"
            />
            {/* Right face */}
            <polygon
              points="50,50 90,30 90,70 50,90"
              className="fill-red-100 stroke-red-400 dark:fill-red-700/50 dark:stroke-red-600"
              strokeWidth="2"
            />
          </svg>
        </div>
        <span className="text-xs font-semibold mt-1 text-foreground">
          {nodeData.label || 'Продукт'}
        </span>
      </div>

      <Handle type="target" position={Position.Left} className="w-2 h-2" />
      <Handle type="source" position={Position.Right} className="w-2 h-2" />

      {/* Details popup */}
      {showDetails && (
        <div
          className="absolute top-24 left-1/2 -translate-x-1/2 z-50 w-[400px] max-w-[90vw] p-4 rounded-lg shadow-xl
            bg-card border border-border"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-base font-bold mb-3 text-foreground border-b pb-2">
            Продукт процесса
          </div>

          {/* Описание продукта */}
          {nodeData.description && (
            <div className="mb-4">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
                <FileText className="w-3 h-3" />
                Описание продукта
              </div>
              <div className="text-sm text-foreground bg-red-50 dark:bg-red-900/20 p-2 rounded border border-red-200 dark:border-red-800">
                {nodeData.description}
              </div>
            </div>
          )}

          {/* Требования к продукту */}
          {nodeData.requirements && (
            <div className="mb-4">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
                <CheckCircle className="w-3 h-3" />
                Требования к продукту
              </div>
              <div className="text-sm text-foreground bg-amber-50 dark:bg-amber-900/20 p-2 rounded border border-amber-200 dark:border-amber-800">
                {nodeData.requirements}
              </div>
            </div>
          )}

          {/* Потребители продукта */}
          {nodeData.consumers && (
            <div className="mb-4">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
                <Users className="w-3 h-3" />
                Потребители продукта
              </div>
              <div className="text-sm text-foreground bg-muted/30 p-2 rounded">
                {nodeData.consumers}
              </div>
            </div>
          )}

          {/* Артефакты/Документы */}
          {nodeData.artifacts && (
            <div className="mb-3">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
                <Box className="w-3 h-3" />
                Документы/Артефакты
              </div>
              <div className="text-sm text-foreground bg-muted/30 p-2 rounded">
                {nodeData.artifacts}
              </div>
            </div>
          )}

          {!nodeData.description && !nodeData.requirements && !nodeData.consumers && !nodeData.artifacts && (
            <div className="text-sm text-muted-foreground">
              Нет информации о продукте. Укажите описание, требования и потребителей в диалоге.
            </div>
          )}

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

export default memo(ProductNode);
