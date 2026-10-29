import { NextResponse } from "next/server";
import { isGenerating } from "@/lib/generation-status";

export const dynamic = "force-dynamic";

/**
 * Whether a design-agent run is still writing this carousel's slides. The
 * editor asks after a reload and after its own chat stream closes, so export
 * stays unavailable until the run has really ended.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return NextResponse.json(
    { generating: isGenerating(id) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
