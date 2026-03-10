import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateObject } from 'ai';
import { z } from 'zod';
import type { ProcessDiagramState } from '@/lib/document/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseURL: 'https://openrouter.ai/api/v1',
  compatibility: 'strict',
  headers: {
    ...(process.env.OPENROUTER_REFERER ? { 'HTTP-Referer': process.env.OPENROUTER_REFERER } : {}),
    'X-Title': 'AISDK',
  },
});

const model = openrouter.chat('tngtech/deepseek-r1t2-chimera:free');

// Import schemas from main diagram route
const ParticipantActionSchema = z.object({
  name: z.string().optional(),
  role: z.string().optional(),
  action: z.string().optional(),
});

const StepNodeSchema = z.object({
  id: z.string().optional(), // Allow partial updates
  label: z.string().optional(),
  description: z.string().optional(),
  participants: z.union([
    z.array(ParticipantActionSchema),
    z.string()
  ]).optional(),
  product: z.string().optional(),
  context: z.string().optional(),
  details: z.string().optional(), // Legacy field
  role: z.string().optional(), // Legacy field
  type: z.string().optional(), // Node type
}).passthrough();

const ProcessDiagramPatchSchema = z.object({
  organization: z.object({
    name: z.string().optional(),
    activity: z.string().optional(),
  }).optional(),
  
  owner: z.object({
    fullName: z.string().optional(),
    position: z.string().optional(),
  }).optional(),
  
  process: z.object({
    name: z.string().optional(),
    description: z.string().optional(),
  }).optional(),
  
  goal: z.string().optional(),
  product: z.string().optional(),
  consumers: z.union([z.string(), z.array(z.string())]).optional(),
  
  participants: z.array(z.object({
    role: z.string().optional(),
    name: z.string().optional(), // Made optional for partial updates
    fullName: z.string().optional(),
  })).optional(),
  
  boundaries: z.object({
    start: z.string().optional(),
    end: z.string().optional(),
  }).optional(),
  
  graph: z.object({
    layout: z.literal('template-v1').optional().default('template-v1'),
    nodes: z.array(StepNodeSchema),
    edges: z.array(z.object({
      from: z.string(),
      to: z.string(),
    })).optional().default([]),
  }).optional(),
});

function toText(msg: any): string {
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.parts)) {
    const p = msg.parts.find((x: any) => x?.type === 'text' && typeof x.text === 'string');
    if (p?.text) return String(p.text);
  }
  return '';
}

