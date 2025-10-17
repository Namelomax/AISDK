// src/lib/db/client.ts
import Surreal from 'surrealdb';

let db: Surreal | null = null;

export async function getDB() {
  if (db) return db;

  db = new Surreal();

  try {
    await db.connect(
      "wss://wild-mountain-06cupioiq9vpbadmqsbcb609a8.aws-euw1.surreal.cloud/rpc",
      {
        namespace: "demo",
        database: "surreal_deal_store",
      }
    );

    await db.signin({
      username: "admin",
      password: "90522468q_Q",
    });

    console.log("✅ Connected to SurrealDB Cloud");
  } catch (err) {
    console.error("❌ SurrealDB connection error:", err);
    throw err;
  }

  return db;
}
