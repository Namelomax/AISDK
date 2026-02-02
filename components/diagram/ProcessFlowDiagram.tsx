'use client';

import { useCallback, useMemo, useState, createContext, useContext, useRef } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type NodeTypes,
  ConnectionMode,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import {
  HeaderNode,
  StepNode,
  GoalNode,
  ProductNode,
  OwnerNode,
  ConsumerNode,
  BoundaryNode,
  ParticipantsNode,
} from './nodes';

import type { ProcessDiagramState } from '@/lib/document/types';
import { Expand } from 'lucide-react';

// Context for managing which node's details are shown
type NodeDetailsContextType = {
  openNodeId: string | null;
  setOpenNodeId: (id: string | null) => void;
  focusOnNode: (id: string) => void;
  restoreView: () => void;
};

export const NodeDetailsContext = createContext<NodeDetailsContextType>({
  openNodeId: null,
  setOpenNodeId: () => {},
  focusOnNode: () => {},
  restoreView: () => {},
});

export const useNodeDetails = () => useContext(NodeDetailsContext);

const nodeTypes: NodeTypes = {
  header: HeaderNode,
  step: StepNode,
  goal: GoalNode,
  product: ProductNode,
  owner: OwnerNode,
  consumer: ConsumerNode,
  boundary: BoundaryNode,
  participants: ParticipantsNode,
};

export type Step = {
  id: string;
  label: string;
  description?: string;
  participants?: string;
  role?: string;
  product?: string;
};

type ProcessFlowDiagramProps = {
  state: ProcessDiagramState | null;
  steps?: Step[];
  className?: string;
};

function stateToNodesAndEdges(
  state: ProcessDiagramState | null,
  steps: Step[] = []
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  if (!state) {
    return { nodes, edges };
  }

  // Header: Organization
  nodes.push({
    id: 'org',
    type: 'header',
    position: { x: 200, y: 20 },
    data: { label: state.organization?.name || 'Организация', type: 'organization' },
    draggable: true,
  });

  // Header: Process
  nodes.push({
    id: 'process',
    type: 'header',
    position: { x: 200, y: 100 },
    data: { label: state.process?.name || 'Процесс', type: 'process' },
    draggable: true,
  });

  // Owner
  const hasOwnerData = state.owner?.fullName?.trim() || state.owner?.position?.trim();
  if (hasOwnerData) {
    nodes.push({
      id: 'owner',
      type: 'owner',
      position: { x: 20, y: 200 },
      data: { fullName: state.owner?.fullName, position: state.owner?.position },
      draggable: true,
    });
  }

  // Goal
  nodes.push({
    id: 'goal',
    type: 'goal',
    position: { x: 1200, y: 20 },
    data: { description: state.goal || '' },
    draggable: true,
  });

  // Participants
  const hasParticipants = state.participants && state.participants.length > 0;
  if (hasParticipants) {
    nodes.push({
      id: 'participants',
      type: 'participants',
      position: { x: -500, y: 150 },
      data: { participants: state.participants || [] },
      draggable: true,
    });
  }

  // Start boundary
  nodes.push({
    id: 'start',
    type: 'boundary',
    position: { x: -100, y: 296 },
    data: { label: state.boundaries?.start || '', type: 'start' },
    draggable: true,
  });

  // Steps
  const stepSpacing = 200; // Increased spacing for better readability
  const stepStartX = 80;
  const stepY = 330;

  steps.forEach((step, index) => {
    nodes.push({
      id: `step-${index}`,
      type: 'step',
      position: { x: stepStartX + index * stepSpacing, y: stepY },
      data: {
        label: step.label,
        description: step.description,
        participants: step.participants,
        role: step.role,
        product: step.product,
      },
      draggable: true,
    });

    // Edge from previous step or start
    edges.push({
      id: `e-${index === 0 ? 'start' : `step-${index - 1}`}-step-${index}`,
      source: index === 0 ? 'start' : `step-${index - 1}`,
      target: `step-${index}`,
      type: 'smoothstep',
      style: { strokeWidth: 3 },
      animated: false,
    });
  });

  // Calculate positions based on last step
  const lastStepX = stepStartX + (steps.length - 1) * stepSpacing;
  const endX = lastStepX + stepSpacing; // End right after last step
  const productX = endX + stepSpacing; // Product further right

  // End boundary - connected to last step
  nodes.push({
    id: 'end',
    type: 'boundary',
    position: { x: endX, y: stepY-18 },
    data: { label: state.boundaries?.end || '', type: 'end' },
    draggable: true,
  });

  // Edge from last step to end
  if (steps.length > 0) {
    edges.push({
      id: `e-step-${steps.length - 1}-end`,
      source: `step-${steps.length - 1}`,
      target: 'end',
      type: 'smoothstep',
      style: { strokeWidth: 3 },
    });
  }

  // Product - positioned to the right of end
  // Format consumers list as string
  const consumersForProduct = Array.isArray(state.consumers)
    ? state.consumers
        .map((c) => (typeof c === 'string' ? c : c.name || c.fullName || ''))
        .filter(Boolean)
        .join(', ')
    : '';

  nodes.push({
    id: 'product',
    type: 'product',
    position: { x: productX, y: stepY - 10 },
    data: {
      label: state.product || 'Продукт',
      description: state.productDescription || '',
      requirements: state.productRequirements || '',
      consumers: consumersForProduct,
      artifacts: state.productArtifacts || '',
    },
    draggable: true,
  });

  // Edge from end to product (dashed)
  edges.push({
    id: 'e-end-product',
    source: 'end',
    target: 'product',
    type: 'smoothstep',
    style: { strokeWidth: 2, strokeDasharray: '5,5' },
  });

  // Consumers
  const consumers = Array.isArray(state.consumers) ? state.consumers : [];
  const consumerStartX = productX + 180;
  consumers.slice(0, 9).forEach((consumer, index) => {
    const name = typeof consumer === 'string' ? consumer : consumer?.name || '';
    nodes.push({
      id: `consumer-${index}`,
      type: 'consumer',
      position: { x: consumerStartX, y: 250 + index * 130 },
      data: { name },
      draggable: true,
    });

    // Dashed edge from product to consumer
    edges.push({
      id: `e-product-consumer-${index}`,
      source: 'product',
      target: `consumer-${index}`,
      type: 'smoothstep',
      style: { strokeWidth: 1, strokeDasharray: '5,5' },
    });
  });

  return { nodes, edges };
}

