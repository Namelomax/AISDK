import Surreal from "surrealdb";

const db = new Surreal();

// Кеш дефолтного промта в памяти (для быстрого использования)
let cachedPrompt: string;
let isLoaded = false;

async function connectDB() {

  await db.connect(
    "wss://wild-mountain-06cupioiq9vpbadmqsbcb609a8.aws-euw1.surreal.cloud/rpc",
    {
      namespace: process.env.SURREAL_NAMESPACE,
      database: process.env.SURREAL_DATABASE,
      auth: {
        username: String(process.env.SURREAL_USER),
        password: String(process.env.SURREAL_PASS),
      },
    }
  );
  
  try {
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

// Получить текущий промт
export async function getPrompt(): Promise<string> {
  if (cachedPrompt && isLoaded) return cachedPrompt;
  console.log("3")
  await connectDB();
  console.log("result2")
  const result = (await db.query(
    `SELECT * FROM prompts ORDER BY updated DESC LIMIT 1;`
  )) as [any[]];
  console.log(result, "result")
  const record = result?.[0]?.[0];
  cachedPrompt = record?.content ?? "Ты полезный AI-ассистент…";
  isLoaded = true;
  return cachedPrompt;
}


// Обновить промт
export async function updatePrompt(newPrompt: string) {
  await connectDB();

  // Проверяем, существует ли запись
  const check = await db.select("prompts");
  console.log(check)
  if (!check || check.length === 0) {
    console.log("⚙️ Создаю новую запись prompts");
    await db.create("prompts", { content: newPrompt });
  } else {
    console.log("♻️ Обновляю существующую запись prompts");
    await db.query(`
  UPDATE prompts MERGE {
    content: $content
  };
`, { content: newPrompt });

  }

  cachedPrompt = newPrompt;
  isLoaded = true;

  console.log("✅ Кэш обновлён:", cachedPrompt);
  return newPrompt;
}


