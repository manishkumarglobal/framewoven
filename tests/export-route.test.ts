import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AspectRatio, Carousel, Slide } from "@/types/carousel";
import { DIMENSIONS } from "@/types/carousel";
import { pdfPageSize } from "@/lib/export-pdf";
import {
  detailedSlidePng,
  readPdfPages,
  readZipEntries,
  rgbPixels,
  syntheticSlidePng,
} from "./helpers/export-files";

// The route is exercised for real; only storage and the Chromium renderer are
// replaced, so these tests run without a browser and without ./data.
vi.mock("@/lib/carousels", () => ({ getCarousel: vi.fn() }));
vi.mock("@/lib/export-slides", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/export-slides")>()),
  exportAllSlides: vi.fn(),
}));

const { getCarousel } = await import("@/lib/carousels");
const { exportAllSlides } = await import("@/lib/export-slides");
const { POST } = await import("@/app/api/carousels/[id]/export/route");

const getCarouselMock = vi.mocked(getCarousel);
const exportAllSlidesMock = vi.mocked(exportAllSlides);

function carousel(aspectRatio: AspectRatio, slideCount: number): Carousel {
  const slides: Slide[] = Array.from({ length: slideCount }, (_, i) => ({
    id: `s${i + 1}`,
    html: `<div>Slide ${i + 1}</div>`,
    previousVersions: [],
    order: i,
    notes: "",
  }));
  return {
    id: "c1",
    name: "Launch week: v2!",
    aspectRatio,
    slides,
    referenceImages: [],
    chatSessionId: null,
    isTemplate: false,
    tags: [],
    createdAt: "",
    updatedAt: "",
  };
}

/** Stands in for the Chromium renderer: one distinct PNG per slide, in order. */
async function renderedPngs(aspectRatio: AspectRatio, count: number) {
  const { width, height } = DIMENSIONS[aspectRatio];
  return Promise.all(
    Array.from({ length: count }, async (_, i) => ({
      name: `slide-${i + 1}.png`,
      buffer: await syntheticSlidePng(width, height, {
        r: 30 * i,
        g: 200 - 30 * i,
        b: 90,
      }),
    }))
  );
}

function exportRequest(query = "") {
  return POST(
    new Request(`http://localhost:3000/api/carousels/c1/export${query}`, {
      method: "POST",
    }),
    { params: Promise.resolve({ id: "c1" }) }
  );
}

beforeEach(() => {
  getCarouselMock.mockReset();
  exportAllSlidesMock.mockReset();
});

describe("PNG ZIP export (unchanged)", () => {
  it("still answers a request without a format with the ZIP of PNGs", async () => {
    const rendered = await renderedPngs("4:5", 3);
    getCarouselMock.mockResolvedValue(carousel("4:5", 3));
    exportAllSlidesMock.mockResolvedValue(rendered);

    const response = await exportRequest();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="carousel-Launch_week__v2_.zip"'
    );
    const entries = readZipEntries(Buffer.from(await response.arrayBuffer()));
    expect(entries.map((e) => e.name)).toEqual([
      "slide-1.png",
      "slide-2.png",
      "slide-3.png",
    ]);
    // The PNGs inside are byte-for-byte what the renderer produced.
    entries.forEach((entry, i) =>
      expect(entry.data.equals(rendered[i].buffer)).toBe(true)
    );
  });

  it("renders with the carousel's slides and aspect ratio, once", async () => {
    const c = carousel("9:16", 2);
    getCarouselMock.mockResolvedValue(c);
    exportAllSlidesMock.mockResolvedValue(await renderedPngs("9:16", 2));

    await exportRequest();

    expect(exportAllSlidesMock).toHaveBeenCalledTimes(1);
    expect(exportAllSlidesMock).toHaveBeenCalledWith(c.slides, "9:16");
  });

  it("treats ?format=png exactly like no format", async () => {
    const rendered = await renderedPngs("1:1", 2);
    getCarouselMock.mockResolvedValue(carousel("1:1", 2));
    exportAllSlidesMock.mockResolvedValue(rendered);

    const implicit = await exportRequest();
    const explicit = await exportRequest("?format=png");

    expect(explicit.status).toBe(implicit.status);
    expect([...explicit.headers.entries()]).toEqual([
      ...implicit.headers.entries(),
    ]);
    const a = readZipEntries(Buffer.from(await implicit.arrayBuffer()));
    const b = readZipEntries(Buffer.from(await explicit.arrayBuffer()));
    expect(b.map((e) => e.name)).toEqual(a.map((e) => e.name));
    b.forEach((entry, i) => expect(entry.data.equals(a[i].data)).toBe(true));
  });
});

