export async function uploadGeminiFile(file: File) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY; // или через твой прокси
  const uploadUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`;

  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(uploadUrl, { method: "POST", body: formData });
  if (!res.ok) throw new Error("Ошибка загрузки файла");
  const data = await res.json();
  return data.file?.name;
}
