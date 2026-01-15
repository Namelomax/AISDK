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
  // mxGraph labels accept HTML when html=1, but draw.io files are XML.
  // That means the label must be XML-escaped: `<br/>` must become `&lt;br/&gt;`.
  // We first inject `<br/>` (for draw.io's HTML labels), then escape as XML.
  return escapeXml(t.replace(/\r\n?|\n/g, '<br/>'));
}

export function buildDrawioXmlFromState(
  documentTitle: string,
  state: ProcessDiagramState | null | undefined,
  attachments: Attachment[]
): string {
  const s = state || null;
  if (!s) return '';

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