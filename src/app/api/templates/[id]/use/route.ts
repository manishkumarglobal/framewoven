import { NextResponse } from "next/server";
import { getTemplate } from "@/lib/templates";
import { createCarousel, addSlide } from "@/lib/carousels";
import { brandIdOf, getDefaultBrandId } from "@/lib/brand";
import { dataErrorResponse } from "@/lib/api-errors";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const template = await getTemplate(id);
    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    // The new carousel belongs to the template's brand: the template's slides
    // are that brand's design.
    const carousel = await createCarousel(
      `${template.name} (from template)`,
      template.aspectRatio,
      brandIdOf(template, await getDefaultBrandId())
    );

    // Copy all slides
    for (const slide of template.slides) {
      await addSlide(carousel.id, slide.html, slide.notes);
    }

    return NextResponse.json(carousel, { status: 201 });
  } catch (err) {
    const dataError = dataErrorResponse(err);
    if (dataError) return dataError;
    throw err;
  }
}
