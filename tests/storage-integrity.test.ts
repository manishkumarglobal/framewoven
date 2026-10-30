import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { mutateData, readDataSafe, DataFileCorruptError } from "@/lib/data";
import {
  createCarousel,
  addSlide,
  getCarousel,
  listCarousels,
  reorderSlides,
} from "@/lib/carousels";
import { getBrand, updateBrand } from "@/lib/brand";

// The data layer resolves its directory from the working directory, so each
// test runs against a throwaway one. Nothing here touches the real ./data.
let workdir: string;
let originalCwd: string;

const carouselsPath = () => path.join(workdir, "data", "carousels.json");

beforeEach(async () => {
  originalCwd = process.cwd();
  workdir = await mkdtemp(path.join(tmpdir(), "creatorbrio-storage-"));
  await mkdir(path.join(workdir, "data"), { recursive: true });
  process.chdir(workdir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(workdir, { recursive: true, force: true });
});

describe("concurrent mutations", () => {
  it("keeps every concurrent change to the same file", async () => {
    const FILE = "concurrent.json";
    const total = 40;

    await Promise.all(
      Array.from({ length: total }, (_, i) =>
        mutateData<{ items: number[] }, void>(
          FILE,
          () => ({ items: [] }),
          (data) => {
            data.items.push(i);
          }
        )
      )
    );

    const stored = await readDataSafe<{ items: number[] }>(FILE, { items: [] });
    expect(stored.items).toHaveLength(total);
    expect([...stored.items].sort((a, b) => a - b)).toEqual(
      Array.from({ length: total }, (_, i) => i)
    );
  });

  it("persists every slide when slides are created concurrently", async () => {
    // This is the shape that lost data: the agent creates slides while the
    // editor is also writing. Reading outside the lock let overlapping callers
    // share a snapshot, so the last write won and the rest vanished despite
    // every request reporting success.
    const carousel = await createCarousel("Concurrency", "4:5");
    const total = 12;

    const created = await Promise.all(
      Array.from({ length: total }, (_, i) =>
        addSlide(carousel.id, `<div>slide ${i}</div>`, `note-${i}`)
      )
    );

    expect(created.every((slide) => slide !== null)).toBe(true);

    const stored = await getCarousel(carousel.id);
    expect(stored?.slides).toHaveLength(total);
    expect(stored?.slides.map((s) => s.order).sort((a, b) => a - b)).toEqual(
      Array.from({ length: total }, (_, i) => i)
    );
    expect(new Set(stored?.slides.map((s) => s.notes)).size).toBe(total);
  });

  it("keeps concurrent brand updates from erasing one another", async () => {
    await Promise.all([
      updateBrand({ name: "Studio" }),
      updateBrand({ styleKeywords: ["minimal", "editorial"] }),
      updateBrand({ logoPath: "/uploads/logo.png" }),
    ]);

    const brand = await getBrand();
    expect(brand.name).toBe("Studio");
    expect(brand.styleKeywords).toEqual(["minimal", "editorial"]);
    expect(brand.logoPath).toBe("/uploads/logo.png");
  });
});

describe("malformed data files", () => {
  const damaged = '{"carousels": [ {"id": "work-that-must-survive"';

  it("reports a parse failure instead of pretending the file is empty", async () => {
    await writeFile(carouselsPath(), damaged, "utf-8");
    await expect(listCarousels()).rejects.toBeInstanceOf(DataFileCorruptError);
  });

  it("leaves the damaged file byte-for-byte intact after a failed read", async () => {
    await writeFile(carouselsPath(), damaged, "utf-8");
    await expect(listCarousels()).rejects.toThrow();
    expect(await readFile(carouselsPath(), "utf-8")).toBe(damaged);
  });

  it("refuses to overwrite a damaged file when a write is attempted", async () => {
    await writeFile(carouselsPath(), damaged, "utf-8");

    await expect(createCarousel("New carousel", "4:5")).rejects.toBeInstanceOf(
      DataFileCorruptError
    );

    expect(await readFile(carouselsPath(), "utf-8")).toBe(damaged);
    await expect(stat(`${carouselsPath()}.tmp`)).rejects.toThrow();
  });

  it("treats an empty file as damaged rather than as a first run", async () => {
    await writeFile(carouselsPath(), "", "utf-8");
    await expect(listCarousels()).rejects.toBeInstanceOf(DataFileCorruptError);
  });

  it("names the file and its path so the user can recover it", async () => {
    await writeFile(carouselsPath(), damaged, "utf-8");
    await expect(listCarousels()).rejects.toThrow(/carousels\.json/);
    await expect(listCarousels()).rejects.toThrow(
      new RegExp(carouselsPath().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    );
  });

  it("applies defaults for a file that is genuinely absent", async () => {
    await expect(listCarousels()).resolves.toEqual([]);
    await expect(getBrand()).resolves.toMatchObject({ name: "" });
  });

  it("does not persist anything when a mutation throws", async () => {
    const carousel = await createCarousel("Keeper", "4:5");
    const before = await readFile(carouselsPath(), "utf-8");

    await expect(
      mutateData<{ carousels: unknown[] }, void>(
        "carousels.json",
        () => ({ carousels: [] }),
        (data) => {
          data.carousels.length = 0;
          throw new Error("mutator failed");
        }
      )
    ).rejects.toThrow("mutator failed");

    expect(await readFile(carouselsPath(), "utf-8")).toBe(before);
    await expect(getCarousel(carousel.id)).resolves.not.toBeNull();
  });
});

describe("reorder validation", () => {
  it("rejects a reorder that would drop or duplicate slides", async () => {
    const carousel = await createCarousel("Reorder", "4:5");
    const a = await addSlide(carousel.id, "<div>a</div>", "a");
    const b = await addSlide(carousel.id, "<div>b</div>", "b");
    const c = await addSlide(carousel.id, "<div>c</div>", "c");

    // A subset used to be accepted, which silently deleted the slides left out.
    await expect(reorderSlides(carousel.id, [a!.id, b!.id])).resolves.toBe(false);
    expect((await getCarousel(carousel.id))?.slides).toHaveLength(3);

    await expect(
      reorderSlides(carousel.id, [a!.id, a!.id, b!.id])
    ).resolves.toBe(false);
    expect((await getCarousel(carousel.id))?.slides).toHaveLength(3);

    await expect(
      reorderSlides(carousel.id, [c!.id, a!.id, b!.id])
    ).resolves.toBe(true);

    const stored = await getCarousel(carousel.id);
    expect(stored?.slides.map((s) => s.id)).toEqual([c!.id, a!.id, b!.id]);
    expect(stored?.slides.map((s) => s.order)).toEqual([0, 1, 2]);
  });
});
