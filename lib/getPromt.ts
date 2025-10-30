import Surreal from "surrealdb";

const db = new Surreal();

export type Prompt = {
  id: string;
  title: string;
  content: string;
  isDefault: boolean;
  created: string;
  updated: string;
};

// Вспомогательная функция для конвертации RecordId в строку
function convertToPrompt(record: any): Prompt {
  return {
    id: record.id.toString(),
    title: record.title,
    content: record.content,
    isDefault: record.isDefault,
    created: record.created,
    updated: record.updated,
  };
}

let isConnected = false;

async function connectDB() {
  if (isConnected) return; // уже подключено

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

  isConnected = true;
  console.log("✅ Connected to SurrealDB");

  try {
    await db.query(`
      DEFINE TABLE prompts SCHEMAFULL;
      DEFINE FIELD title ON prompts TYPE string;
      DEFINE FIELD content ON prompts TYPE string;
      DEFINE FIELD isDefault ON prompts TYPE bool DEFAULT false;
      DEFINE FIELD created ON prompts TYPE datetime DEFAULT time::now() READONLY;
      DEFINE FIELD updated ON prompts TYPE datetime VALUE time::now();
    `);
  } catch (error: any) {
    if (!error.message.includes("already exists")) {
      console.error("Error defining schema:", error);
    }
  }
}


// Получить все промпты
export async function getAllPrompts(): Promise<Prompt[]> {
  await connectDB();
  const result = (await db.query(`SELECT * FROM prompts ORDER BY updated DESC;`)) as [any[]];
  const records = result?.[0] ?? [];
  return records.map(convertToPrompt);
}

// Получить один промпт по ID
export async function getPromptById(id: string): Promise<Prompt | null> {
  await connectDB();
  const prompt = await db.select(id);
  if (!prompt) return null;
  return convertToPrompt(prompt);
}

// Создать новый промпт
export async function createPrompt(title: string, content: string): Promise<Prompt> {
  await connectDB();
  const [prompt] = await db.create("prompts", { 
    title, 
    content,
    isDefault: false 
  });
  return convertToPrompt(prompt);
}

// Обновить промпт
export async function updatePromptById(id: string, title: string, content: string): Promise<Prompt> {
  await connectDB();
  const prompt = await db.select(id);

  // проверка
  if (!prompt || !prompt[0]) {
    throw new Error("Prompt not found");
  }

  const promptData = convertToPrompt(Array.isArray(prompt) ? prompt[0] : prompt);

  if (promptData.isDefault) {
    throw new Error("Cannot edit default prompt");
  }

  const [updated] = await db.merge(id, { title, content });
  return convertToPrompt(updated);
}


// Удалить промпт
export async function deletePromptById(id: string): Promise<void> {
  await connectDB();
  const prompt = await db.select(id);
  if (!prompt) {
    throw new Error("Prompt not found");
  }
  
  const promptData = convertToPrompt(prompt);
  if (promptData.isDefault) {
    throw new Error("Cannot delete default prompt");
  }
  
  await db.delete(id);
}

// Получить дефолтный промпт (для совместимости)
export async function getPrompt(): Promise<string> {
  await connectDB();
  const result = (await db.query(
    `SELECT * FROM prompts WHERE isDefault = true LIMIT 1;`
  )) as [any[]];
  
  const records = result?.[0] ?? [];
  const record = records[0];
  
  // Если нет дефолтного - создаём
if (!record) {
    const [newPrompt] = await db.create("prompts", {
      title: "Default Assistant",
      content: "Ты полезный AI-ассистент. Используй инструменты для поиска информации и создания документов по запросу пользователя.",
      isDefault: true
    });
    return convertToPrompt(newPrompt).content;
  }
  
  return record.content;
}

// Обновить дефолтный промпт
export async function updatePrompt(content: string): Promise<void> {
  await connectDB();
  const result = (await db.query(
    `SELECT * FROM prompts WHERE isDefault = true LIMIT 1;`
  )) as [any[]];
  
  const records = result?.[0] ?? [];
  const record = records[0];
  
  if (record) {
    await db.merge(record.id.toString(), { content });
  } else {
    await db.create("prompts", {
      title: "Default Assistant",
      content,
      isDefault: true
    });
  }
}