import { describe, it, expect } from "vitest";
import {
  SELECTED_BRAND_KEY,
  chooseSelectedBrandId,
  readStoredBrandId,
  storeBrandId,
} from "@/lib/brand-selection";
import { brandIdOf } from "@/lib/brand-ownership";
import { brandIdOf as serverBrandIdOf } from "@/lib/brand";
import { brandSaveTarget } from "@/lib/brand-save-target";

const brands = [{ id: "aurora" }, { id: "north" }];

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    values,
  };
}

const throwingStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

describe("dashboard brand selection", () => {
  it("keeps the remembered brand while it exists", () => {
    expect(chooseSelectedBrandId(brands, "north", "aurora")).toBe("north");
  });

  it("falls back to the default brand when nothing is remembered or the brand is gone", () => {
    expect(chooseSelectedBrandId(brands, null, "aurora")).toBe("aurora");
    expect(chooseSelectedBrandId(brands, "deleted-brand", "aurora")).toBe("aurora");
  });

  it("remembers the choice in this browser only", () => {
    const storage = memoryStorage();
    storeBrandId(storage, "north");
    expect(storage.values.get(SELECTED_BRAND_KEY)).toBe("north");
    expect(readStoredBrandId(storage)).toBe("north");
  });

  it("treats unavailable storage as no preference instead of failing", () => {
    expect(readStoredBrandId(throwingStorage)).toBeNull();
    expect(() => storeBrandId(throwingStorage, "north")).not.toThrow();
    expect(readStoredBrandId(undefined)).toBeNull();
  });
});

describe("brand ownership in the browser", () => {
  it("resolves exactly as the server does", () => {
    expect(serverBrandIdOf).toBe(brandIdOf);
    expect(brandIdOf({ brandId: "north" }, "aurora")).toBe("north");
    expect(brandIdOf({}, "aurora")).toBe("aurora");
  });
});

describe("brand settings save target", () => {
  it("edits the named brand only", () => {
    expect(brandSaveTarget("edit", "north")).toEqual({ url: "/api/brands/north", method: "PUT" });
  });

  it("refuses to save an edit with no brand instead of overwriting the default brand", () => {
    expect(brandSaveTarget("edit", undefined)).toBeNull();
  });

  it("creates through the brands collection and keeps first-run setup on the default brand", () => {
    expect(brandSaveTarget("create", "north")).toEqual({ url: "/api/brands", method: "POST" });
    expect(brandSaveTarget("setup", undefined)).toEqual({ url: "/api/brand", method: "PUT" });
  });
});
