import { describe, it, expect } from "vitest";
import {
  buildSlidesPdf,
  pdfPageSize,
  PdfExportError,
  PDF_POINTS_PER_PIXEL,
  LINKEDIN_MAX_PDF_BYTES,
  LINKEDIN_MAX_PDF_PAGES,
} from "@/lib/export-pdf";
import {
  DEFAULT_EXPORT_FORMAT,
  EXPORT_FORMATS,
  filenameFromDisposition,
  linkedInAdvisory,
  parseExportFormat,
} from "@/lib/export-formats";
import { DIMENSIONS, MAX_SLIDES } from "@/types/carousel";
import type { AspectRatio } from "@/types/carousel";
import {
  detailedSlidePng,
  readPdfPages,
  rgbPixels,
  syntheticSlidePng,
} from "./helpers/export-files";

const RATIOS: AspectRatio[] = ["4:5", "1:1", "9:16"];

// Distinct colours so a page can be matched to the slide it came from.
const PALETTE = [
  { r: 233, g: 69, b: 96 },
  { r: 26, g: 26, b: 46 },
  { r: 22, g: 160, b: 133 },
  { r: 241, g: 196, b: 15 },
];

async function slidesFor(ratio: AspectRatio, count: number): Promise<Buffer[]> {
  const { width, height } = DIMENSIONS[ratio];
  return Promise.all(
    Array.from({ length: count }, (_, i) =>
      syntheticSlidePng(width, height, PALETTE[i % PALETTE.length], {
        r: i * 40,
        g: 255 - i * 40,
        b: 128,
      })
    )
  );
}

describe("PDF page size", () => {
  it("converts slide pixels to points at 72/96", () => {
    expect(PDF_POINTS_PER_PIXEL).toBe(0.75);
    expect(pdfPageSize("4:5")).toEqual({ width: 810, height: 1012.5 });
    expect(pdfPageSize("1:1")).toEqual({ width: 810, height: 810 });
    expect(pdfPageSize("9:16")).toEqual({ width: 810, height: 1440 });
  });

  it("keeps each carousel's exact aspect ratio", () => {
    expect(pdfPageSize("4:5").width / pdfPageSize("4:5").height).toBe(4 / 5);
    expect(pdfPageSize("1:1").width / pdfPageSize("1:1").height).toBe(1);
    expect(pdfPageSize("9:16").width / pdfPageSize("9:16").height).toBe(9 / 16);
  });
});

