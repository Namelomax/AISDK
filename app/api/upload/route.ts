const GEMINI_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY!;
const GEMINI_UPLOAD_URL = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${GEMINI_API_KEY}`;

export const runtime = "nodejs";

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
