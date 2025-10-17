import { NextResponse } from "next/server";
import Surreal from 'surrealdb';
const db = new Surreal();

export async function GET() {
    await db.connect("wss://wild-mountain-06cupioiq9vpbadmqsbcb609a8.aws-euw1.surreal.cloud/rpc", {
	namespace: process.env.SURREAL_NAMESPACE,
	database: process.env.SURREAL_DATABASE,
    });
  try {
    const prompts = {test: "test"}
    return NextResponse.json(prompts);
  } catch (error) {
    console.error("Failed to read prompts:", error);
    return NextResponse.json(
      { message: "Internal Server Error" },
      { status: 500 },
    );
  }
}
