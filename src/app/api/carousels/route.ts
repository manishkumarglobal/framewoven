import { NextResponse } from "next/server";
import { listCarousels, createCarousel } from "@/lib/carousels";
import type { AspectRatio } from "@/types/carousel";
import { dataErrorResponse } from "@/lib/api-errors";
import { isAspectRatio } from "@/lib/api-input";
import { getBrandById } from "@/lib/brand";

export async function GET(request: Request) {
  try {
    // `?brandId=` lists one brand's carousels; without it, all of them.
    const brandId = new URL(request.url).searchParams.get("brandId") ?? undefined;
    const carousels = await listCarousels(brandId);
    return NextResponse.json({ carousels });
  } catch (err) {
    const dataError = dataErrorResponse(err);
    if (dataError) return dataError;
    throw err;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, aspectRatio, brandId } = body as {
      name?: string;
      aspectRatio?: AspectRatio;
      brandId?: unknown;
    };

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      );
    }

    // Same validator the update route uses, so the two cannot drift apart.
    const ratio: AspectRatio = isAspectRatio(aspectRatio) ? aspectRatio : "4:5";

    // A named brand must exist: falling back to another brand would generate
    // this carousel with the wrong identity for its whole life.
    if (
      brandId !== undefined &&
      (typeof brandId !== "string" || !(await getBrandById(brandId)))
    ) {
      return NextResponse.json({ error: "Unknown brand" }, { status: 400 });
    }

    const carousel = await createCarousel(name.trim(), ratio, brandId);
    return NextResponse.json(carousel, { status: 201 });
  } catch (err) {
    const dataError = dataErrorResponse(err);
    if (dataError) return dataError;
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
