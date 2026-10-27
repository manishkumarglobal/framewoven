import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { PUT as putCarousel } from "@/app/api/carousels/[id]/route";
import { PUT as putSlide } from "@/app/api/carousels/[id]/slides/[slideId]/route";
import { PUT as putBrand, GET as getBrandRoute } from "@/app/api/brand/route";
import { POST as postCarousel } from "@/app/api/carousels/route";
import { createCarousel, addSlide, getCarousel } from "@/lib/carousels";
import { getBrand } from "@/lib/brand";
import type { Carousel, Slide } from "@/types/carousel";
import type { BrandConfig } from "@/types/brand";

// Routes are exercised end to end against a throwaway data directory, because
// the defect being fixed lived in the gap between the declared TypeScript
// contract and what actually reaches the store at runtime. Testing the picker
// alone would not have caught it.
let workdir: string;
let originalCwd: string;

beforeEach(async () => {
  originalCwd = process.cwd();
  workdir = await mkdtemp(path.join(tmpdir(), "framewoven-contract-"));
  await mkdir(path.join(workdir, "data"), { recursive: true });
  process.chdir(workdir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(workdir, { recursive: true, force: true });
});

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const carouselParams = (id: string) => ({ params: Promise.resolve({ id }) });
const slideParams = (id: string, slideId: string) => ({
  params: Promise.resolve({ id, slideId }),
});

async function updateCarouselViaRoute(id: string, body: unknown) {
  const res = await putCarousel(
    jsonRequest(`http://localhost:3000/api/carousels/${id}`, body),
    carouselParams(id)
  );
  return { status: res.status, body: (await res.json()) as Carousel };
}

async function updateSlideViaRoute(id: string, slideId: string, body: unknown) {
  const res = await putSlide(
    jsonRequest(
      `http://localhost:3000/api/carousels/${id}/slides/${slideId}`,
      body
    ),
    slideParams(id, slideId)
  );
  return { status: res.status, body: (await res.json()) as Slide };
}

describe("PUT /api/carousels/[id]", () => {
  it("still applies every field the endpoint defines as mutable", async () => {
    const carousel = await createCarousel("Original", "4:5");

    const { status, body } = await updateCarouselViaRoute(carousel.id, {
      name: "Renamed",
      aspectRatio: "9:16",
      tags: ["launch", "q4"],
      caption: "A caption",
      hashtags: ["design", "ai"],
      chatSessionId: "session-123",
    });

    expect(status).toBe(200);
    expect(body).toMatchObject({
      name: "Renamed",
      aspectRatio: "9:16",
      tags: ["launch", "q4"],
      caption: "A caption",
      hashtags: ["design", "ai"],
      chatSessionId: "session-123",
    });

    const stored = await getCarousel(carousel.id);
    expect(stored?.name).toBe("Renamed");
    expect(stored?.aspectRatio).toBe("9:16");
  });

  it("refuses to let a caller take over server-owned fields", async () => {
    const carousel = await createCarousel("Keeper", "4:5");
    await addSlide(carousel.id, "<div>one</div>", "one");
    await addSlide(carousel.id, "<div>two</div>", "two");
    const before = await getCarousel(carousel.id);

    const { body } = await updateCarouselViaRoute(carousel.id, {
      name: "Renamed",
      id: "HIJACKED-CAROUSEL",
      slides: [],
      referenceImages: "not-an-array",
      isTemplate: true,
      createdAt: "1999-01-01T00:00:00.000Z",
      updatedAt: "1999-01-01T00:00:00.000Z",
    });

    // The one legitimate field still applied.
    expect(body.name).toBe("Renamed");

    // None of the server-owned ones did.
    expect(body.id).toBe(carousel.id);
    expect(body.slides).toHaveLength(2);
    expect(body.referenceImages).toEqual([]);
    expect(body.isTemplate).toBe(false);
    expect(body.createdAt).toBe(before?.createdAt);
    expect(body.updatedAt).not.toBe("1999-01-01T00:00:00.000Z");

    // And the store agrees, so the carousel is still reachable and intact.
    const stored = await getCarousel(carousel.id);
    expect(stored).not.toBeNull();
    expect(stored?.slides).toHaveLength(2);
    expect(stored?.slides.map((s) => s.notes)).toEqual(["one", "two"]);
  });

  it("drops unknown fields instead of persisting them", async () => {
    const carousel = await createCarousel("Keeper", "4:5");
    await updateCarouselViaRoute(carousel.id, { name: "Renamed", junk: 42 });

    const stored = (await getCarousel(carousel.id)) as unknown as Record<
      string,
      unknown
    >;
    expect(stored.junk).toBeUndefined();
  });

  it("ignores an unsupported aspect ratio rather than storing it", async () => {
    // An unsupported value has no entry in DIMENSIONS, which the preview, the
    // export viewport and the safe-zone overlay all read.
    const carousel = await createCarousel("Keeper", "4:5");
    const { body } = await updateCarouselViaRoute(carousel.id, {
      aspectRatio: "banana",
    });
    expect(body.aspectRatio).toBe("4:5");
  });

  it("validates the aspect ratio the same way on create and on update", async () => {
    const res = await postCarousel(
      new Request("http://localhost:3000/api/carousels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New", aspectRatio: "banana" }),
      })
    );
    const created = (await res.json()) as Carousel;
    expect(created.aspectRatio).toBe("4:5");

    const { body } = await updateCarouselViaRoute(created.id, {
      aspectRatio: "banana",
    });
    expect(body.aspectRatio).toBe("4:5");
  });
});

