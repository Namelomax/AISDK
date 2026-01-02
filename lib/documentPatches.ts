export type DocumentPatch = {
  /** Heading text or full markdown heading line (e.g. "## Scope" or "Scope") */
  heading: string;
  /**
   * Patch mode:
   * - "replace": replace the section body with `content`
   * - "append": append `content` to the end of the section body
   * - "delete": remove the entire section (heading + body)
   */
  mode?: 'replace' | 'append' | 'delete';
  /** Content for replace/append (without the heading line) */
  content: string;
};

function normalizeNewlines(input: string): string {
  return (input ?? '').replace(/\r\n?/g, '\n');
}

function splitLinesWithOffsets(text: string): Array<{ line: string; start: number; end: number }> {
  const lines: Array<{ line: string; start: number; end: number }> = [];
  let start = 0;
  const normalized = normalizeNewlines(text);
  for (const line of normalized.split('\n')) {
    const end = start + line.length;
    lines.push({ line, start, end });
    start = end + 1; // +\n
  }
  return lines;
}

function isHeadingLine(line: string): { level: number; text: string } | null {
  const m = line.match(/^(#{1,6})\s+(.+?)\s*$/);
  if (!m) return null;
  return { level: m[1].length, text: m[2].trim() };
}

function stripHeadingSyntax(input: string): string {
  const trimmed = (input ?? '').trim();
  const m = trimmed.match(/^#{1,6}\s+(.+?)\s*$/);
  if (m) return m[1].trim();
  return trimmed;
}

function findSectionRange(markdown: string, headingQuery: string): {
  start: number;
  end: number;
  headingLine: string;
  level: number;
} | null {
  const normalized = normalizeNewlines(markdown);
  const lines = splitLinesWithOffsets(normalized);

  const queryRaw = (headingQuery ?? '').trim();
  const queryText = stripHeadingSyntax(queryRaw);
  const queryHasHashes = /^#{1,6}\s+/.test(queryRaw);

  // Find the heading line
  let headingIndex = -1;
  let headingLevel = 0;
  let headingLine = '';

  for (let i = 0; i < lines.length; i++) {
    const info = isHeadingLine(lines[i].line);
    if (!info) continue;

    if (queryHasHashes) {
      if (lines[i].line.trim() === queryRaw) {
        headingIndex = i;
        headingLevel = info.level;
        headingLine = lines[i].line;
        break;
      }
    } else {
      if (info.text === queryText) {
        headingIndex = i;
        headingLevel = info.level;
        headingLine = lines[i].line;
        break;
      }
    }
  }

  if (headingIndex === -1) return null;

  const sectionStart = lines[headingIndex].start;

  // Section ends at next heading of same or higher level
  let sectionEnd = normalized.length;
  for (let j = headingIndex + 1; j < lines.length; j++) {
    const info = isHeadingLine(lines[j].line);
    if (!info) continue;
    if (info.level <= headingLevel) {
      sectionEnd = lines[j].start;
      break;
    }
  }

  return { start: sectionStart, end: sectionEnd, headingLine, level: headingLevel };
}

function ensureTrailingNewline(block: string): string {
  const normalized = normalizeNewlines(block);
  return normalized.endsWith('\n') ? normalized : normalized + '\n';
}

/**
 * Applies "replace section body" patches by matching markdown headings.
 * If a heading is not found, the section is appended at the end as a new "##" section.
 */
export function applyDocumentPatches(markdown: string, patches: DocumentPatch[]): string {
  let updated = normalizeNewlines(markdown ?? '');

  for (const patch of patches ?? []) {
    const heading = (patch?.heading ?? '').trim();
    if (!heading) continue;

    const range = findSectionRange(updated, heading);

    const mode: 'replace' | 'append' | 'delete' =
      patch?.mode === 'append' ? 'append' : patch?.mode === 'delete' ? 'delete' : 'replace';
    const body = normalizeNewlines(patch?.content ?? '').trimEnd();

    if (!range) {
      if (mode === 'delete') continue;
      const headingText = stripHeadingSyntax(heading);
      const toAppend = `\n\n## ${headingText}\n${body}\n`;
      updated = (updated.trimEnd() + toAppend).replace(/\n{3,}/g, '\n\n');
      continue;
    }

    if (mode === 'delete') {
      updated = (updated.slice(0, range.start) + updated.slice(range.end)).replace(/\n{3,}/g, '\n\n');
      continue;
    }

    // Replace from end of heading line to section end
    const section = updated.slice(range.start, range.end);
    const sectionLines = splitLinesWithOffsets(section);
    const firstLineBreakIdx = section.indexOf('\n');
    const headingPart = firstLineBreakIdx === -1 ? section.trimEnd() : section.slice(0, firstLineBreakIdx).trimEnd();

    const existingBody = firstLineBreakIdx === -1 ? '' : section.slice(firstLineBreakIdx + 1).trimEnd();
    const nextBody = mode === 'append'
      ? [existingBody.trimEnd(), body].filter(Boolean).join('\n\n').trimEnd()
      : body;

    const newSection = ensureTrailingNewline(`${headingPart}\n${nextBody}`.trimEnd()) + '\n';

    updated = (updated.slice(0, range.start) + newSection + updated.slice(range.end)).replace(/\n{3,}/g, '\n\n');
  }

  return updated;
}

export function extractDocumentTitle(markdown: string): string {
  const normalized = normalizeNewlines(markdown ?? '');
  const firstLine = normalized.split('\n')[0] ?? '';
  const m = firstLine.match(/^#\s+(.+?)\s*$/);
  return (m?.[1] ?? '').trim();
}
