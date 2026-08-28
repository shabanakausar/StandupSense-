import { NextResponse } from "next/server";
import { runStandupChain } from "@/lib/chain";

/**
 * POST /api/generate-brief
 *
 * Accepts: { standupNotes: string }
 * Returns: BriefOutput as JSON
 *
 * App Router convention — no (req, res) style handlers here.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const standupNotes: string =
      typeof body?.standupNotes === "string" ? body.standupNotes : "";
    const brief = await runStandupChain(standupNotes);
    return NextResponse.json(brief);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
