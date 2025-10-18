import { NextResponse } from "next/server";
import Surreal, { r } from "surrealdb";

const db = new Surreal();

async function connectDB() {
    await db.connect(
      "wss://wild-mountain-06cupioiq9vpbadmqsbcb609a8.aws-euw1.surreal.cloud/rpc",
      {
        namespace: process.env.SURREAL_NAMESPACE,
        database: process.env.SURREAL_DATABASE,
        auth: {
        username: String(process.env.SURREAL_USER),
        password: String(process.env.SURREAL_PASSWORD),
        }
      }
    );

  try {
    await db.query(`DELETE FROM prompts;`);
    await db.query(`remove TABLE prompts;`);
    await db.query(`DEFINE TABLE prompts SCHEMAFULL;
      DEFINE FIELD content ON prompts TYPE string;
      DEFINE FIELD updatedAt ON prompts TYPE datetime;`);
  } catch (error: any) {
    if (!error.message.includes("already exists")) {
      throw error;
    }
}
}

// ---------------- GET ----------------
export async function GET() {
  await connectDB();
  try {
    console.log(await db.query(`SELECT * from prompts;`))
    
    const newPrompt = {
      content: "Promt2",
      updatedAt: new Date(),
    };
  
    await db.create("prompts", newPrompt);
const result = await db.query(
      `SELECT * FROM prompts;`
    )as any[];
      console.log(result[0]?.[0].content)
      console.log(result)
    const prompt = result ?? "Дефолтный промт";
    return NextResponse.json({ message: prompt[0]?.[0].content});
    
  } catch (error) {
    console.error("Failed to save prompt:", error);
    return NextResponse.json(
      { message: "Internal Server Error" },
      { status: 500 }
    );
  }

  try {
    const result = await db.query(
      `SELECT * FROM prompts ORDER BY updatedAt DESC LIMIT 1;`
    );
      console.log(result)
    const prompt = result[0]?.content ?? "Дефолтный промт";
    return NextResponse.json({ content: prompt });
  } catch (error) {
    console.error("Failed to read prompts:", error);
    return NextResponse.json(
      { message: "Internal Server Error" },
      { status: 500 }
    );
  }
}

// ---------------- POST ----------------
export async function POST(req: Request) {
  await connectDB();

  const body = await req.json();
  const { content } = body;

  if (!content || content.trim() === "") {
    return NextResponse.json(
      { message: "Content is required" },
      { status: 400 }
    );
  }

  try {
    const newPrompt = {
      content,
      updatedAt: new Date().toISOString(),
    };

    await db.create("prompts", newPrompt);

    return NextResponse.json({ message: "Prompt saved", prompt: newPrompt });
  } catch (error) {
    console.error("Failed to save prompt:", error);
    return NextResponse.json(
      { message: "Internal Server Error" },
      { status: 500 }
    );
  }
}

