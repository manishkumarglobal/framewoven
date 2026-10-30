import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import puppeteer from "puppeteer";
import sharp from "sharp";
import type { AspectRatio, Slide } from "@/types/carousel";
import { DIMENSIONS } from "@/types/carousel";
import { pdfPageSize } from "@/lib/export-pdf";
import { readPdfPages, rgbPixels } from "./helpers/export-files";

// End to end through the real renderer: slide HTML -> Chromium PNG -> PDF ->
// rasterised PDF page. It needs Chromium, which CI does not install, and uses
// poppler's pdftocairo, pdfimages and pdfinfo when present. Without Chromium the suite is
// skipped; the packaging itself is covered by export-pdf.test.ts everywhere.
function chromiumPath(): string | null {
  try {
    const candidate = process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath();
    return candidate && existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function hasCommand(command: string): boolean {
  try {
    execFileSync(command, ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const chromium = chromiumPath();
const poppler = ["pdftocairo", "pdfimages", "pdfinfo"].every(hasCommand);

const BRAND = { accent: "#e94560", ink: "#1a1a2e", paper: "#f7f3e9" };

/** Synthetic slides covering text, a web font, an uploaded image and brand colours. */
function slides(): Slide[] {
  const html = [
    `<div style="width:100%;height:100%;background:${BRAND.paper};font-family:'Playfair Display',serif;color:${BRAND.ink};padding:80px;box-sizing:border-box">
       <h1 style="font-size:96px;margin:0">Launch week</h1>
       <p style="font-size:40px;font-style:italic">Five lessons from shipping</p>
       <div style="position:absolute;left:0;bottom:0;width:100%;height:120px;background:${BRAND.accent}"></div>
     </div>`,
    `<div style="width:100%;height:100%;background:${BRAND.ink};color:#fff;font-family:'Inter',sans-serif;padding:80px;box-sizing:border-box">
       <img src="/uploads/fixture.png" style="display:block;width:400px;height:400px" />
       <p style="font-size:44px;font-weight:700">Uploaded image, inlined for export</p>
     </div>`,
    `<div style="width:100%;height:100%;background:linear-gradient(135deg,${BRAND.accent},${BRAND.ink});color:#fff;font-family:'Inter',sans-serif;display:flex;align-items:center;justify-content:center">
       <span style="font-size:120px;font-weight:800">03</span>
     </div>`,
  ];
  return html.map((h, i) => ({
    id: `s${i + 1}`,
    html: h,
    previousVersions: [],
    order: i,
    notes: "",
  }));
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

describe.skipIf(!chromium)("PDF export through the real slide renderer", () => {
  let workdir: string;
  let originalCwd: string;
  let previousExecutable: string | undefined;
  let exportAllSlides: typeof import("@/lib/export-slides").exportAllSlides;
  let buildSlidesPdf: typeof import("@/lib/export-pdf").buildSlidesPdf;

  const rendered = new Map<AspectRatio, { name: string; buffer: Buffer }[]>();
  const pdfs = new Map<AspectRatio, Uint8Array>();

  beforeAll(async () => {
    originalCwd = process.cwd();
    previousExecutable = process.env.PUPPETEER_EXECUTABLE_PATH;
    process.env.PUPPETEER_EXECUTABLE_PATH = chromium!;

    // Uploads and the font cache resolve from the working directory, so the
    // test uses a throwaway one rather than the real ./public and ./data.
    workdir = await mkdtemp(path.join(tmpdir(), "creatorbrio-pdf-render-"));
    await mkdir(path.join(workdir, "public", "uploads"), { recursive: true });
    await mkdir(path.join(workdir, "data"), { recursive: true });
    const fixture = await sharp({
      create: { width: 400, height: 400, channels: 3, background: { r: 22, g: 160, b: 133 } },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 200, height: 200, channels: 3, background: { r: 241, g: 196, b: 15 } },
          })
            .png()
            .toBuffer(),
          left: 100,
          top: 100,
        },
      ])
      .png()
      .toBuffer();
    await writeFile(path.join(workdir, "public", "uploads", "fixture.png"), fixture);
    process.chdir(workdir);

    ({ exportAllSlides } = await import("@/lib/export-slides"));
    ({ buildSlidesPdf } = await import("@/lib/export-pdf"));

    for (const ratio of ["4:5", "1:1", "9:16"] as AspectRatio[]) {
      const pngs = await exportAllSlides(slides(), ratio);
      rendered.set(ratio, pngs);
      pdfs.set(
        ratio,
        await buildSlidesPdf(
          pngs.map((p) => p.buffer),
          ratio,
          { title: `Synthetic ${ratio}` }
        )
      );
    }
  }, 240_000);

  afterAll(async () => {
    process.chdir(originalCwd);
    if (previousExecutable === undefined) delete process.env.PUPPETEER_EXECUTABLE_PATH;
    else process.env.PUPPETEER_EXECUTABLE_PATH = previousExecutable;
    if (workdir) await rm(workdir, { recursive: true, force: true });
  });

  it("renders the PNGs at the carousel's exact Instagram dimensions", async () => {
    for (const [ratio, pngs] of rendered) {
      expect(pngs.map((p) => p.name)).toEqual(["slide-1.png", "slide-2.png", "slide-3.png"]);
      for (const { buffer } of pngs) {
        const meta = await sharp(buffer).metadata();
        expect([meta.width, meta.height]).toEqual([
          DIMENSIONS[ratio].width,
          DIMENSIONS[ratio].height,
        ]);
      }
    }
  });

  it("puts exactly the rendered PNG pixels on each page, in order", async () => {
    for (const [ratio, pdf] of pdfs) {
      const pages = await readPdfPages(pdf);
      const pngs = rendered.get(ratio)!;
      expect(pages).toHaveLength(pngs.length);
      for (const [i, page] of pages.entries()) {
        expect({ width: page.width, height: page.height }).toEqual(pdfPageSize(ratio));
        expect(page.images[0].pixels.equals(await rgbPixels(pngs[i].buffer))).toBe(true);
      }
    }
  });

  describe.skipIf(!poppler)("as seen by a standard PDF reader (poppler)", () => {
    async function rasterise(pdf: Uint8Array, name: string): Promise<Buffer[]> {
      const file = path.join(workdir, `${name}.pdf`);
      await writeFile(file, pdf);
      const pages = Number(
        /Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [file]).toString())![1]
      );
      const out: Buffer[] = [];
      for (let p = 1; p <= pages; p++) {
        const prefix = path.join(workdir, `${name}-${p}`);
        // 96 dpi turns 72/96-scaled points back into the slide's own pixels.
        // pdftocairo rather than pdftoppm: poppler's Splash backend smooths
        // images even at 1:1, while Cairo draws them as stored.
        execFileSync("pdftocairo", ["-r", "96", "-f", `${p}`, "-l", `${p}`, "-singlefile", "-png", file, prefix]);
        out.push(await readFile(`${prefix}.png`));
      }
      return out;
    }

    it("reports valid, unencrypted documents with uniform page sizes", async () => {
      for (const [ratio, pdf] of pdfs) {
        const file = path.join(workdir, `info-${ratio.replace(":", "x")}.pdf`);
        await writeFile(file, pdf);
        const info = execFileSync("pdfinfo", ["-f", "1", "-l", "3", file]).toString();
        expect(info).toMatch(/Encrypted:\s+no/);
        expect(info).toMatch(/Pages:\s+3/);
        const { width, height } = pdfPageSize(ratio);
        const sizes = [...info.matchAll(/Page\s+\d+ size:\s+([\d.]+) x ([\d.]+) pts/g)].map(
          (m) => [Number(m[1]), Number(m[2])]
        );
        expect(sizes).toEqual([
          [width, height],
          [width, height],
          [width, height],
        ]);
      }
    });

    it("displays each page as the same image as the PNG export", async () => {
      for (const [ratio, pdf] of pdfs) {
        const pages = await rasterise(pdf, `raster-${ratio.replace(":", "x")}`);
        const pngs = rendered.get(ratio)!;
        for (const [i, page] of pages.entries()) {
          const meta = await sharp(page).metadata();
          expect([meta.width, meta.height]).toEqual([
            DIMENSIONS[ratio].width,
            DIMENSIONS[ratio].height,
          ]);
          const a = await rgbPixels(page);
          const b = await rgbPixels(pngs[i].buffer);
          let maxDiff = 0;
          for (let k = 0; k < a.length; k++) maxDiff = Math.max(maxDiff, Math.abs(a[k] - b[k]));
          expect(maxDiff, `${ratio} page ${i + 1}`).toBe(0);
        }
      }
    });

    it("stores each page's image as the PNG, as extracted by pdfimages", async () => {
      for (const [ratio, pdf] of pdfs) {
        const name = `extract-${ratio.replace(":", "x")}`;
        const file = path.join(workdir, `${name}.pdf`);
        await writeFile(file, pdf);
        execFileSync("pdfimages", ["-png", file, path.join(workdir, name)]);
        const pngs = rendered.get(ratio)!;
        for (const [i, { buffer }] of pngs.entries()) {
          const extracted = await readFile(
            path.join(workdir, `${name}-${String(i).padStart(3, "0")}.png`)
          );
          expect((await rgbPixels(extracted)).equals(await rgbPixels(buffer))).toBe(true);
        }
      }
    });

    it("keeps brand colours exact on the displayed page", async () => {
      const [first, second] = await rasterise(pdfs.get("4:5")!, "colours");
      const { width, height } = DIMENSIONS["4:5"];
      const at = async (png: Buffer, x: number, y: number) => {
        const px = await rgbPixels(png);
        const o = (y * width + x) * 3;
        return [px[o], px[o + 1], px[o + 2]];
      };
      expect(await at(first, width - 10, height - 10)).toEqual(hexToRgb(BRAND.accent));
      expect(await at(first, width - 10, 10)).toEqual(hexToRgb(BRAND.paper));
      expect(await at(second, width - 10, 10)).toEqual(hexToRgb(BRAND.ink));
      // The uploaded image's centre, inlined by the renderer.
      expect(await at(second, 80 + 200, 80 + 200)).toEqual([241, 196, 15]);
    });
  });
});
