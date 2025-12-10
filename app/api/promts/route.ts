import { NextResponse } from "next/server";
import {
  getAllPrompts,
  getPromptById,
  createPrompt,
  updatePromptById,
  deletePromptById,
  getUserSelectedPrompt,
  setUserSelectedPrompt,
} from "@/lib/getPromt";

// GET: получение всех промптов
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId') ?? undefined;
    const prompts = await getAllPrompts(userId ?? undefined);
    const selectedPromptId = userId ? await getUserSelectedPrompt(userId) : null;
    return NextResponse.json({ prompts, selectedPromptId });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ message: "Internal Server Error" }, { status: 500 });
  }
}

// POST: создание нового промпта
export async function POST(req: Request) {
  try {
    const { title, content, userId } = await req.json();

    if (!userId) {
      return NextResponse.json({ message: "userId is required" }, { status: 400 });
    }
    
    if (!title || !title.trim()) {
      return NextResponse.json({ message: "Title is required" }, { status: 400 });
    }
    
    if (!content || !content.trim()) {
      return NextResponse.json({ message: "Content is required" }, { status: 400 });
    }

    const newPrompt = await createPrompt(title, content, userId);
    return NextResponse.json(newPrompt, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ message: "Internal Server Error" }, { status: 500 });
  }
}

// PUT: обновление промпта
export async function PUT(req: Request) {
  try {
    const { id, title, content, userId } = await req.json();
    
    if (!id) {
      return NextResponse.json({ message: "ID is required" }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json({ message: "userId is required" }, { status: 400 });
    }
    
    if (!title || !title.trim()) {
      return NextResponse.json({ message: "Title is required" }, { status: 400 });
    }
    
    if (!content || !content.trim()) {
      return NextResponse.json({ message: "Content is required" }, { status: 400 });
    }

    const updatedPrompt = await updatePromptById(id, title, content, userId);
    return NextResponse.json(updatedPrompt);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ message: "Internal Server Error" }, { status: 500 });
  }
}

// DELETE: удаление промпта
export async function DELETE(req: Request) {
  try {
    const { id, userId } = await req.json();
    
    if (!id) {
      return NextResponse.json({ message: "ID is required" }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json({ message: "userId is required" }, { status: 400 });
    }

    await deletePromptById(id, userId);
    return NextResponse.json({ message: "Prompt deleted" });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ 
      message: error.message || "Internal Server Error" 
    }, { status: 500 });
  }
}

// PATCH: сохранить выбранный промпт пользователя
export async function PATCH(req: Request) {
  try {
    const { userId, promptId } = await req.json();

    if (!userId) {
      return NextResponse.json({ message: 'userId is required' }, { status: 400 });
    }

    if (!promptId || !String(promptId).trim()) {
      return NextResponse.json({ message: 'promptId is required' }, { status: 400 });
    }

    await setUserSelectedPrompt(userId, promptId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({
      message: error.message || 'Internal Server Error',
    }, { status: 500 });
  }
}