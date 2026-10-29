"use client";

import { useCallback, useEffect, useState } from "react";
import type { Brand } from "@/types/brand";
import {
  chooseSelectedBrandId,
  readStoredBrandId,
  storeBrandId,
} from "@/lib/brand-selection";

interface BrandsResponse {
  brands: Brand[];
  defaultBrandId: string;
}

const browserStorage = () => (typeof window === "undefined" ? undefined : window.localStorage);

/** Loads the brands and tracks the dashboard's selected brand (a view preference only). */
export function useBrandSelection() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [defaultBrandId, setDefaultBrandId] = useState<string | null>(null);
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (preferBrandId?: string) => {
    try {
      const res = await fetch("/api/brands");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { error?: string }).error || `Request failed with status ${res.status}.`);
      }
      const data = body as BrandsResponse;
      setBrands(data.brands);
      setDefaultBrandId(data.defaultBrandId);
      const chosen = chooseSelectedBrandId(
        data.brands,
        preferBrandId ?? readStoredBrandId(browserStorage()),
        data.defaultBrandId
      );
      setSelectedBrandId(chosen);
      storeBrandId(browserStorage(), chosen);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your brands.");
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const select = useCallback((brandId: string) => {
    setSelectedBrandId(brandId);
    storeBrandId(browserStorage(), brandId);
  }, []);

  const selectedBrand = brands.find((b) => b.id === selectedBrandId) ?? null;

  return { brands, defaultBrandId, selectedBrandId, selectedBrand, select, reload, error };
}