function clip(s: string, max = 2400) {
  const t = String(s || '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function mergeState(prev: ProcessDiagramState | null, patch: Partial<ProcessDiagramState>): ProcessDiagramState {
  const base: ProcessDiagramState = prev ? { ...prev } : {};
  const next: ProcessDiagramState = { ...base };

  // Merge simple fields
  if (patch.goal !== undefined) next.goal = patch.goal as any;
  if (patch.product !== undefined) next.product = patch.product as any;
  if (patch.organization) next.organization = { ...base.organization, ...patch.organization };
  if (patch.owner) next.owner = { ...base.owner, ...patch.owner };
  if (patch.process) next.process = { ...base.process, ...patch.process };
  if (patch.boundaries) next.boundaries = { ...base.boundaries, ...patch.boundaries };
  if (patch.consumers) next.consumers = patch.consumers as any;
  if (patch.participants) next.participants = patch.participants as any;

  // Merge graph nodes with deep merge
  if (patch.graph?.nodes) {
    const nodeMap = new Map();
    const existingNodes = base.graph?.nodes || [];
    const patchNodes = patch.graph.nodes || [];
    
    // First, add all existing nodes
    for (const node of existingNodes) {
      if (node?.id) nodeMap.set(node.id, { ...node });
    }
    
    // Then, merge patch nodes (deep merge if ID exists, add if new)
    for (const patchNode of patchNodes) {
      if (patchNode?.id) {
        const existing = nodeMap.get(patchNode.id);
        if (existing) {
          // Deep merge: update only provided fields
          const merged: any = {
            ...existing,
            ...patchNode,
          };
          // Special handling for participants - replace if provided
          if ((patchNode as any).participants !== undefined) {
            merged.participants = (patchNode as any).participants;
          }
          nodeMap.set(patchNode.id, merged);
        } else {
          // New node
          nodeMap.set(patchNode.id, patchNode);
        }
      }
    }
    
    next.graph = {
      ...base.graph,
      layout: patch.graph.layout ?? base.graph?.layout ?? 'template-v1',
      nodes: Array.from(nodeMap.values()),
      edges: [...(base.graph?.edges || []), ...(patch.graph.edges || [])],
    };
  }

  return next;
}

export async function POST(request: Request) {
  const body = await request.json();
  const { state, messages = [], documentContent } = body;

  if (!state) {
    return new Response(JSON.stringify({ success: false, error: 'No state provided' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  console.log('🔍 Validating diagram consistency...', {
    hasDocument: !!documentContent,
    documentLength: documentContent ? documentContent.length : 0,
    currentNodesCount: state.graph?.nodes?.length || 0,
    currentNodeIds: state.graph?.nodes?.map((n: any) => n.id).join(', ') || 'none'
  });
  
  const dialogue = messages
    .map((m: any) => `${m.role}: ${toText(m).slice(0, 500)}`)
    .join('\n\n');
  
  const documentPreview = documentContent ? clip(documentContent, 2000) : '';
  
  try {
    const { object: corrections } = await generateObject({
      model,
      schema: ProcessDiagramPatchSchema,
      temperature: 0.1,
      prompt: `CRITICAL: Return ONLY raw JSON. NO markdown blocks, NO backticks, NO code fences.

You are validating and enriching a business process diagram from document content and dialogue.

CURRENT DIAGRAM STATE:
${JSON.stringify(state, null, 2)}

${documentContent ? `
📄 DOCUMENT CONTENT (PRIMARY SOURCE):
${documentPreview}

The document above is the COMPLETE and AUTHORITATIVE source. Extract ALL information from it.
` : `
💬 DIALOGUE CONTEXT:
${dialogue}
`}

VALIDATION AND ENRICHMENT TASK:
${documentContent ? `
EXTRACT FROM DOCUMENT:
1. For EACH step mentioned in document:
   - Extract exact step name/label from document
   - Extract full description from document
   - Extract ALL participants mentioned (with their roles and names if available)
   - Extract product/result of the step
   - Extract tools/instruments if mentioned
   
2. Extract organization name and process details from document headers

3. Extract goals/objectives from document's "Цель процесса" section

4. Extract participants list from document's "Участники процесса" section

5. Compare with current diagram state - if document has MORE information than diagram, add it

CRITICAL: Document is the SOURCE OF TRUTH. If document says "Директор (Ищенко Р.В.)", add it to diagram.
If document lists 5 participants but diagram has 1, fix it by adding all 5.
If document has step details that diagram lacks, add them.
` : `
VALIDATE FROM DIALOGUE:
1. Check if step LABELS match exact wording from dialogue
2. Check if step DESCRIPTIONS match dialogue details
3. Check if GOAL matches dialogue
4. Check if PARTICIPANTS are complete from dialogue
`}

OUTPUT RULES:
- Return ALL nodes that need updates (with full participant lists if document has them)
- For participants: extract EVERY person mentioned with their role and name
- Step labels MUST match document/dialogue exactly
- Descriptions should be comprehensive, not generic
- If updating a node, include its ID and ALL fields that need correction
- If document has information diagram lacks, return it as corrections
- Return ONLY JSON object, NO markdown formatting

Examples:
- Document says "Директор (Ищенко Р.В.)" but diagram has empty name → return node with participant {role: "директор", name: "Ищенко Р.В."}
- Document lists 5 participants but diagram has 1 → return node with ALL 5 participants
- Document has detailed description but diagram has generic one → return node with full description

Return corrections as pure JSON (start with { and end with }):`,
    });

    // If AI returned corrections, merge them
    if (corrections && Object.keys(corrections).length > 0) {
      const correctionsSummary = {
        hasGoal: !!corrections.goal,
        hasOrganization: !!corrections.organization,
        hasParticipants: !!corrections.participants,
        correctedNodesCount: corrections.graph?.nodes?.length || 0,
        correctedNodeIds: corrections.graph?.nodes?.map((n: any) => n.id).join(', ') || 'none',
      };
      console.log('✅ Applying diagram corrections:', correctionsSummary);
      console.log('📝 Corrections detail:', JSON.stringify(corrections, null, 2));
      
      const correctedState = mergeState(state, corrections as Partial<ProcessDiagramState>);
      
      const resultSummary = {
        finalNodesCount: correctedState.graph?.nodes?.length || 0,
        finalNodeIds: correctedState.graph?.nodes?.map((n: any) => n.id).join(', ') || 'none',
      };
      console.log('✅ Diagram corrected successfully:', resultSummary);
      
      return new Response(JSON.stringify({ 
        success: true, 
        state: correctedState,
        corrected: true,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    console.log('✅ Diagram validation passed - no corrections needed');
    return new Response(JSON.stringify({ 
      success: true, 
      state,
      corrected: false,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    
  } catch (e) {
    console.error('⚠️ Diagram validation failed:', e);
    return new Response(JSON.stringify({ 
      success: true, 
      state,
      error: String(e),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
