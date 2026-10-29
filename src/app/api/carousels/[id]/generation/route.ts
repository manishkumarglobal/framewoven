import { NextResponse } from "next/server";
import {
  acceptInterruptedSlides,
  getInterruption,
  isGenerating,
} from "@/lib/generation-status";
import { dataErrorResponse } from "@/lib/api-errors";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

type Params = { params: Promise<{ id: string }> };

/**
 * `{ generating, interrupted }`: whether a design-agent run is still writing
 * this carousel's slides, and, if not, whether the last one was stopped,
 * failed or timed out after changing them. The editor polls it so every open
 * tab knows when export is safe.
 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  try {
    return NextResponse.json(
      { generating: isGenerating(id), interrupted: await getInterruption(id) },
      { headers: NO_STORE }
    );
  } catch (err) {
    const dataError = dataErrorResponse(err);
    if (dataError) return dataError;
    throw err;
  }
}

/**
 * The user confirms an interrupted carousel's slides as they are, which makes
 * it exportable again. Refused while a run is still live.
 */
export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  try {
    if (!(await acceptInterruptedSlides(id))) {
      return NextResponse.json(
        { error: "Slides are still being generated." },
        { status: 409, headers: NO_STORE }
      );
    }
    return NextResponse.json(
      { generating: false, interrupted: null },
      { headers: NO_STORE }
    );
  } catch (err) {
    const dataError = dataErrorResponse(err);
    if (dataError) return dataError;
    throw err;
  }
}
