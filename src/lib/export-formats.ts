import type { AspectRatio } from "@/types/carousel";

/**
 * Export formats offered by `POST /api/carousels/[id]/export`.
 *
 * Both formats package the same rendered PNGs: `png` zips them, `pdf` places
 * each one on its own page. This module has no server dependencies so the
 * editor can import it too.
 */
export type ExportFormat = "png" | "pdf";

/** What a request without `?format=` gets. Kept as the original ZIP export. */
export const DEFAULT_EXPORT_FORMAT: ExportFormat = "png";

export interface ExportFormatOption {
  format: ExportFormat;
  platform: string;
  label: string;
  description: string;
  extension: "zip" | "pdf";
}

export const EXPORT_FORMATS: readonly ExportFormatOption[] = [
  {
    format: "png",
    platform: "Instagram",
    label: "PNG ZIP",
    description: "Download individual carousel images.",
    extension: "zip",
  },
  {
    format: "pdf",
    platform: "LinkedIn",
    label: "PDF",
    description: "Download one multi-page PDF.",
    extension: "pdf",
  },
];

/**
 * Reads the `format` query parameter. A missing or empty value is the default
 * ZIP export, so callers written before PDF existed keep their behaviour.
 * Anything unrecognised returns null rather than silently falling back.
 */
export function parseExportFormat(value: string | null): ExportFormat | null {
  if (value === null || value === "") return DEFAULT_EXPORT_FORMAT;
  return EXPORT_FORMATS.some((option) => option.format === value)
    ? (value as ExportFormat)
    : null;
}

/**
 * Advice shown next to the LinkedIn option, or null when there is none.
 *
 * LinkedIn accepts any page size, so a 9:16 carousel still exports as-is. The
 * advisory only informs; it never changes the carousel or its dimensions.
 */
export function linkedInAdvisory(aspectRatio: AspectRatio): string | null {
  if (aspectRatio === "9:16") {
    return "9:16 pages export as-is. 4:5 generally displays better in LinkedIn's feed.";
  }
  return null;
}

/**
 * The filename from a `Content-Disposition: attachment; filename="..."` header,
 * or null when there is none. Path separators are dropped so the value can only
 * ever name a file, not a location.
 */
export function filenameFromDisposition(header: string | null): string | null {
  const match = header?.match(/filename="([^"]+)"/);
  if (!match) return null;
  const name = match[1].replace(/[\\/]/g, "_").trim();
  return name || null;
}
