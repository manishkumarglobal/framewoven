"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { brandIdOf } from "@/lib/brand-ownership";
import type { Brand } from "@/types/brand";

/**
 * Read-only: the brand this carousel was created in and is generated with.
 * It is shown so the owner can tell, and deliberately offers no way to change it.
 */
export function CarouselBrandBadge({ brandId }: { brandId?: string }) {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    fetch("/api/brands")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { brands: Brand[]; defaultBrandId: string } | null) => {
        if (!current || !data) return;
        const owner = data.brands.find((b) => b.id === brandIdOf({ brandId }, data.defaultBrandId));
        setName(owner ? owner.name.trim() || "Unnamed brand" : "Missing brand");
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [brandId]);

  if (name === null) return null;
  return (
    <Badge
      variant="secondary"
      className="shrink-0 max-w-[200px] truncate text-[11px]"
      title="This carousel belongs to this brand and is always designed with it."
    >
      Brand: {name}
    </Badge>
  );
}