describe("PUT /api/carousels/[id]/slides/[slideId]", () => {
  it("still updates the html and notes the agent sends", async () => {
    // This is the call the design agent is told to make.
    const carousel = await createCarousel("Agent", "4:5");
    const slide = await addSlide(carousel.id, "<div>v1</div>", "first");

    const { status, body } = await updateSlideViaRoute(carousel.id, slide!.id, {
      html: "<div>v2</div>",
    });

    expect(status).toBe(200);
    expect(body.html).toBe("<div>v2</div>");

    const withNotes = await updateSlideViaRoute(carousel.id, slide!.id, {
      html: "<div>v3</div>",
      notes: "revised",
    });
    expect(withNotes.body.notes).toBe("revised");
  });

  it("keeps recording undo history across an update", async () => {
    const carousel = await createCarousel("History", "4:5");
    const slide = await addSlide(carousel.id, "<div>v1</div>", "first");

    await updateSlideViaRoute(carousel.id, slide!.id, { html: "<div>v2</div>" });
    const { body } = await updateSlideViaRoute(carousel.id, slide!.id, {
      html: "<div>v3</div>",
    });

    expect(body.previousVersions).toEqual(["<div>v1</div>", "<div>v2</div>"]);
  });

  it("refuses to let a caller rewrite the slide's identity, order or history", async () => {
    const carousel = await createCarousel("Protect", "4:5");
    const slide = await addSlide(carousel.id, "<div>v1</div>", "first");
    await updateSlideViaRoute(carousel.id, slide!.id, { html: "<div>v2</div>" });

    const { body } = await updateSlideViaRoute(carousel.id, slide!.id, {
      html: "<div>v3</div>",
      id: "HIJACKED",
      order: 999,
      previousVersions: [],
      injected: "yes",
    });

    expect(body.html).toBe("<div>v3</div>");
    expect(body.id).toBe(slide!.id);
    expect(body.order).toBe(0);
    // Wiping this in the same request would have destroyed the undo history.
    expect(body.previousVersions).toEqual(["<div>v1</div>", "<div>v2</div>"]);
    expect((body as unknown as Record<string, unknown>).injected).toBeUndefined();

    const stored = await getCarousel(carousel.id);
    expect(stored?.slides[0].id).toBe(slide!.id);
    expect(stored?.slides[0].previousVersions).toHaveLength(2);
  });
});

describe("PUT /api/brand", () => {
  it("accepts the whole stored object the setup form posts back", async () => {
    // BrandSetup sends its full state, timestamps included. That must keep
    // working, and the timestamps must stay server-owned.
    const first = await putBrand(
      jsonRequest("http://localhost:3000/api/brand", {
        name: "Studio",
        colors: {
          primary: "#2E2E2E",
          secondary: "#DDE4DA",
          accent: "#C77B5A",
          background: "#F7F4EF",
          surface: "#FAF8F4",
        },
        fonts: { heading: "Cormorant Garamond", body: "Inter" },
        customFonts: [],
        logoPath: null,
        styleKeywords: ["minimal", "luxury"],
        createdAt: "1999-01-01T00:00:00.000Z",
        updatedAt: "1999-01-01T00:00:00.000Z",
      })
    );
    const body = (await first.json()) as BrandConfig;

    expect(body.name).toBe("Studio");
    expect(body.colors.accent).toBe("#C77B5A");
    expect(body.fonts.heading).toBe("Cormorant Garamond");
    expect(body.styleKeywords).toEqual(["minimal", "luxury"]);
    expect(body.createdAt).not.toBe("1999-01-01T00:00:00.000Z");
    expect(body.updatedAt).not.toBe("1999-01-01T00:00:00.000Z");
  });

  it("merges a partial colour change without losing the others", async () => {
    await putBrand(
      jsonRequest("http://localhost:3000/api/brand", {
        name: "Studio",
        colors: {
          primary: "#111111",
          secondary: "#222222",
          accent: "#333333",
          background: "#444444",
          surface: "#555555",
        },
      })
    );
    await putBrand(
      jsonRequest("http://localhost:3000/api/brand", {
        colors: { accent: "#C77B5A" },
      })
    );

    const brand = await getBrand();
    expect(brand.colors.accent).toBe("#C77B5A");
    expect(brand.colors.primary).toBe("#111111");
    expect(brand.name).toBe("Studio");
  });

  it("drops unknown fields instead of writing them into brand.json", async () => {
    await putBrand(
      jsonRequest("http://localhost:3000/api/brand", {
        name: "Studio",
        injectedBrandKey: "yes",
      })
    );

    const stored = (await getBrand()) as unknown as Record<string, unknown>;
    expect(stored.injectedBrandKey).toBeUndefined();
    expect(stored.name).toBe("Studio");

    const res = await getBrandRoute();
    const served = (await res.json()) as Record<string, unknown>;
    expect(served.injectedBrandKey).toBeUndefined();
  });
});
