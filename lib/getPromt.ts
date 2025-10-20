import Surreal from "surrealdb";

const db = new Surreal();

// Кеш дефолтного промта в памяти (для быстрого использования)
let cachedPrompt: string;

async function connectDB() {

  await db.connect(
    "wss://wild-mountain-06cupioiq9vpbadmqsbcb609a8.aws-euw1.surreal.cloud/rpc",
    {
      namespace: process.env.SURREAL_NAMESPACE,
      database: process.env.SURREAL_DATABASE,
      auth: {
        username: String(process.env.SURREAL_USER),
        password: String(process.env.SURREAL_PASSWORD),
      },
    }
  );
  
  try {
    await db.query(`DELETE FROM prompts;`);
    await db.query(`remove TABLE prompts;`);
await db.query(`
  DEFINE TABLE prompts SCHEMAFULL;
  DEFINE FIELD content ON prompts TYPE string;
  DEFINE FIELD created ON prompts TYPE datetime DEFAULT time::now() READONLY;
  DEFINE FIELD updated ON prompts TYPE datetime VALUE time::now();`
);

  } catch (error: any) {
    if (!error.message.includes("already exists")) {
      throw error;
    }
}
}
// ---------------- GET ----------------

// Получить текущий промт (дефолт или обновлённый)
export async function getPrompt(): Promise<string> {
  if (cachedPrompt) return cachedPrompt;
    console.log(cachedPrompt)
  await connectDB();
  const result = (await db.query(
    `SELECT * FROM prompts ORDER BY updated DESC LIMIT 1;`
  )) as any[];
  console.log(result)
  cachedPrompt = result?.[0]?.content ?? "Ты полезный AI-ассистент…";
  return cachedPrompt;
}

// Обновить промт (редактирование через фронт)
export async function updatePrompt(newPrompt: string) {
  await connectDB();
  const prompt = {
    content: newPrompt,
  };
  await db.create("prompts", prompt);

  cachedPrompt = newPrompt;
  return prompt;
}
