import Surreal from "surrealdb";
import { RecordId } from "surrealdb";

const db = new Surreal();

export type Prompt = {
  id: string;
  title: string;
  content: string;
  isDefault: boolean;
  created: string;
  updated: string;
};

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
// Функция для подключения к бд
async function connectDB() {
  if (isConnected) return;

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

// Вспомогательная функция — всегда возвращает корректный формат id
function normalizeId(id: string): string {
  return id.startsWith("prompts:") ? id : `prompts:${id}`;
}

// Получить все промпты
export async function getAllPrompts(): Promise<Prompt[]> {
  await connectDB();
  const result = (await db.query(`SELECT * FROM prompts ORDER BY updated DESC;`)) as [any[]];
  return (result?.[0] ?? []).map(convertToPrompt);
}

// Получить промпт по id
export async function getPromptById(id: string): Promise<Prompt | null> {
  await connectDB();
  const recordId = normalizeId(id);
  const prompt = await db.select(recordId);
  if (!prompt) return null;
  return convertToPrompt(Array.isArray(prompt) ? prompt[0] : prompt);
}

// Создать промпт
export async function createPrompt(title: string, content: string): Promise<Prompt> {
  await connectDB();
  const [prompt] = await db.create("prompts", { title, content, isDefault: false });
  return convertToPrompt(prompt);
}

// Обновить промпт
export async function updatePromptById(id: string, title: string, content: string): Promise<Prompt> {
  await connectDB();

  const cleanId = id.replace(/^prompts:/, "");
  const recordId = new RecordId("prompts", cleanId);

  console.log("🧠 recordId:", recordId.toString());

  const prompt = await db.select(recordId);
  console.log("📦 prompt:", prompt);

  const promptData = Array.isArray(prompt) ? prompt[0] : prompt;

  if (!promptData) {
    throw new Error("Prompt not found");
  }

  if (promptData.isDefault) {
    throw new Error("Cannot edit default prompt");
  }

  const result = await db.query(
    `UPDATE ${recordId} SET title = $title, content = $content, updated = time::now() RETURN AFTER;`,
    { title, content }
  );

  const updatedRecords = (result as any)[0]?.result ?? [];
  if (!updatedRecords.length) {
    throw new Error("Failed to update prompt");
  }

  return convertToPrompt(updatedRecords[0]);
}


// Удалить промпт
export async function deletePromptById(id: string): Promise<void> {
  await connectDB();

  const cleanId = id.replace(/^prompts:/, "");
  const recordId = new RecordId("prompts", cleanId);

  console.log("🗑 recordId:", recordId.toString());

  const prompt = await db.select(recordId);
  const promptData = Array.isArray(prompt) ? prompt[0] : prompt;

  if (!promptData) {
    throw new Error("Prompt not found");
  }

  if (promptData.isDefault) {
    throw new Error("Cannot delete default prompt");
  }

  await db.delete(recordId);
  console.log("✅ Prompt deleted:", recordId.toString());
}


// Получить дефолтный промпт
export async function getPrompt(): Promise<string> {
  await connectDB();
  const result = (await db.query(`SELECT * FROM prompts WHERE isDefault = true LIMIT 1;`)) as [any[]];
  const records = result?.[0] ?? [];
  const record = records[0];

  if (!record) {
    const [newPrompt] = await db.create("prompts", {
      title: "Default Assistant",
      content: "Ты полезный AI-ассистент. Используй инструменты для поиска информации и создания документов по запросу пользователя.",
      isDefault: true,
    });
    return convertToPrompt(newPrompt).content;
  }

  return record.content;
}

// Обновить дефолтный промпт
export async function updatePrompt(content: string): Promise<void> {
  await connectDB();
  const result = (await db.query(`SELECT * FROM prompts WHERE isDefault = true LIMIT 1;`)) as [any[]];
  const records = result?.[0] ?? [];
  const record = records[0];

  if (record) {
    await db.merge(record.id.toString(), { content });
  } else {
    await db.create("prompts", {
      title: "Default Assistant",
      content,
      isDefault: true,
    });
  }
}
