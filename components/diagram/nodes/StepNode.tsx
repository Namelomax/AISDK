'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { User, FileText, Package } from 'lucide-react';
import { useNodeDetails } from '../ProcessFlowDiagram';

export type Participant = {
  name: string;
  role?: string;
  action?: string;
};

export type StepNodeData = {
  label: string;
  description?: string;
  participants?: string | Participant[];
  role?: string;
  product?: string;
};

function parseParticipants(participants?: string | Participant[]): Participant[] {
  if (!participants) return [];
  if (Array.isArray(participants)) return participants;
  
  // Parse string format: "Иванов (проверяет документы), Петров (согласует)"
  return participants.split(/[,;]/).map(p => {
    const match = p.trim().match(/^(.+?)\s*\((.+?)\)\s*$/);
    if (match) {
      return { name: match[1].trim(), action: match[2].trim() };
    }
    return { name: p.trim() };
  }).filter(p => p.name);
}

function StepNode({ data, selected, id }: NodeProps) {
  const { openNodeId, setOpenNodeId, focusOnNode, restoreView } = useNodeDetails();
  const showDetails = openNodeId === id;
  const nodeData = data as StepNodeData;
  const participants = parseParticipants(nodeData.participants);
  
  // Проверяем, есть ли у кого-то из участников индивидуальное действие
  const hasIndividualActions = participants.some(p => p.action);
  // Если нет индивидуальных действий, используем описание шага как общее действие
  const stepAction = !hasIndividualActions && nodeData.description 
    ? nodeData.description 
    : null;

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
      {/* Main step circle */}
      <div
        onClick={handleClick}
        className={`w-16 h-16 rounded-full flex items-center justify-center cursor-pointer
          bg-green-100 border-2 border-green-500 dark:bg-green-900/30 dark:border-green-600
          ${selected ? 'ring-2 ring-blue-500 ring-offset-2' : ''}
          hover:shadow-lg transition-shadow`}
      >
        <span className="text-xs font-bold text-center px-1 text-green-800 dark:text-green-200">
          {nodeData.label || 'Шаг'}
        </span>
      </div>

      {/* Handles */}
      <Handle type="target" position={Position.Left} className="w-2 h-2" />
      <Handle type="source" position={Position.Right} className="w-2 h-2" />

      {/* Details popup on click */}
      {showDetails && (
        <div
          className="absolute top-20 left-1/2 -translate-x-1/2 z-50 w-[400px] max-w-[90vw] p-4 rounded-lg shadow-xl
            bg-card border border-border"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-base font-bold mb-3 text-foreground border-b pb-2">
            {nodeData.label}
          </div>
          
          {/* Описание шага */}
          {nodeData.description && (
            <div className="mb-4">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
                <FileText className="w-3 h-3" />
                Описание шага
              </div>
              <div className="text-sm text-foreground bg-muted/30 p-2 rounded">
                {nodeData.description}
              </div>
            </div>
          )}

          {/* Участники с их действиями */}
          {participants.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
                <User className="w-3 h-3" />
                Участники и их действия
              </div>
              
              {/* Если нет индивидуальных действий, показываем общее действие для всех */}
              {stepAction && (
                <div className="text-xs text-muted-foreground mb-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded border-l-2 border-blue-400">
                  <span className="font-medium">Общее действие:</span> {stepAction}
                </div>
              )}
              
              <div className="space-y-2">
                {participants.map((p, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-sm bg-muted/20 p-2 rounded">
                    <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                      <User className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-foreground">{p.name}</div>
                      {p.action && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          → {p.action}
                        </div>
                      )}
                      {p.role && !p.action && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {p.role}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {nodeData.role && (
                <div className="text-xs text-muted-foreground mt-2 italic">
                  Общая роль: {nodeData.role}
                </div>
              )}
            </div>
          )}

          {/* Продукт шага */}
          {nodeData.product && (
            <div className="mb-3">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
                <Package className="w-3 h-3" />
                Продукт шага
              </div>
              <div className="text-sm text-foreground bg-green-50 dark:bg-green-900/20 p-2 rounded border border-green-200 dark:border-green-800">
                {nodeData.product}
              </div>
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

export default memo(StepNode);
