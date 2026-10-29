import { readDataSafe, mutateData } from "./data";
import { generateId, now } from "./utils";
import { brandIdOf } from "./brand-ownership";
import type { Brand, BrandConfig, BrandsData } from "@/types/brand";
import { DEFAULT_BRAND } from "@/types/brand";
import type { Carousel } from "@/types/carousel";

const FILE = "brands.json";

/**
 * The single brand file written before multiple brands existed. It is read
 * once, to create brands.json, and is never written again: it stays on disk
 * as the backup of the original brand.
 */
const LEGACY_FILE = "brand.json";

/**
 * The migrated default brand's id. Fixed rather than random so that if
 * brands.json is ever lost and recreated from brand.json, carousels stamped
 * with the default brand still resolve to it instead of becoming orphans.
 */
export const DEFAULT_BRAND_ID = "default";

/** Fields a caller may set on a brand. `id` and the timestamps are server-owned. */
export type BrandUpdate = Partial<Omit<BrandConfig, "createdAt" | "updatedAt">>;

const defaultBrand = (): BrandConfig => ({
  ...DEFAULT_BRAND,
  colors: { ...DEFAULT_BRAND.colors },
  fonts: { ...DEFAULT_BRAND.fonts },
  customFonts: [...DEFAULT_BRAND.customFonts],
  styleKeywords: [...DEFAULT_BRAND.styleKeywords],
});

/** A carousel or request names a brand that does not exist. */
export class BrandNotFoundError extends Error {
  readonly brandId: string;

  constructor(brandId: string) {
    super(`Brand not found: ${brandId}`);
    this.name = "BrandNotFoundError";
    this.brandId = brandId;
  }
}

/**
 * Reads brands.json, creating it on first use.
 *
 * Creation copies brand.json as it is into the default brand record, with a
 * new stable id, so the original brand reaches the design agent exactly as it
 * did before. It happens only while brands.json is absent, under that file's
 * lock, so concurrent first requests create one record and later calls change
 * nothing. A brand.json that does not parse rejects with DataFileCorruptError
 * and brands.json is not created.
 */
async function load(): Promise<BrandsData> {
  const existing = await readDataSafe<BrandsData | null>(FILE, null);
  if (existing) return existing;

  // Read outside the lock: nothing writes brand.json any more.
  const legacy = await readDataSafe<BrandConfig>(LEGACY_FILE, defaultBrand());
  return mutateData<BrandsData, BrandsData>(
    FILE,
    () => {
      return { defaultBrandId: DEFAULT_BRAND_ID, brands: [{ id: DEFAULT_BRAND_ID, ...legacy }] };
    },
    (data) => data
  );
}

/** Every change to brands.json goes through here, under the file's lock. */
async function mutate<R>(fn: (data: BrandsData) => R): Promise<R> {
  await load();
  return mutateData<BrandsData, R>(
    FILE,
    () => {
      throw new Error(`${FILE} disappeared while it was being updated`);
    },
    fn
  );
}

function applyUpdate(brand: Brand, updates: BrandUpdate): void {
  // Mutated in place so the object the lock persists is the object returned.
  Object.assign(brand, updates, {
    colors: { ...brand.colors, ...updates.colors },
    fonts: { ...brand.fonts, ...updates.fonts },
    createdAt: brand.createdAt || now(),
    updatedAt: now(),
  });
}

export async function listBrands(): Promise<BrandsData> {
  return load();
}

export async function getBrandById(id: string): Promise<Brand | null> {
  const data = await load();
  return data.brands.find((b) => b.id === id) ?? null;
}

export async function getDefaultBrandId(): Promise<string> {
  return (await load()).defaultBrandId;
}

/** The default brand: the original brand, for installations that had one. */
export async function getBrand(): Promise<Brand> {
  const data = await load();
  const brand = data.brands.find((b) => b.id === data.defaultBrandId);
  if (!brand) throw new BrandNotFoundError(data.defaultBrandId);
  return brand;
}

/** Updates the default brand. */
export async function updateBrand(updates: BrandUpdate): Promise<Brand> {
  return mutate((data) => {
    const brand = data.brands.find((b) => b.id === data.defaultBrandId);
    if (!brand) throw new BrandNotFoundError(data.defaultBrandId);
    applyUpdate(brand, updates);
    return brand;
  });
}

export async function updateBrandById(
  id: string,
  updates: BrandUpdate
): Promise<Brand | null> {
  return mutate((data) => {
    const brand = data.brands.find((b) => b.id === id);
    if (!brand) return null;
    applyUpdate(brand, updates);
    return brand;
  });
}

export async function createBrand(updates: BrandUpdate): Promise<Brand> {
  return mutate((data) => {
    const brand: Brand = { id: generateId(), ...defaultBrand() };
    applyUpdate(brand, updates);
    brand.createdAt = brand.updatedAt;
    data.brands.push(brand);
    return brand;
  });
}

/** The brand a carousel or template belongs to; none means the default brand. */
export { brandIdOf };

/**
 * The brand the design agent works with for a carousel: the one it was created
 * in, or the default brand for carousels made before brands existed and for a
 * chat without a carousel.
 */
export async function resolveBrandForCarousel(
  carousel: Pick<Carousel, "brandId"> | null
): Promise<Brand> {
  const data = await load();
  const id = carousel ? brandIdOf(carousel, data.defaultBrandId) : data.defaultBrandId;
  const brand = data.brands.find((b) => b.id === id);
  if (!brand) throw new BrandNotFoundError(id);
  return brand;
}

export function isBrandConfigured(brand: BrandConfig): boolean {
  return brand.name.trim().length > 0;
}
