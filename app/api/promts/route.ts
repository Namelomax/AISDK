import { NextResponse } from "next/server";
import { getPrompt, updatePrompt } from "@/lib/getPromt";

// GET: получение промпта
export async function GET() {
  try {
    const prompt = await getPrompt();
    return NextResponse.json({ prompt });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ message: "Internal Server Error" }, { status: 500 });
  }
}

// POST: обновление промпта
export async function POST(req: Request) {
  try {
    const { content } = await req.json();
    if (!content || !content.trim()) {
      return NextResponse.json({ message: "Content is required" }, { status: 400 });
    }

    const newPrompt = await updatePrompt(content);
    return NextResponse.json({ message: "Prompt updated", prompt: newPrompt });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ message: "Internal Server Error" }, { status: 500 });
  }
}
