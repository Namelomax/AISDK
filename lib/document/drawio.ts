import type { Attachment, ProcessDiagramState } from '@/lib/document/types';

function escapeXml(input: string) {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapForDrawioLabel(input: string) {
  const t = String(input || '').trim();
  if (!t) return '';
  return escapeXml(t.replace(/\r\n?|\n/g, '<br/>'));
}

const TEMPLATE_LAYOUT_ID = 'template-v1';
const FORCE_TEMPLATE_LAYOUT = true;

// ИСПРАВЛЕННЫЙ ШАБЛОН - все элементы в видимой области 0-1200 по X, 0-900 по Y
const TEMPLATE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net" version="29.3.1">
<diagram name="Страница-1" id="kjT4P9zYKhYp1suIgHot">
<mxGraphModel dx="1200" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1200" pageHeight="900" math="0" shadow="0">
<root>
<mxCell id="0"/>
<mxCell id="1" parent="0"/>

<!-- ОРГАНИЗАЦИЯ (верх) -->
<mxCell id="WUNQLDYkcmdtQOnQ86g9-10" parent="1" style="text;html=1;strokeColor=#666;fillColor=#f5f5f5;align=center;verticalAlign=middle;whiteSpace=wrap;rounded=1;" value="Организация" vertex="1">
<mxGeometry height="60" width="520" x="40" y="20" as="geometry"/>
</mxCell>

<!-- ПРОЦЕСС (под организацией) -->
<mxCell id="N9eBfpktY8xSMP5imMae-5" parent="1" style="text;html=1;strokeColor=#666;fillColor=#fff;align=center;verticalAlign=middle;whiteSpace=wrap;rounded=1;" value="Процесс" vertex="1">
<mxGeometry height="60" width="520" x="40" y="100" as="geometry"/>
</mxCell>

<!-- ВЛАДЕЛЕЦ (эллипс слева) -->
<mxCell id="WUNQLDYkcmdtQOnQ86g9-4" parent="1" style="ellipse;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" value="" vertex="1">
<mxGeometry height="70" width="90" x="-250" y="60" as="geometry"/>
</mxCell>
<mxCell id="N9eBfpktY8xSMP5imMae-7" parent="1" style="shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;outlineConnect=0;" value="" vertex="1">
<mxGeometry height="40" width="30" x="-220" y="75" as="geometry"/>
</mxCell>
<mxCell id="EDGE_OWNER_TO_POSITION" edge="1" parent="1" source="N9eBfpktY8xSMP5imMae-7" target="N9eBfpktY8xSMP5imMae-9" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=classic;">
<mxGeometry relative="1" as="geometry"/>
</mxCell>
<mxCell id="N9eBfpktY8xSMP5imMae-9" parent="1" style="text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;whiteSpace=wrap;" value="Должность" vertex="1">
<mxGeometry height="20" width="140" x="-150" y="40" as="geometry"/>
</mxCell>
<mxCell id="EDGE_OWNER_TO_NAME" edge="1" parent="1" source="N9eBfpktY8xSMP5imMae-7" target="N9eBfpktY8xSMP5imMae-13" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=classic;">
<mxGeometry relative="1" as="geometry"/>
</mxCell>
<mxCell id="N9eBfpktY8xSMP5imMae-13" parent="1" style="text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;fontSize=12;whiteSpace=wrap;" value="ФИО" vertex="1">
<mxGeometry height="20" width="140" x="-120" y="90" as="geometry"/>
</mxCell>

<!-- ЦЕЛЬ (справа от владельца) -->
<mxCell id="N9eBfpktY8xSMP5imMae-20" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffe6cc;strokeColor=#d79b00;align=center;spacing=8;fontSize=24;fontStyle=1;" value="Цель" vertex="1">
<mxGeometry height="60" width="90" x="620" y="80" as="geometry"/>
</mxCell>
<mxCell id="WUNQLDYkcmdtQOnQ86g9-12" parent="1" style="text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=top;whiteSpace=wrap;spacing=8;detailFrame=1;detailFor=N9eBfpktY8xSMP5imMae-20;" value="Описание цели" vertex="1">
<mxGeometry height="90" width="320" x="230" y="215" as="geometry"/>
</mxCell>

<!-- СТРЕЛКА ПРОЦЕССА (горизонтальная линия с шагами) -->
<mxCell id="N9eBfpktY8xSMP5imMae-26" parent="1" style="text;html=1;whiteSpace=wrap;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;" value="Начало" vertex="1">
<mxGeometry height="30" width="80" x="40" y="350" as="geometry"/>
</mxCell>

<!-- Линия процесса -->
<mxCell id="N9eBfpktY8xSMP5imMae-24" edge="1" parent="1" style="endArrow=classic;html=1;rounded=0;" value="">
<mxGeometry height="50" relative="1" width="50" as="geometry">
<mxPoint x="130" y="365" as="sourcePoint"/>
<mxPoint x="945" y="365" as="targetPoint"/>
</mxGeometry>
</mxCell>

<!-- Шаги (бусины на нитке) -->
<mxCell id="N9eBfpktY8xSMP5imMae-28" parent="1" style="ellipse;whiteSpace=wrap;html=1;aspect=fixed;fillColor=#d5e8d4;strokeColor=#82b366;" value="Шаг 1" vertex="1">
<mxGeometry height="70" width="70" x="200" y="330" as="geometry"/>
</mxCell>
<mxCell id="N9eBfpktY8xSMP5imMae-29" parent="1" style="ellipse;whiteSpace=wrap;html=1;aspect=fixed;fillColor=#d5e8d4;strokeColor=#82b366;" value="Шаг 2" vertex="1">
<mxGeometry height="70" width="70" x="380" y="330" as="geometry"/>
</mxCell>
<mxCell id="N9eBfpktY8xSMP5imMae-30" parent="1" style="ellipse;whiteSpace=wrap;html=1;aspect=fixed;fillColor=#d5e8d4;strokeColor=#82b366;" value="Шаг 3" vertex="1">
<mxGeometry height="70" width="70" x="560" y="330" as="geometry"/>
</mxCell>
<mxCell id="N9eBfpktY8xSMP5imMae-31" parent="1" style="ellipse;whiteSpace=wrap;html=1;aspect=fixed;fillColor=#d5e8d4;strokeColor=#82b366;" value="Шаг 4" vertex="1">
<mxGeometry height="70" width="70" x="740" y="330" as="geometry"/>
</mxCell>

<!-- ПРОДУКТ -->
<mxCell id="N9eBfpktY8xSMP5imMae-33" parent="1" style="html=1;whiteSpace=wrap;shape=isoCube2;backgroundOutline=1;isoAngle=15;fillColor=#f8cecc;strokeColor=#b85450;" value="Продукт" vertex="1">
<mxGeometry height="80" width="90" x="920" y="325" as="geometry"/>
</mxCell>

<mxCell id="N9eBfpktY8xSMP5imMae-27" parent="1" style="text;html=1;whiteSpace=wrap;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;" value="Конец" vertex="1">
<mxGeometry height="30" width="80" x="1030" y="350" as="geometry"/>
</mxCell>

<!-- ПОТРЕБИТЕЛИ (внизу, 3 группы) -->
<mxCell id="N9eBfpktY8xSMP5imMae-35" parent="1" style="text;html=1;whiteSpace=wrap;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;fontStyle=1;" value="Потребители" vertex="1">
<mxGeometry height="30" width="1000" x="1200" y="40" as="geometry"/>
</mxCell>

<!-- Потребитель 1 -->
<mxCell id="N9eBfpktY8xSMP5imMae-37" parent="1" style="ellipse;whiteSpace=wrap;html=1;fillColor=#e1d5e7;strokeColor=#9673a6;" value="" vertex="1">
<mxGeometry height="120" width="180" x="1150" y="120" as="geometry"/>
</mxCell>
<mxCell id="N9eBfpktY8xSMP5imMae-38" parent="1" style="shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;outlineConnect=0;" value="" vertex="1">
<mxGeometry height="50" width="30" x="1225" y="145" as="geometry"/>
</mxCell>
<mxCell id="N9eBfpktY8xSMP5imMae-39" parent="1" style="text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;whiteSpace=wrap;" value="Потребитель 1" vertex="1">
<mxGeometry height="20" width="160" x="1200" y="85" as="geometry"/>
</mxCell>

<!-- Потребитель 2 -->
<mxCell id="N9eBfpktY8xSMP5imMae-41" parent="1" style="ellipse;whiteSpace=wrap;html=1;fillColor=#e1d5e7;strokeColor=#9673a6;" value="" vertex="1">
<mxGeometry height="120" width="180" x="1150" y="280" as="geometry"/>
</mxCell>
<mxCell id="N9eBfpktY8xSMP5imMae-42" parent="1" style="shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;outlineConnect=0;" value="" vertex="1">
<mxGeometry height="50" width="30" x="1225" y="305" as="geometry"/>
</mxCell>
<mxCell id="N9eBfpktY8xSMP5imMae-43" parent="1" style="text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;whiteSpace=wrap;" value="Потребитель 2" vertex="1">
<mxGeometry height="20" width="160" x="1200" y="245" as="geometry"/>
</mxCell>

<!-- Потребитель 3 -->
<mxCell id="N9eBfpktY8xSMP5imMae-45" parent="1" style="ellipse;whiteSpace=wrap;html=1;fillColor=#e1d5e7;strokeColor=#9673a6;" value="" vertex="1">
<mxGeometry height="120" width="180" x="1150" y="440" as="geometry"/>
</mxCell>
<mxCell id="N9eBfpktY8xSMP5imMae-46" parent="1" style="shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;outlineConnect=0;" value="" vertex="1">
<mxGeometry height="50" width="30" x="1225" y="465" as="geometry"/>
</mxCell>
<mxCell id="N9eBfpktY8xSMP5imMae-47" parent="1" style="text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;whiteSpace=wrap;" value="Потребитель 3" vertex="1">
<mxGeometry height="20" width="160" x="1200" y="405" as="geometry"/>
</mxCell>

<!-- Стрелки от продукта к потребителям -->
<mxCell id="N9eBfpktY8xSMP5imMae-48" edge="1" parent="1" source="N9eBfpktY8xSMP5imMae-33" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;entryX=0.5;entryY=0;entryDx=0;entryDy=0;dashed=1;" target="N9eBfpktY8xSMP5imMae-37">
<mxGeometry relative="1" as="geometry"/>
</mxCell>
<mxCell id="N9eBfpktY8xSMP5imMae-51" edge="1" parent="1" source="N9eBfpktY8xSMP5imMae-33" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;entryX=0.5;entryY=0;entryDx=0;entryDy=0;dashed=1;" target="N9eBfpktY8xSMP5imMae-41">
<mxGeometry relative="1" as="geometry"/>
</mxCell>
<mxCell id="N9eBfpktY8xSMP5imMae-52" edge="1" parent="1" source="N9eBfpktY8xSMP5imMae-33" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;entryX=0.5;entryY=0;entryDx=0;entryDy=0;dashed=1;" target="N9eBfpktY8xSMP5imMae-45">
<mxGeometry relative="1" as="geometry"/>
</mxCell>

<!-- Требования к продукту -->
<mxCell id="N9eBfpktY8xSMP5imMae-53" parent="1" style="text;html=1;whiteSpace=wrap;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;fontStyle=2;detailFrame=1;detailFor=N9eBfpktY8xSMP5imMae-33;" value="Описание продукта" vertex="1">
<mxGeometry height="30" width="150" x="890" y="420" as="geometry"/>
</mxCell>

</root>
</mxGraphModel>
</diagram>
</mxfile>`;

function updateCellValue(doc: Document, id: string, value?: string | null) {
  if (!value) return;
  const cell = doc.querySelector(`mxCell[id="${id}"]`);
  if (!cell) return;
  cell.setAttribute('value', wrapForDrawioLabel(value));
}

function appendCellStyle(doc: Document, id: string, extra: string) {
  const cell = doc.querySelector(`mxCell[id="${id}"]`);
  if (!cell) return;
  const style = cell.getAttribute('style') || '';
  const next = style.endsWith(';') || !style ? `${style}${extra}` : `${style};${extra}`;
  cell.setAttribute('style', next);
}

function buildTemplateXmlFromState(state: ProcessDiagramState, attachments: Attachment[]) {
  const s = state;
  const orgName = String(s.organization?.name || '').trim();
  const orgActivity = String(s.organization?.activity || '').trim();
  const procName = String(s.process?.name || '').trim();
  const procDesc = String(s.process?.description || '').trim();
  const ownerName = String(s.owner?.fullName || '').trim();
  const ownerPos = String(s.owner?.position || '').trim();
  const goal = String(s.goal || '').trim();
  const product = String(s.product || '').trim();
  const start = String(s.boundaries?.start || '').trim();
  const end = String(s.boundaries?.end || '').trim();
  const consumers = Array.isArray(s.consumers) ? s.consumers : [];

  const nodes = Array.isArray(s.graph?.nodes) ? s.graph!.nodes! : [];
  const flowNodes = nodes.filter((n) => {
    const t = String(n?.type || '').toLowerCase();
    return t !== 'doc' && t !== 'document';
  });

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(TEMPLATE_XML, 'text/xml');
  } catch {
    return TEMPLATE_XML;
  }

  if (doc.getElementsByTagName('parsererror').length) return TEMPLATE_XML;

  // Заполняем организацию
  const orgText = [orgName, orgActivity].filter(Boolean).join('\n');
  updateCellValue(doc, 'WUNQLDYkcmdtQOnQ86g9-10', orgText || 'Организация');

  // Заполняем процесс
  const procText = [procName || 'Процесс', procDesc].filter(Boolean).join('\n');
  updateCellValue(doc, 'N9eBfpktY8xSMP5imMae-5', procText);

  // Заполняем цель
  updateCellValue(doc, 'WUNQLDYkcmdtQOnQ86g9-12', goal || 'Цель процесса');
  appendCellStyle(doc, 'WUNQLDYkcmdtQOnQ86g9-12', 'detailFrame=1;detailFor=N9eBfpktY8xSMP5imMae-20;opacity=0;pointerEvents=0;');
  
  // Заполняем владельца
  updateCellValue(doc, 'N9eBfpktY8xSMP5imMae-9', ownerPos || 'Должность');
  updateCellValue(doc, 'N9eBfpktY8xSMP5imMae-13', ownerName || 'ФИО');

  // Границы процесса
  if (start) updateCellValue(doc, 'N9eBfpktY8xSMP5imMae-26', start);
  if (end) updateCellValue(doc, 'N9eBfpktY8xSMP5imMae-27', end);

  // Продукт
  if (product) updateCellValue(doc, 'N9eBfpktY8xSMP5imMae-33', product);
  appendCellStyle(doc, 'N9eBfpktY8xSMP5imMae-53', 'detailFrame=1;detailFor=N9eBfpktY8xSMP5imMae-33;opacity=0;pointerEvents=0;');
  updateCellValue(doc, 'N9eBfpktY8xSMP5imMae-53', product ? `Описание продукта: ${product}` : 'Описание продукта');
  updateCellValue(doc, 'N9eBfpktY8xSMP5imMae-53', product ? `Описание продукта: ${product}` : 'Описание продукта');

  // Потребители
  const consumerSlots = [
    { ellipse: 'N9eBfpktY8xSMP5imMae-37', label: 'N9eBfpktY8xSMP5imMae-39' },
    { ellipse: 'N9eBfpktY8xSMP5imMae-41', label: 'N9eBfpktY8xSMP5imMae-43' },
    { ellipse: 'N9eBfpktY8xSMP5imMae-45', label: 'N9eBfpktY8xSMP5imMae-47' }
  ];
  
  for (let i = 0; i < Math.min(consumerSlots.length, consumers.length); i++) {
    const c: any = consumers[i];
    const label = typeof c === 'string' ? String(c).trim() : String(c?.fullName || c?.name || c?.position || '').trim();
    if (label) updateCellValue(doc, consumerSlots[i].label, label);
  }

  // Шаги процесса (бусины)
  const beadSlots = [
    'N9eBfpktY8xSMP5imMae-28',
    'N9eBfpktY8xSMP5imMae-29',
    'N9eBfpktY8xSMP5imMae-30',
    'N9eBfpktY8xSMP5imMae-31',
  ];

  for (let i = 0; i < Math.min(beadSlots.length, flowNodes.length); i++) {
    const node = flowNodes[i];
    const slotId = beadSlots[i];
    if (!node) continue;
    updateCellValue(doc, slotId, String(node.label || '').trim() || `Шаг ${i + 1}`);
  }

  const xml = new XMLSerializer().serializeToString(doc);
  return xml.startsWith('<?xml') ? xml : `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
}

