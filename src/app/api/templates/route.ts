import { NextResponse } from "next/server";
import { listTemplates, saveAsTemplate } from "@/lib/templates";
import { getCarousel } from "@/lib/carousels";
import { dataErrorResponse } from "@/lib/api-errors";

export async function GET(request: Request) {
  try {
    // `?brandId=` lists one brand's templates; without it, all of them.
    const brandId = new URL(request.url).searchParams.get("brandId") ?? undefined;
    const templates = await listTemplates(brandId);
    return NextResponse.json({ templates });
  } catch (err) {
    const dataError = dataErrorResponse(err);
    if (dataError) return dataError;
    throw err;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { carouselId, name, description } = body as {
      carouselId?: string;
      name?: string;
      description?: string;
    };

    if (!carouselId) {
      return NextResponse.json(
        { error: "carouselId is required" },
        { status: 400 }
      );
    }

    const carousel = await getCarousel(carouselId);
    if (!carousel) {
      return NextResponse.json(
        { error: "Carousel not found" },
        { status: 404 }
      );
    }

    const template = await saveAsTemplate(carousel, name, description);
    return NextResponse.json(template, { status: 201 });
  } catch (err) {
    const dataError = dataErrorResponse(err);
    if (dataError) return dataError;
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
