import Surreal from "surrealdb";

let db: Surreal | null = null;

export async function getDB(): Promise<Surreal> {
  if (db) {
    return db;
  }

  db = new Surreal();

  try {
    const url = process.env.SURREALDB_URL;
    const namespace = process.env.SURREALDB_NAMESPACE;
    const database = process.env.SURREALDB_DATABASE;
    const username = process.env.SURREALDB_USER;
    const password = process.env.SURREALDB_PASSWORD;

    if (!url || !namespace || !database || !username || !password) {
      throw new Error("Missing required SurrealDB environment variables");
    }

    // Connect to the database
    await db.connect(url, { reconnect: true });

    // Select a specific namespace / database
    await db.use({
      namespace,
      database,
    });

    // Signin as root user
    await db.signin({
      username,
      password,
    });

    console.log("Connected to SurrealDB");
    return db;
  } catch (error) {
    console.error("Failed to connect to SurrealDB:", error);
    db = null;
    throw error;
  }
}

export default getDB;