export function buildDrawioXmlFromState(
  documentTitle: string,
  state: ProcessDiagramState | null | undefined,
  attachments: Attachment[]
): string {
  const s = state || null;
  if (!s) return '';

  if (FORCE_TEMPLATE_LAYOUT || s.graph?.layout === TEMPLATE_LAYOUT_ID) {
    return buildTemplateXmlFromState(s, attachments);
  }

  const orgName = String(s.organization?.name || '').trim();
  const orgActivity = String(s.organization?.activity || '').trim();
  const procName = String(s.process?.name || '').trim();
  const procDesc = String(s.process?.description || '').trim();
  const ownerName = String(s.owner?.fullName || '').trim();
  const ownerPos = String(s.owner?.position || '').trim();
  const goal = String(s.goal || '').trim();
  const product = String(s.product || '').trim();
  const start = String(s.boundaries?.start || '').trim();
  const end = String(s.boundaries?.end || '').trim();
  const consumers = Array.isArray(s.consumers) ? s.consumers : [];
  const docs = Array.isArray(attachments) ? attachments : [];

  const hasAny = Boolean(
    orgName ||
      orgActivity ||
      procName ||
      procDesc ||
      ownerName ||
      ownerPos ||
      goal ||
      product ||
      start ||
      end ||
      consumers.length ||
      (Array.isArray(s.graph?.nodes) && s.graph.nodes.length)
  );
  if (!hasAny) return '';

  const processTitle = procName || 'Процесс';

  // Layout resembles a "project/process scheme":
  // - Context (org / owner / goal) grouped, not necessarily connected.
  // - Process flow (start -> process -> product -> end).
  // - Consumers grouped separately.
  const canvasW = 1200;
  const canvasH = 800;

  const node = (
    id: string,
    value: string,
    style: string,
    x: number,
    y: number,
    w: number,
    h: number,
    parentId: string = '1'
  ) => {
    const v = wrapForDrawioLabel(value);
    return `    <mxCell id="${escapeXml(id)}" value="${v}" style="${escapeXml(style)}" vertex="1" parent="${escapeXml(parentId)}">\n      <mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/>\n    </mxCell>`;
  };

  const edge = (id: string, source: string, target: string, style: string) => {
    return `    <mxCell id="${escapeXml(id)}" style="${escapeXml(style)}" edge="1" parent="1" source="${escapeXml(source)}" target="${escapeXml(target)}">\n      <mxGeometry relative="1" as="geometry"/>\n    </mxCell>`;
  };

  const styles = {
    group: 'group=1;rounded=0;whiteSpace=wrap;html=1;fillColor=none;align=left;verticalAlign=top;spacing=10;',
    process: 'rounded=0;whiteSpace=wrap;html=1;align=center;verticalAlign=middle;spacing=8;',
    terminator: 'shape=terminator;whiteSpace=wrap;html=1;align=center;verticalAlign=middle;spacing=8;',
    ellipse: 'ellipse;whiteSpace=wrap;html=1;align=center;verticalAlign=middle;spacing=8;',
    note: 'rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacing=8;',
    // Text blocks without outlines.
    textOnlyLeft: 'text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;whiteSpace=wrap;',
    // Small clickable tag-like blocks.
    tag: 'rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacing=8;',
    // Owner label: icon + text, no oval.
    ownerLabel: 'text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;whiteSpace=wrap;spacingLeft=28;ownerIcon=1;',
    edge: 'endArrow=block;endFill=1;html=1;rounded=0;',
  };

  const cells: string[] = [];
  const edges: string[] = [];

  // If AI provided a graph, render it directly (agent-driven scheme)
  if (Array.isArray(s.graph?.nodes) && s.graph!.nodes!.length > 0) {
    const MAX_NODES = 10;
    const nodes = s.graph!.nodes!.slice(0, MAX_NODES);
    const edgesList = Array.isArray(s.graph?.edges) ? s.graph!.edges! : [];

    const hasDocNodes = nodes.some((n) => {
      const t = String(n?.type || '').toLowerCase();
      return t === 'doc' || t === 'document';
    });
    const hasDocsGroup = docs.length > 0 || hasDocNodes;

    let flow = { id: 'GROUP_FLOW', x: 40, y: 20, w: hasDocsGroup ? 820 : canvasW - 80, h: 700 };
    let documentsG = { id: 'GROUP_DOCS', x: 0, y: 20, w: 300, h: 700 };
    if (hasDocsGroup) {
      documentsG = { ...documentsG, x: flow.x + flow.w + 20, w: Math.max(240, canvasW - (flow.x + flow.w + 40)) };
    }

    const groupTitle = processTitle || 'Процесс';

    const estimateHeight = (label: string, width: number, base = 46) => {
      const plain = String(label || '').replace(/\s+/g, ' ').trim();
      const charsPerLine = Math.max(12, Math.floor(width / 9));
      const lines = Math.max(1, Math.ceil(plain.length / charsPerLine));
      return base + (lines - 1) * 16;
    };

    // Build context tags inside the flow group (org/owner/goal/product/boundaries/consumers).
    const contextItems: Array<{ id: string; label: string }> = [];
    if (orgName || orgActivity) {
      const label = ['Орг.', orgName || orgActivity].filter(Boolean).join(': ');
      if (label) contextItems.push({ id: 'ORG', label });
    }
    if (ownerName || ownerPos) {
      const label = ['Владелец', [ownerName, ownerPos].filter(Boolean).join(' - ')].filter(Boolean).join(': ');
      if (label) contextItems.push({ id: 'OWNER', label });
    }
    if (goal) contextItems.push({ id: 'GOAL', label: `Цель: ${goal}` });
    if (product) contextItems.push({ id: 'PRODUCT', label: `Продукт: ${product}` });
    if (start) contextItems.push({ id: 'START', label: `Старт: ${start}` });
    if (end) contextItems.push({ id: 'END', label: `Финиш: ${end}` });
    if (consumers.length) {
      const max = Math.min(3, consumers.length);
      for (let i = 0; i < max; i++) {
        const c: any = consumers[i];
        const label =
          typeof c === 'string'
            ? String(c).trim()
            : String(c?.fullName || c?.name || c?.position || '').trim();
        if (label) contextItems.push({ id: `CONS${i + 1}`, label: `Потребитель: ${label}` });
      }
    }

    const flowInnerW = Math.max(240, flow.w - 80);
    const baseNodeW = Math.min(420, flowInnerW);
    const detailWDefault = Math.min(260, Math.max(180, flowInnerW - baseNodeW - 24));

    const tagW = Math.min(300, Math.max(220, Math.floor((flowInnerW - 20) / 2)));
    const tagGapX = 16;
    const tagGapY = 10;
    const tagCols = contextItems.length > 1 ? 2 : 1;
    const tagRows = Math.ceil(contextItems.length / tagCols) || 0;
    const tagBaseY = 40;
    const tagRowHeights: number[] = [];

    for (let r = 0; r < tagRows; r++) {
      let maxH = 0;
      for (let c = 0; c < tagCols; c++) {
        const idx = r * tagCols + c;
        const item = contextItems[idx];
        if (!item) continue;
        const h = estimateHeight(item.label, tagW, 36);
        maxH = Math.max(maxH, h);
      }
      tagRowHeights.push(maxH || 0);
    }

    let contextHeight = 0;
    if (contextItems.length) {
      contextHeight = tagRowHeights.reduce((sum, h) => sum + h, 0) + Math.max(0, tagRows - 1) * tagGapY + 20;
      cells.push(node('GROUP_CONTEXT', 'Контекст', styles.group, 20, 20, flow.w - 40, contextHeight + 20, flow.id));
      let yCursor = tagBaseY;
      for (let r = 0; r < tagRows; r++) {
        const rowH = tagRowHeights[r];
        for (let c = 0; c < tagCols; c++) {
          const idx = r * tagCols + c;
          const item = contextItems[idx];
          if (!item) continue;
          const x = 40 + c * (tagW + tagGapX);
          cells.push(node(item.id, item.label, styles.tag, x, yCursor, tagW, rowH, flow.id));
        }
        yCursor += rowH + tagGapY;
      }
    }

    // Basic layout: flow nodes go down the flow column; doc nodes go into docs column.
    let flowCursor = contextHeight ? contextHeight + 40 : 0;
    let docIndex = 0;
    const nodeIdMap = new Map<string, string>();

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const rawId = String(n?.id || `N${i + 1}`);
      const id = rawId.replace(/[^A-Za-z0-9_\-]/g, '') || `N${i + 1}`;
      nodeIdMap.set(rawId, id);

      const label = String(n?.label || '').trim() || id;
      const type = String(n?.type || '').toLowerCase();
      const details = String((n as any)?.details || '').trim();
      const isDoc = type === 'doc' || type === 'document';

      if (isDoc && hasDocsGroup) {
        const w = documentsG.w - 40;
        const h = estimateHeight(label, w, 40);
        const x = 20;
        const y = 40 + docIndex * (h + 18);
        docIndex += 1;
        cells.push(node(id, label, styles.note, x, y, w, h, documentsG.id));
        continue;
      }

      let nodeW = baseNodeW;
      let detailW = 0;
      let detailBelow = false;

      if (details) {
        if (flowInnerW - baseNodeW - 24 >= 160) {
          detailW = detailWDefault;
          nodeW = Math.min(baseNodeW, flowInnerW - detailW - 24);
        } else {
          nodeW = Math.min(flowInnerW, Math.max(240, baseNodeW));
          detailW = flowInnerW;
          detailBelow = true;
        }
      }

      const h = estimateHeight(label, nodeW, 56);
      const detailH = details ? estimateHeight(details, detailW || nodeW, 38) : 0;
      const rowHeight = details ? (detailBelow ? h + detailH + 16 : Math.max(h, detailH)) : h;
      const x = 40;
      const y = 40 + flowCursor;
      flowCursor += rowHeight + 24;

      const style =
        type === 'start' || type === 'end'
          ? styles.terminator
          : type === 'actor'
            ? styles.ellipse
            : styles.process;

      cells.push(node(id, label, style, x, y, nodeW, h, flow.id));

      if (details) {
        const detailId = `${id}_DETAIL`;
        const dx = detailBelow ? x : x + nodeW + 24;
        const dy = detailBelow ? y + h + 12 : y;
        const dw = detailBelow ? detailW : detailW;
        const dh = detailH;
        const detailStyle = `${styles.note}detailFrame=1;detailFor=${id};`;
        cells.push(node(detailId, details, detailStyle, dx, dy, dw, dh, flow.id));
      }
    }

    const flowHeight = Math.max(220, 40 + flowCursor + 40);
    const docsHeight = Math.max(220, 40 + docIndex * 70 + 50);
    const maxHeight = Math.max(flowHeight, hasDocsGroup ? docsHeight : 0, 700);

    flow = { ...flow, h: maxHeight };
    if (hasDocsGroup) documentsG = { ...documentsG, h: maxHeight };

    // Rebuild group cells with updated heights (insert at the top of the list).
    const groupCells = [node(flow.id, groupTitle, styles.group, flow.x, flow.y, flow.w, flow.h)];
    if (hasDocsGroup) {
      groupCells.push(node(documentsG.id, 'Документы', styles.group, documentsG.x, documentsG.y, documentsG.w, documentsG.h));
    }

    // Remove any previously added group cells and prepend the resized ones.
    const nonGroupCells = cells.filter((c) => !c.includes('id="GROUP_FLOW"') && !c.includes('id="GROUP_DOCS"'));
    cells.length = 0;
    cells.push(...groupCells, ...nonGroupCells);

    for (let i = 0; i < edgesList.length; i++) {
      const e = edgesList[i];
      const src = nodeIdMap.get(String(e.from)) || String(e.from);
      const trg = nodeIdMap.get(String(e.to)) || String(e.to);
      if (!src || !trg) continue;
      if (!nodeIdMap.has(String(e.from)) || !nodeIdMap.has(String(e.to))) continue;
      edges.push(edge(`E_${i + 1}`, src, trg, styles.edge));
    }

    const mxGraphModelXml = [
      `<mxGraphModel dx="${canvasW}" dy="${canvasH}" grid="1" gridSize="10" guides="1" tooltips="1" connect="0" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827" math="0" shadow="0">`,
      '  <root>',
      '    <mxCell id="0"/>',
      '    <mxCell id="1" parent="0"/>',
      ...cells,
      ...edges,
      '  </root>',
      '</mxGraphModel>',
    ].join('\n');

    const now = new Date().toISOString();
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<mxfile host="app.diagrams.net" modified="${now}" agent="AISDK" version="22.1.0" type="device">`,
      '  <diagram id="diagram-1" name="Page-1">',
      mxGraphModelXml.replace(/^/gm, '    '),
      '  </diagram>',
      '</mxfile>',
    ].join('\n');
  }

  // Group containers (outline only)
  // Note: groups are vertices too; local renderer draws them as transparent outlines.
  const context = { id: 'GROUP_CONTEXT', x: 40, y: 20, w: 760, h: 140 };
  const flow = { id: 'GROUP_FLOW', x: 40, y: 180, w: 760, h: 560 };
  const documentsG = { id: 'GROUP_DOCS', x: 820, y: 20, w: 340, h: 140 };
  const consumersG = { id: 'GROUP_CONSUMERS', x: 820, y: 180, w: 340, h: 560 };

  cells.push(node(context.id, 'Контекст', styles.group, context.x, context.y, context.w, context.h));
  cells.push(node(flow.id, processTitle || 'Процесс', styles.group, flow.x, flow.y, flow.w, flow.h));
  if (docs.length) {
    cells.push(node(documentsG.id, 'Документы', styles.group, documentsG.x, documentsG.y, documentsG.w, documentsG.h));
  }
  cells.push(node(consumersG.id, 'Потребители', styles.group, consumersG.x, consumersG.y, consumersG.w, consumersG.h));

  // Organization (collapsed: name only; activity in details drawer)
  if (orgName || orgActivity) {
    const label = orgName ? `Организация: ${orgName}` : 'Организация';
    cells.push(node('ORG', label, styles.textOnlyLeft, 15, 42, 700, 40, context.id));
  }

  // Goal (collapsed: label only; full goal in details drawer)
  if (goal) {
    cells.push(node('GOAL', `Цель: ${goal}`, styles.tag, 15, 84, 260, 50, context.id));
  }

  // Owner appears only when the role/position is known.
  // If we only have a name without a role, do not render it (avoids the "fio without role" issue).
  if (ownerPos) {
    const ownerLabel = [ownerName, ownerPos].filter(Boolean).join(' - ');
    // Place within context group.
    cells.push(node('OWNER', ownerLabel || ownerPos, styles.ownerLabel, 320, 84, 420, 50, context.id));
  }

  // Flow nodes
  const flowX = 250;
  const flowW = 450;
  const startY = 70;
  const gapY = 130;
  const startX = 20;
  const startW = 200;

  if (start) {
    cells.push(node('START', 'Начало', styles.terminator, startX, startY, startW, 70, flow.id));
  }

  // Process (collapsed: title only; description in details drawer)
  cells.push(node('PROC', `Процесс: ${processTitle}`, styles.process, flowX, startY, flowW, 110, flow.id));

  if (product) {
    cells.push(node('PRODUCT', `Продукт: ${product}`, styles.process, flowX, startY + gapY, flowW, 100, flow.id));
  }

  if (end) {
    cells.push(node('END', 'Конец', styles.terminator, flowX, startY + gapY * 2, flowW, 70, flow.id));
  }

  // Documents list (top-right frame)
  if (docs.length) {
    const maxDocs = Math.min(6, docs.length);
    for (let i = 0; i < maxDocs; i++) {
      const d = docs[i];
      const name = String(d?.name || d?.filename || '').trim() || `Документ ${i + 1}`;
      const id = `DOC${i + 1}`;
      const x = 14;
      const y = 36 + i * 18;
      cells.push(node(id, `• ${name}`, styles.textOnlyLeft, x, y, documentsG.w - 28, 18, documentsG.id));
    }
  }

  // Minimal arrows, like a flow.
  if (start) edges.push(edge('E_START_PROC', 'START', 'PROC', styles.edge));
  if (product) edges.push(edge('E_PROC_PRODUCT', 'PROC', 'PRODUCT', styles.edge));
  if (product && end) edges.push(edge('E_PRODUCT_END', 'PRODUCT', 'END', styles.edge));

  // Consumers (collapsed labels; details in drawer)
  if (consumers.length) {
    const max = Math.min(10, consumers.length);
    for (let i = 0; i < max; i++) {
      const c: any = consumers[i];
      const kind = typeof c === 'string' ? '' : String(c?.kind || '').trim();
      const label = typeof c === 'string' ? String(c).trim() : String(c?.fullName || c?.name || '').trim();
      const extra = typeof c === 'string' ? '' : String(c?.position || '').trim();
      const shown = [label || (kind === 'org' ? 'Организация' : kind === 'group' ? 'Группа' : 'Персона'), extra]
        .filter(Boolean)
        .join('\n');
      const id = `CONS${i + 1}`;
      const x = 30;
      const y = 60 + i * 90;
      cells.push(node(id, shown, styles.ellipse, x, y, 280, 70, consumersG.id));
      if (product) edges.push(edge(`E_PRODUCT_${id}`, 'PRODUCT', id, styles.edge));
    }
  }

  const mxGraphModelXml = [
    `<mxGraphModel dx="${canvasW}" dy="${canvasH}" grid="1" gridSize="10" guides="1" tooltips="1" connect="0" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827" math="0" shadow="0">`,
    '  <root>',
    '    <mxCell id="0"/>',
    '    <mxCell id="1" parent="0"/>',
    ...cells,
    ...edges,
    '  </root>',
    '</mxGraphModel>',
  ].join('\n');

  const now = new Date().toISOString();
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<mxfile host="app.diagrams.net" modified="${escapeXml(now)}" agent="AISDK" version="22.1.0" type="device">`,
    '  <diagram id="diagram-1" name="Page-1">',
    `    ${mxGraphModelXml.replace(/\n/g, '\n    ')}`,
    '  </diagram>',
    '</mxfile>',
  ].join('\n');
}