const GEMINI_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY!;
const GEMINI_UPLOAD_URL = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${GEMINI_API_KEY}`;

export const runtime = "nodejs";

function bestEffortBinaryText(buf: Buffer): string | null {
  if (!buf || buf.length < 8) return null;

  const candidates: string[] = [];
  try {
    candidates.push(buf.toString('utf8'));
  } catch {}
  try {
    candidates.push(buf.toString('utf16le'));
  } catch {}
  try {
    candidates.push(buf.toString('latin1'));
  } catch {}

  const clean = (raw: string) =>
    String(raw ?? '')
      .replace(/[\x00-\x09\x0B\x0C\x0E-\x1F]+/g, ' ')
      .replace(/\u0000+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

  const extractReadableRuns = (text: string) => {
    const runs = text.match(/[A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9\s.,:;!?()\[\]"'«»\-–—\/\\]{40,}/g);
    if (!runs?.length) return '';
    return runs.map((r) => clean(r)).filter(Boolean).join('\n');
  };

  let best = '';
  for (const c of candidates) {
    const runs = extractReadableRuns(c);
    if (runs.length > best.length) best = runs;
  }

  const cleaned = clean(best);
  return cleaned.length >= 40 ? cleaned : null;
}

async function extractLegacyDoc(buf: Buffer): Promise<string | null> {
  try {
    const WordExtractor = (await import('word-extractor')).default;
    const extractor = new WordExtractor();
    const doc = await extractor.extract(buf);
    const text = doc.getBody()?.trim();
    return text || null;
  } catch (error) {
    console.error('word-extractor parse failed:', error);
    return null;
  }
}

export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get("file") as File;

  if (!file) {
    return new Response(JSON.stringify({ error: "Файл не найден" }), { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Пытаемся извлечь текст локально: поддержка txt/md/json и docx через mammoth
  const contentType = (file.type || '').toLowerCase();
  let extractedText: string | null = null;

  try {
    if (contentType.includes('text/') || file.name.endsWith('.md') || file.name.endsWith('.txt')) {
      extractedText = buffer.toString('utf8');
    } else if (file.name.endsWith('.json')) {
      extractedText = buffer.toString('utf8');
    } else if (file.name.endsWith('.docx')) {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      extractedText = result.value;
    } else if (file.name.endsWith('.xls') || file.name.endsWith('.xlsx') || contentType === 'application/vnd.ms-excel' || contentType.includes('spreadsheetml')) {
      try {
        const XLSX = await import('xlsx');
        // xlsx library supports both .xlsx and legacy .xls formats
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        let text = '';
        workbook.SheetNames.forEach((sheetName: string) => {
          const sheet = (workbook as any).Sheets[sheetName];
          text += `Sheet: ${sheetName}\n`;
          text += (XLSX as any).utils.sheet_to_txt(sheet);
          text += '\n\n';
        });
        extractedText = text.trim() || null;
      } catch (err) {
        console.error('Failed to parse Excel file:', err);
        extractedText = bestEffortBinaryText(buffer);
      }
    } else if (file.name.endsWith('.doc') || contentType === 'application/msword') {
      extractedText = await extractLegacyDoc(buffer);
      if (!extractedText) extractedText = bestEffortBinaryText(buffer);
    } else if (file.name.endsWith('.ppt') || file.name.endsWith('.pptx') || contentType === 'application/vnd.ms-powerpoint' || contentType.includes('presentationml')) {
      // For PPTX we could use JSZip similar to chat/route.ts, for now fallback to binary
      extractedText = bestEffortBinaryText(buffer);
    }
  } catch (err) {
    console.error('Local text extraction failed:', err);
  }

  // Фолбек: загружаем в Gemini и отдаем fileId, если текст извлечь не удалось
  if (!extractedText) {
    const res = await fetch(GEMINI_UPLOAD_URL, {
      method: "POST",
      headers: {
        "Content-Type": file.type,
        "x-goog-upload-file-name": encodeURIComponent(file.name),
        "x-goog-upload-content-type": file.type,
      },
      body: buffer,
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("Ошибка загрузки в Gemini:", data);
      return new Response(JSON.stringify(data), { status: res.status });
    }

    return new Response(
      JSON.stringify({
        fileId: data.name,
        fileName: file.name,
        content: null,
      }),
      { status: 200 }
    );
  }

  return new Response(
    JSON.stringify({
      fileId: null,
      fileName: file.name,
      content: extractedText,
    }),
    { status: 200 }
  );
}