// Inner component that uses ReactFlow hooks
function ProcessFlowDiagramInner({ state, steps = [] }: Omit<ProcessFlowDiagramProps, 'className'>) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => stateToNodesAndEdges(state, steps),
    [state, steps]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [openNodeId, setOpenNodeId] = useState<string | null>(null);
  const { setCenter, getNode, getViewport, setViewport } = useReactFlow();
  
  // Store viewport before opening popup
  const savedViewport = useRef<{ x: number; y: number; zoom: number } | null>(null);

  // Restore camera to saved viewport
  const restoreView = useCallback(() => {
    if (savedViewport.current) {
      setViewport(savedViewport.current, { duration: 300 });
      savedViewport.current = null;
    }
  }, [setViewport]);

  // Focus camera on popup (below the node)
  const focusOnNode = useCallback((nodeId: string) => {
    const node = getNode(nodeId);
    if (node) {
      // Save current viewport before focusing
      savedViewport.current = getViewport();
      
      setCenter(
        node.position.x + 40, // horizontal center of node
        node.position.y + 350, // offset down significantly to center on popup
        { zoom: 1.2, duration: 400 }
      );
    }
  }, [getNode, setCenter, getViewport]);

  // Reset view
  const onResetView = useCallback(() => {
    const { nodes: newNodes, edges: newEdges } = stateToNodesAndEdges(state, steps);
    setNodes(newNodes);
    setEdges(newEdges);
    setOpenNodeId(null);
  }, [state, steps, setNodes, setEdges]);

  // Update when state/steps change
  useMemo(() => {
    const { nodes: newNodes, edges: newEdges } = stateToNodesAndEdges(state, steps);
    setNodes(newNodes);
    setEdges(newEdges);
  }, [state, steps, setNodes, setEdges]);

  // Close popup when clicking on background
  const onPaneClick = useCallback(() => {
    if (openNodeId) {
      restoreView();
    }
    setOpenNodeId(null);
  }, [openNodeId, restoreView]);

  return (
    <NodeDetailsContext.Provider value={{ openNodeId, setOpenNodeId, focusOnNode, restoreView }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        connectionMode={ConnectionMode.Loose}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={2}
        className="bg-background"
        onPaneClick={onPaneClick}
      >
        <Background gap={20} size={1} className="!bg-muted/30" />
        <Controls 
          className="!bg-card !border !border-border !shadow-md [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-accent"
        />
        <MiniMap 
          nodeStrokeWidth={3}
          zoomable
          pannable
          className="!bg-card !border !border-border !shadow-md"
          nodeColor={(node) => {
            switch (node.type) {
              case 'step': return '#22c55e';
              case 'header': return '#3b82f6';
              case 'goal': return '#f59e0b';
              case 'product': return '#8b5cf6';
              case 'boundary': return '#6b7280';
              case 'owner': return '#06b6d4';
              case 'consumer': return '#ec4899';
              default: return '#9ca3af';
            }
          }}
          maskColor="rgba(0, 0, 0, 0.1)"
        />
        <Panel position="top-right" className="flex gap-2">
          <button
            onClick={onResetView}
            className="p-2 rounded-md bg-card border border-border hover:bg-accent transition-colors shadow-md"
            title="Сбросить вид"
          >
            <Expand className="w-4 h-4" />
          </button>
        </Panel>
      </ReactFlow>
    </NodeDetailsContext.Provider>
  );
}

export default function ProcessFlowDiagram({ state, steps = [], className = '' }: ProcessFlowDiagramProps) {
  return (
    <div className={`w-full h-full min-h-[800px] ${className}`}>
      <ReactFlowProvider>
        <ProcessFlowDiagramInner state={state} steps={steps} />
      </ReactFlowProvider>
    </div>
  );
}
