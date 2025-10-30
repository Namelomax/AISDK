import { NextResponse } from "next/server";
import { getAllPrompts, getPromptById, createPrompt, updatePromptById, deletePromptById } from "@/lib/getPromt";

// GET: получение всех промптов
export async function GET() {
  try {
    const prompts = await getAllPrompts();
    return NextResponse.json(prompts);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ message: "Internal Server Error" }, { status: 500 });
  }
}

// POST: создание нового промпта
export async function POST(req: Request) {
  try {
    const { title, content } = await req.json();
    
    if (!title || !title.trim()) {
      return NextResponse.json({ message: "Title is required" }, { status: 400 });
    }
    
    if (!content || !content.trim()) {
      return NextResponse.json({ message: "Content is required" }, { status: 400 });
    }

    const newPrompt = await createPrompt(title, content);
    return NextResponse.json(newPrompt, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ message: "Internal Server Error" }, { status: 500 });
  }
}

// PUT: обновление промпта
export async function PUT(req: Request) {
  try {
    const { id, title, content } = await req.json();
    
    if (!id) {
      return NextResponse.json({ message: "ID is required" }, { status: 400 });
    }
    
    if (!title || !title.trim()) {
      return NextResponse.json({ message: "Title is required" }, { status: 400 });
    }
    
    if (!content || !content.trim()) {
      return NextResponse.json({ message: "Content is required" }, { status: 400 });
    }

    const updatedPrompt = await updatePromptById(id, title, content);
    return NextResponse.json(updatedPrompt);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ message: "Internal Server Error" }, { status: 500 });
  }
}

// DELETE: удаление промпта
export async function DELETE(req: Request) {
  try {
    const { id } = await req.json();
    
    if (!id) {
      return NextResponse.json({ message: "ID is required" }, { status: 400 });
    }

    await deletePromptById(id);
    return NextResponse.json({ message: "Prompt deleted" });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ 
      message: error.message || "Internal Server Error" 
    }, { status: 500 });
  }
}