describe("LinkedIn PDF export", () => {
  for (const ratio of ["4:5", "1:1", "9:16"] as AspectRatio[]) {
    it(`returns one ${ratio} PDF page per rendered slide, in order`, async () => {
      const rendered = await renderedPngs(ratio, 4);
      getCarouselMock.mockResolvedValue(carousel(ratio, 4));
      exportAllSlidesMock.mockResolvedValue(rendered);

      const response = await exportRequest("?format=pdf");

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/pdf");
      expect(response.headers.get("Content-Disposition")).toBe(
        'attachment; filename="carousel-Launch_week__v2_.pdf"'
      );

      const pages = await readPdfPages(new Uint8Array(await response.arrayBuffer()));
      expect(pages).toHaveLength(4);
      for (const [i, page] of pages.entries()) {
        expect({ width: page.width, height: page.height }).toEqual(
          pdfPageSize(ratio)
        );
        expect(
          page.images[0].pixels.equals(await rgbPixels(rendered[i].buffer))
        ).toBe(true);
      }
    });
  }

  it("renders the slides once, through the same renderer as the ZIP", async () => {
    const c = carousel("4:5", 2);
    getCarouselMock.mockResolvedValue(c);
    exportAllSlidesMock.mockResolvedValue(await renderedPngs("4:5", 2));

    await exportRequest("?format=pdf");

    expect(exportAllSlidesMock).toHaveBeenCalledTimes(1);
    expect(exportAllSlidesMock).toHaveBeenCalledWith(c.slides, "4:5");
  });

  it(
    "refuses a PDF above LinkedIn's 100 MB limit with an actionable error",
    async () => {
      // 20 story slides of incompressible detail is the largest carousel
      // Framewoven allows, and it does not fit in a LinkedIn document.
      const noise = await detailedSlidePng(1080, 1920, 11);
      getCarouselMock.mockResolvedValue(carousel("9:16", 20));
      exportAllSlidesMock.mockResolvedValue(
        Array.from({ length: 20 }, (_, i) => ({
          name: `slide-${i + 1}.png`,
          buffer: noise,
        }))
      );

      const response = await exportRequest("?format=pdf");

      expect(response.status).toBe(422);
      const body = (await response.json()) as { error: string };
      expect(body.error).toMatch(
        /^The PDF is \d+\.\d MB, above LinkedIn's 100\.0 MB limit\. Remove slides/
      );
    },
    120_000
  );
});

describe("export errors", () => {
  it("rejects an unknown format before rendering anything", async () => {
    getCarouselMock.mockResolvedValue(carousel("4:5", 2));

    const response = await exportRequest("?format=docx");

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(
      /Unknown export format/
    );
    expect(exportAllSlidesMock).not.toHaveBeenCalled();
  });

  for (const query of ["", "?format=pdf"]) {
    it(`answers 404 for a missing carousel (${query || "no format"})`, async () => {
      getCarouselMock.mockResolvedValue(null);
      const response = await exportRequest(query);
      expect(response.status).toBe(404);
      expect(exportAllSlidesMock).not.toHaveBeenCalled();
    });

    it(`refuses an empty carousel (${query || "no format"})`, async () => {
      getCarouselMock.mockResolvedValue(carousel("4:5", 0));
      const response = await exportRequest(query);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "No slides to export" });
      expect(exportAllSlidesMock).not.toHaveBeenCalled();
    });

    it(`reports a render failure safely (${query || "no format"})`, async () => {
      getCarouselMock.mockResolvedValue(carousel("4:5", 1));
      exportAllSlidesMock.mockRejectedValue(
        new Error("Failed to launch the browser process! /home/x/chrome")
      );
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});

      const response = await exportRequest(query);

      expect(response.status).toBe(500);
      const { error } = (await response.json()) as { error: string };
      expect(error).toContain("npx puppeteer browsers install chrome");
      expect(error).not.toContain("/home/x");
      spy.mockRestore();
    });
  }

  it("reports a slide rendered at the wrong size as a failure, not a distorted page", async () => {
    getCarouselMock.mockResolvedValue(carousel("4:5", 1));
    exportAllSlidesMock.mockResolvedValue([
      {
        name: "slide-1.png",
        buffer: await syntheticSlidePng(1080, 1080, { r: 0, g: 0, b: 0 }),
      },
    ]);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await exportRequest("?format=pdf");

    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    spy.mockRestore();
  });
});
