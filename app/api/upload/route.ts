const GEMINI_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY!;
const GEMINI_UPLOAD_URL = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${GEMINI_API_KEY}`;

export const runtime = "nodejs";

export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get("file") as File;

  if (!file) {
    return new Response(JSON.stringify({ error: "Файл не найден" }), { status: 400 });
  }

  // Преобразуем файл в base64
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Отправляем в Gemini API
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
    }),
    { status: 200 }
  );
}
