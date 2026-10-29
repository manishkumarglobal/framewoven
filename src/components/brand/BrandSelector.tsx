"use client";

import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Brand } from "@/types/brand";

interface BrandSelectorProps {
  brands: Brand[];
  selectedBrandId: string | null;
  onSelect: (brandId: string) => void;
  onEdit: () => void;
  onAdd: () => void;
}

/** Chooses which brand the dashboard shows. Existing carousels are never changed by it. */
export function BrandSelector({ brands, selectedBrandId, onSelect, onEdit, onAdd }: BrandSelectorProps) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="brand-selector" className="text-xs font-medium text-muted-foreground">
        Brand
      </label>
      <select
        id="brand-selector"
        value={selectedBrandId ?? ""}
        onChange={(e) => onSelect(e.target.value)}
        disabled={brands.length === 0}
        className="h-8 max-w-[220px] rounded-lg border border-border bg-surface px-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-accent/40"
      >
        {brands.map((brand) => (
          <option key={brand.id} value={brand.id}>
            {brand.name.trim() || "Unnamed brand"}
          </option>
        ))}
      </select>
      <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Edit brand settings" title="Edit brand settings" disabled={!selectedBrandId}>
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button variant="outline" size="sm" onClick={onAdd}>
        <Plus className="h-3.5 w-3.5" />
        Add brand
      </Button>
    </div>
  );
}
