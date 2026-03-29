import { NextResponse } from "next/server";
import { isMarniKbDatabaseConfigured, answerKbQuestion } from "@/lib/marni-kb";

export async function POST(req: Request) {
  if (!isMarniKbDatabaseConfigured()) {
    return NextResponse.json({ error: "CRM database not configured." }, { status: 503 });
  }
  try {
    const body = await req.json();
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question) {
      return NextResponse.json({ error: "question is required" }, { status: 400 });
    }
    const result = await answerKbQuestion(question, "marni");
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
