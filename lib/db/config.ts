export const surrealConfig = {
  url: process.env.NEXT_PUBLIC_SURREAL_URL || 'wss://your-instance.surrealdb.cloud',
  namespace: 'demo',
  database: 'surreal_deal_store',
  username: 'admin',
  password: process.env.SURREAL_PASSWORD || '90522468q_Q',
};

// Типы для работы с промптами
export interface Prompt {
  id?: string;
  name: string;
  content: string;
  isDefault: boolean;
  userId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface User {
  id?: string;
  email: string;
  name?: string;
  createdAt: Date;
}