describe("buildSlidesPdf", () => {
  it("produces a structurally valid, unencrypted PDF", async () => {
    const bytes = await buildSlidesPdf(await slidesFor("4:5", 2), "4:5", {
      title: "Launch week",
    });
    const text = Buffer.from(bytes).toString("latin1");
    // Object syntax only: compressed image data can contain any byte sequence.
    const objects = text.replace(/stream\r?\n[\s\S]*?endstream/g, "stream endstream");

    expect(text.startsWith("%PDF-1.")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    // A classic xref table, readable by every PDF reader.
    expect(objects).toContain("\nxref\n");
    expect(objects).not.toContain("/Encrypt");
    expect(objects).not.toContain("/ObjStm");
    // Nothing interactive or scripted. pdf-lib writes an empty `/Annots [ ]`.
    expect(objects).not.toMatch(/\/JavaScript|\/JS\b|\/AcroForm|\/OpenAction/);
    expect(objects).not.toMatch(/\/Annots\s*\[\s*[^\]\s]/);

    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes);
    expect(doc.isEncrypted).toBe(false);
    expect(doc.getTitle()).toBe("Launch week");
  });

  it("creates exactly one page per slide", async () => {
    for (const count of [1, 3, MAX_SLIDES]) {
      const pages = await readPdfPages(
        await buildSlidesPdf(await slidesFor("1:1", count), "1:1")
      );
      expect(pages).toHaveLength(count);
      for (const page of pages) expect(page.images).toHaveLength(1);
    }
  });

  it("keeps slide order", async () => {
    const pngs = await slidesFor("4:5", 4);
    const pages = await readPdfPages(await buildSlidesPdf(pngs, "4:5"));

    for (const [i, page] of pages.entries()) {
      const pixels = page.images[0].pixels;
      // Bottom-right corner is background; top-left block is the marker.
      const last = pixels.length - 3;
      expect([...pixels.subarray(last, last + 3)]).toEqual([
        PALETTE[i].r,
        PALETTE[i].g,
        PALETTE[i].b,
      ]);
      const marker = (50 * DIMENSIONS["4:5"].width + 50) * 3;
      expect([...pixels.subarray(marker, marker + 3)]).toEqual([
        i * 40,
        255 - i * 40,
        128,
      ]);
    }
  });

  for (const ratio of RATIOS) {
    it(`gives ${ratio} slides ${ratio} pages of identical size`, async () => {
      const expected = pdfPageSize(ratio);
      const pages = await readPdfPages(
        await buildSlidesPdf(await slidesFor(ratio, 3), ratio)
      );

      for (const page of pages) {
        expect(page.width).toBe(expected.width);
        expect(page.height).toBe(expected.height);
      }
      const [w, h] = ratio.split(":").map(Number);
      expect(pages[0].width / pages[0].height).toBeCloseTo(w / h, 12);
    });

    it(`draws each ${ratio} slide edge to edge, unscaled relative to the page`, async () => {
      const { width, height } = pdfPageSize(ratio);
      const pages = await readPdfPages(
        await buildSlidesPdf(await slidesFor(ratio, 2), ratio)
      );

      for (const page of pages) {
        // One image, placed at the origin and scaled to exactly the page: no
        // crop, no offset, no stretch to another ratio.
        expect(page.operators).toMatch(
          new RegExp(`\\b${width} 0 0 ${height} 0 0 cm\\b`)
        );
        expect(page.operators.match(/\bDo\b/g)).toHaveLength(1);
        // Nothing but the image is painted: no text, paths or watermark.
        expect(page.operators).not.toMatch(/\b(Tj|TJ|re|f|S|BT)\b/);
        expect(page.images[0].width).toBe(DIMENSIONS[ratio].width);
        expect(page.images[0].height).toBe(DIMENSIONS[ratio].height);
      }
    });
  }

  it("embeds every PNG pixel unchanged", async () => {
    // Noise stands in for text edges, gradients and photographs: any resampling
    // or lossy compression would change some of these samples.
    for (const ratio of RATIOS) {
      const { width, height } = DIMENSIONS[ratio];
      const pngs = [
        await detailedSlidePng(width, height, 7),
        await syntheticSlidePng(width, height, PALETTE[0]),
      ];
      const pages = await readPdfPages(await buildSlidesPdf(pngs, ratio));

      for (const [i, page] of pages.entries()) {
        const image = page.images[0];
        expect(image.colorSpace).toBe("/DeviceRGB");
        expect(image.bitsPerComponent).toBe(8);
        expect(image.hasSoftMask).toBe(false);
        expect(image.pixels.equals(await rgbPixels(pngs[i]))).toBe(true);
      }
    }
  });

  it("does not modify the PNG buffers it is given", async () => {
    const pngs = await slidesFor("4:5", 2);
    const copies = pngs.map((png) => Buffer.from(png));
    await buildSlidesPdf(pngs, "4:5");
    pngs.forEach((png, i) => expect(png.equals(copies[i])).toBe(true));
  });

  it("refuses an empty export", async () => {
    const attempt = buildSlidesPdf([], "4:5");
    await expect(attempt).rejects.toBeInstanceOf(PdfExportError);
    await expect(attempt).rejects.toMatchObject({ status: 400 });
  });

  it("refuses a slide that would have to be stretched or cropped", async () => {
    const square = await syntheticSlidePng(1080, 1080, PALETTE[0]);
    await expect(buildSlidesPdf([square], "4:5")).rejects.toThrow(
      /rendered at 1080x1080, expected 1080x1350/
    );
  });

  it("refuses data that is not a PNG", async () => {
    await expect(
      buildSlidesPdf([Buffer.from("not an image")], "4:5")
    ).rejects.toThrow();
  });

  it("enforces the size limit with an actionable message", async () => {
    const pngs = [await detailedSlidePng(1080, 1350, 3)];
    const attempt = buildSlidesPdf(pngs, "4:5", { maxBytes: 1024 * 1024 });
    await expect(attempt).rejects.toBeInstanceOf(PdfExportError);
    await expect(attempt).rejects.toMatchObject({ status: 422 });
    await expect(attempt).rejects.toThrow(
      /The PDF is \d+\.\d MB, above LinkedIn's 1\.0 MB limit\. Remove slides or use simpler, smaller images/
    );
  });

  it("uses LinkedIn's document limits by default", async () => {
    expect(LINKEDIN_MAX_PDF_BYTES).toBe(100 * 1024 * 1024);
    expect(LINKEDIN_MAX_PDF_PAGES).toBe(300);
    // Framewoven's own slide limit sits well inside LinkedIn's page limit.
    expect(MAX_SLIDES).toBeLessThanOrEqual(LINKEDIN_MAX_PDF_PAGES);

    const tooMany = Array.from(
      { length: LINKEDIN_MAX_PDF_PAGES + 1 },
      () => Buffer.alloc(0)
    );
    const attempt = buildSlidesPdf(tooMany, "4:5");
    await expect(attempt).rejects.toMatchObject({ status: 422 });
    await expect(attempt).rejects.toThrow(/at most 300 pages/);
  });
});

describe("export formats", () => {
  it("defaults to the PNG ZIP when no format is given", () => {
    expect(DEFAULT_EXPORT_FORMAT).toBe("png");
    expect(parseExportFormat(null)).toBe("png");
    expect(parseExportFormat("")).toBe("png");
  });

  it("accepts the two formats and rejects anything else", () => {
    expect(parseExportFormat("png")).toBe("png");
    expect(parseExportFormat("pdf")).toBe("pdf");
    for (const value of ["PDF", "zip", "jpeg", "pdf ", "../pdf"]) {
      expect(parseExportFormat(value)).toBeNull();
    }
  });

  it("offers Instagram PNG ZIP first and LinkedIn PDF second", () => {
    expect(
      EXPORT_FORMATS.map((f) => `${f.platform} · ${f.label}`)
    ).toEqual(["Instagram · PNG ZIP", "LinkedIn · PDF"]);
    expect(EXPORT_FORMATS.map((f) => f.extension)).toEqual(["zip", "pdf"]);
  });

  it("advises on 9:16 LinkedIn exports only", () => {
    expect(linkedInAdvisory("4:5")).toBeNull();
    expect(linkedInAdvisory("1:1")).toBeNull();
    expect(linkedInAdvisory("9:16")).toMatch(/4:5 generally displays better/);
  });

  it("reads the attachment filename the server sends", () => {
    expect(
      filenameFromDisposition('attachment; filename="carousel-Launch_week.pdf"')
    ).toBe("carousel-Launch_week.pdf");
    expect(filenameFromDisposition(null)).toBeNull();
    expect(filenameFromDisposition("attachment")).toBeNull();
    expect(filenameFromDisposition('attachment; filename="../../x.pdf"')).toBe(
      ".._.._x.pdf"
    );
  });
});
