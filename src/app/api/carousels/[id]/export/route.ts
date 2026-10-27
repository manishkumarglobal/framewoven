import { NextResponse } from "next/server";
import archiver from "archiver";
import { getCarousel } from "@/lib/carousels";
import { exportAllSlides, describeExportFailure } from "@/lib/export-slides";
import { buildSlidesPdf, PdfExportError } from "@/lib/export-pdf";
import { parseExportFormat } from "@/lib/export-formats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // No `format` means the original PNG ZIP, so existing callers are unaffected.
  const format = parseExportFormat(new URL(request.url).searchParams.get("format"));
  if (!format) {
    return NextResponse.json(
      { error: 'Unknown export format. Use "png" for a ZIP of PNGs or "pdf" for a PDF.' },
      { status: 400 }
    );
  }

  const carousel = await getCarousel(id);

  if (!carousel) {
    return NextResponse.json({ error: "Carousel not found" }, { status: 404 });
  }

  if (carousel.slides.length === 0) {
    return NextResponse.json({ error: "No slides to export" }, { status: 400 });
  }

  try {
    // Export all slides to PNG buffers
    const pngBuffers = await exportAllSlides(
      carousel.slides,
      carousel.aspectRatio
    );

    if (format === "pdf") {
      // The PDF pages are the PNGs rendered above, so both formats show the
      // same pixels.
      const pdfBytes = await buildSlidesPdf(
        pngBuffers.map(({ buffer }) => buffer),
        carousel.aspectRatio,
        { title: carousel.name }
      );
      return new Response(new Uint8Array(pdfBytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="carousel-${carousel.name.replace(/[^a-zA-Z0-9-_]/g, "_")}.pdf"`,
        },
      });
    }

    // Build ZIP archive and collect all data
    const zipBuffer = await new Promise<Buffer>((resolve, reject) => {
      const archive = archiver("zip", { zlib: { level: 5 } });
      const chunks: Buffer[] = [];

      archive.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });

      archive.on("end", () => {
        resolve(Buffer.concat(chunks));
      });

      archive.on("error", (err) => {
        reject(err);
      });

      try {
        for (const { name, buffer } of pngBuffers) {
          archive.append(buffer, { name });
        }
        archive.finalize();
      } catch (err) {
        archive.destroy();
        reject(err);
      }
    });

    return new Response(new Uint8Array(zipBuffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="carousel-${carousel.name.replace(/[^a-zA-Z0-9-_]/g, "_")}.zip"`,
      },
    });
  } catch (error) {
    if (error instanceof PdfExportError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    // Full detail stays server-side; the client gets a safe, actionable summary.
    console.error("[export] failed", error);
    return NextResponse.json(
      { error: describeExportFailure(error) },
      { status: 500 }
    );
  }
}
