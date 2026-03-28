import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { chat } from "@/lib/gemini";

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.email || "default-user";

  try {
    const { message } = await request.json();
    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    const reply = await chat(userId, message);
    return NextResponse.json({ reply });
  } catch (error: unknown) {
    console.error("Chat error:", error);
    const msg = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
