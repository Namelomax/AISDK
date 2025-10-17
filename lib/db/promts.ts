// src/lib/db/prompts.ts
import { getDB } from './client';

export type Prompt = {
  id?: string;
  userId?: string | null;
  title: string;
  content: string;
  editable: boolean; // false — если это дефолтный промт
  created_at?: string;
  updated_at?: string;
};

// Создание нового промта
export async function createPrompt(prompt: Prompt) {
  const db = await getDB();
  const [result] = await db.create('prompt', {
    ...prompt,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  return result;
}

// Получить все промты (дефолтные + пользовательские)
export async function getPrompts(userId?: string) {
  const db = await getDB();
  const query = userId
    ? `SELECT * FROM prompt WHERE editable = false OR userId = $userId`
    : `SELECT * FROM prompt WHERE editable = false`;
  const result = await db.query(query, { userId });
  return result[0]?.result || [];
}

// Получить промт по id
export async function getPromptById(id: string) {
  const db = await getDB();
  const [prompt] = await db.select(`prompt:${id}`);
  return prompt || null;
}

// Обновление промта (если editable)
export async function updatePrompt(id: string, updates: Partial<Prompt>) {
  const db = await getDB();

  const [prompt] = await db.select(`prompt:${id}`);
  if (!prompt) throw new Error('Prompt not found');
  if (!prompt.editable) throw new Error('This prompt is not editable');

  const [updated] = await db.update(`prompt:${id}`, {
    ...updates,
    updated_at: new Date().toISOString(),
  });
  return updated;
}

// Удаление пользовательского промта
export async function deletePrompt(id: string, userId: string) {
  const db = await getDB();
  const [prompt] = await db.select(`prompt:${id}`);
  if (!prompt) throw new Error('Prompt not found');
  if (prompt.userId !== userId) throw new Error('Forbidden');
  if (!prompt.editable) throw new Error('Default prompt cannot be deleted');

  await db.delete(`prompt:${id}`);
  return true;
}
