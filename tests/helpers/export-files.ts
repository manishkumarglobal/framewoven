import { inflateRawSync, inflateSync } from "node:zlib";
import sharp from "sharp";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";

/** A solid-colour PNG with a distinct block in one corner, at an exact size. */
export async function syntheticSlidePng(
  width: number,
  height: number,
  background: { r: number; g: number; b: number },
  marker: { r: number; g: number; b: number } = { r: 255, g: 255, b: 255 }
): Promise<Buffer> {
  const block = await sharp({
    create: { width: 120, height: 80, channels: 3, background: marker },
  })
    .png()
    .toBuffer();
  return sharp({ create: { width, height, channels: 3, background } })
    .composite([{ input: block, left: 40, top: 40 }])
    .png()
    .toBuffer();
}

/**
 * A PNG whose every pixel differs from its neighbours, standing in for text
 * edges, gradients and photographs. Deterministic for a given seed.
 */
export async function detailedSlidePng(
  width: number,
  height: number,
  seed: number
): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3);
  let state = seed >>> 0 || 1;
  for (let i = 0; i < pixels.length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    pixels[i] = state & 0xff;
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

/** Decodes a PNG to tightly packed 8-bit RGB. */
export async function rgbPixels(png: Buffer): Promise<Buffer> {
  return sharp(png).removeAlpha().toColourspace("srgb").raw().toBuffer();
}

export interface PdfPageContents {
  /** MediaBox width and height, in points. */
  width: number;
  height: number;
  /** MediaBox lower-left corner, CropBox and /Rotate, which also decide what a reader shows. */
  mediaBoxOrigin: { x: number; y: number };
  cropBox: { x: number; y: number; width: number; height: number };
  rotation: number;
  /** The decoded page content stream, e.g. `q 810 0 0 1012.5 0 0 cm /Image-1 Do Q`. */
  operators: string;
  images: {
    width: number;
    height: number;
    colorSpace: string;
    bitsPerComponent: number;
    hasSoftMask: boolean;
    /** Decoded samples: 8-bit RGB, row-major, top row first. */
    pixels: Buffer;
  }[];
}

/**
 * Reads a PDF back with pdf-lib and returns each page's geometry, drawing
 * operators and the exact pixels of the images it draws.
 */
export async function readPdfPages(bytes: Uint8Array): Promise<PdfPageContents[]> {
  const doc = await PDFDocument.load(bytes);

  return doc.getPages().map((page) => {
    const { x, y, width, height } = page.getMediaBox();

    const contents = page.node.Contents();
    const streams =
      contents instanceof PDFArray
        ? contents.asArray().map((ref) => doc.context.lookup(ref))
        : [contents];
    const operators = streams
      .filter((s): s is PDFRawStream => s instanceof PDFRawStream)
      .map((s) => Buffer.from(decodePDFRawStream(s).decode()).toString("latin1"))
      .join("\n");

    const xObjects = page.node
      .Resources()
      ?.lookupMaybe(PDFName.of("XObject"), PDFDict);
    const images = (xObjects?.entries() ?? []).map(([, ref]) => {
      const stream = doc.context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) {
        throw new Error("Page XObject is not a stream");
      }
      const dict = stream.dict;
      const num = (key: string) =>
        dict.lookup(PDFName.of(key), PDFNumber).asNumber();
      return {
        width: num("Width"),
        height: num("Height"),
        colorSpace: String(dict.lookup(PDFName.of("ColorSpace"))),
        bitsPerComponent: num("BitsPerComponent"),
        hasSoftMask: dict.has(PDFName.of("SMask")),
        pixels: inflateSync(Buffer.from(stream.contents)),
      };
    });

    return {
      width,
      height,
      mediaBoxOrigin: { x, y },
      cropBox: page.getCropBox(),
      rotation: page.getRotation().angle,
      operators,
      images,
    };
  });
}

/**
 * The transformation in effect when the page's image is painted: every `cm`
 * before `Do`, multiplied in order, as [a b c d e f]. An image drawn edge to
 * edge on a W x H page gives [W 0 0 H 0 0]: scaled to the page, not offset,
 * rotated or skewed.
 */
export function imageTransform(operators: string): number[] {
  let ctm = [1, 0, 0, 1, 0, 0];
  const lines = operators.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (line.endsWith(" Do")) return ctm;
    if (!line.endsWith(" cm")) continue;
    const [a, b, c, d, e, f] = line.split(/\s+/).slice(0, 6).map(Number);
    const [A, B, C, D, E, F] = ctm;
    ctm = [
      a * A + b * C,
      a * B + b * D,
      c * A + d * C,
      c * B + d * D,
      e * A + f * C + E,
      e * B + f * D + F,
    ];
  }
  throw new Error("The page paints no image");
}

/**
 * Lists a ZIP's entries in archive order by reading its central directory.
 * Enough for the stored and deflated entries archiver writes.
 */
export function readZipEntries(zip: Buffer): { name: string; data: Buffer }[] {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("Not a ZIP file: no end of central directory");
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);

  const entries: { name: string; data: Buffer }[] = [];
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Corrupt ZIP central directory");
    }
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.toString("utf8", offset + 46, offset + 46 + nameLength);

    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = zip.subarray(start, start + compressedSize);
    const data = method === 0 ? Buffer.from(raw) : inflateRawSync(raw);

    entries.push({ name, data });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
