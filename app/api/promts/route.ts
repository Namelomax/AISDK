import { NextResponse } from "next/server";
import { getPrompt, updatePrompt } from "@/lib//getPromt";

export async function GET() {
  try {
    const prompt = await getPrompt();
    console.log(prompt)
    return NextResponse.json({ prompt });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ message: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { content } = body;

    if (!content || content.trim() === "") {
      return NextResponse.json({ message: "Content is required" }, { status: 400 });
    }

    const newPrompt = await updatePrompt(content);
    return NextResponse.json({ message: "Prompt saved", prompt: newPrompt });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ message: "Internal Server Error" }, { status: 500 });
  }
}
