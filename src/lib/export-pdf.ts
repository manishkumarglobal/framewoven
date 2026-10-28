import { PDFDocument } from "pdf-lib";
import type { AspectRatio } from "@/types/carousel";
import { DIMENSIONS } from "@/types/carousel";

/**
 * Slides are rendered in CSS pixels, which are defined at 96 per inch. PDF
 * pages are measured in points, 72 per inch. Scaling by 72/96 keeps every
 * aspect ratio exact (1080x1350 px -> 810x1012.5 pt, still 4:5) and gives the
 * page the physical size a browser would print the slide at.
 */
export const PDF_POINTS_PER_PIXEL = 72 / 96;

/**
 * LinkedIn's limits for document posts. The size limit is taken as decimal
 * megabytes, the stricter reading of "100 MB".
 */
export const LINKEDIN_MAX_PDF_BYTES = 100_000_000;
export const LINKEDIN_MAX_PDF_PAGES = 300;

/**
 * A PDF export failure whose message is safe to show the user as is.
 * `status` is the HTTP status the export route answers with.
 */
export class PdfExportError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "PdfExportError";
  }
}

/** The PDF page size, in points, for a carousel's aspect ratio. */
export function pdfPageSize(aspectRatio: AspectRatio): {
  width: number;
  height: number;
} {
  const { width, height } = DIMENSIONS[aspectRatio];
  return {
    width: width * PDF_POINTS_PER_PIXEL,
    height: height * PDF_POINTS_PER_PIXEL,
  };
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/**
 * pdf-lib decodes and compresses images synchronously. Handing the event loop
 * back between slides keeps a large export from stalling the rest of the
 * server, such as a chat response that is streaming at the same time.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Packages already-rendered slide PNGs into one PDF, one slide per page, in
 * the order given.
 *
 * Each PNG is embedded losslessly and drawn edge to edge on a page with the
 * slide's own aspect ratio, so the page shows exactly the pixels the PNG export
 * contains: nothing is re-rendered, cropped, scaled out of proportion or added.
 */
export async function buildSlidesPdf(
  pngs: Buffer[],
  aspectRatio: AspectRatio,
  options: { title?: string; maxBytes?: number } = {}
): Promise<Uint8Array> {
  const maxBytes = options.maxBytes ?? LINKEDIN_MAX_PDF_BYTES;

  if (pngs.length === 0) {
    throw new PdfExportError("There are no slides to put in the PDF.", 400);
  }
  if (pngs.length > LINKEDIN_MAX_PDF_PAGES) {
    throw new PdfExportError(
      `LinkedIn accepts at most ${LINKEDIN_MAX_PDF_PAGES} pages in a document, and this carousel has ${pngs.length} slides.`,
      422
    );
  }

  const expected = DIMENSIONS[aspectRatio];
  const page = pdfPageSize(aspectRatio);

  const pdf = await PDFDocument.create();
  if (options.title) pdf.setTitle(options.title);
  pdf.setCreator("Framewoven");
  pdf.setProducer("Framewoven");

  for (const [index, png] of pngs.entries()) {
    const image = await pdf.embedPng(png);
    // Every slide is rendered at the carousel's dimensions. A PNG of any other
    // size would have to be stretched or cropped to fill the page, so refuse it
    // rather than distort the slide.
    if (image.width !== expected.width || image.height !== expected.height) {
      throw new Error(
        `Slide ${index + 1} rendered at ${image.width}x${image.height}, expected ${expected.width}x${expected.height}`
      );
    }
    pdf
      .addPage([page.width, page.height])
      .drawImage(image, { x: 0, y: 0, width: page.width, height: page.height });
    // Compress this slide now rather than all of them at once inside save(),
    // which also releases its decoded pixels before the next slide.
    await image.embed();
    await yieldToEventLoop();
  }

  // A classic cross-reference table instead of compressed object streams, for
  // the widest PDF reader compatibility.
  const bytes = await pdf.save({ useObjectStreams: false });

  if (bytes.length > maxBytes) {
    throw new PdfExportError(
      `The PDF is ${formatMegabytes(bytes.length)}, above LinkedIn's ${formatMegabytes(maxBytes)} limit. ` +
        "Remove slides or use simpler, smaller images, then export again.",
      422
    );
  }

  return bytes;
}
