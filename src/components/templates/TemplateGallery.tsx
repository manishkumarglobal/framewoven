"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Bookmark } from "lucide-react";
import { TemplateCard } from "./TemplateCard";
import type { Template } from "@/types/template";

interface TemplateGalleryProps {
  /** Shows only this brand's templates; using one creates a carousel in that brand. */
  brandId: string | null;
}

export function TemplateGallery({ brandId }: TemplateGalleryProps) {
  const router = useRouter();
  // Tagged with the brand it was fetched for, so a list never shows under another brand.
  const [loaded, setLoaded] = useState<{ brandId: string; templates: Template[] } | null>(null);
  const loading = !brandId || loaded?.brandId !== brandId;
  const templates = loaded?.templates ?? [];

  useEffect(() => {
    if (!brandId) return;
    let current = true;
    fetch(`/api/templates?brandId=${encodeURIComponent(brandId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (current) setLoaded({ brandId, templates: data.templates || [] });
      })
      .catch(() => {
        if (current) setLoaded({ brandId, templates: [] });
      });
    return () => {
      current = false;
    };
  }, [brandId]);

  const handleUse = useCallback(
    async (templateId: string) => {
      const res = await fetch(`/api/templates/${templateId}/use`, {
        method: "POST",
      });
      if (res.ok) {
        const carousel = await res.json();
        router.push(`/carousel/${carousel.id}`);
      }
    },
    [router]
  );

  const handleDelete = useCallback(async (templateId: string) => {
    const res = await fetch(`/api/templates/${templateId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setLoaded((prev) => prev && { ...prev, templates: prev.templates.filter((t) => t.id !== templateId) });
    }
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2].map((i) => (
          <div key={i} className="h-48 rounded-xl bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className="text-center py-12">
        <Bookmark className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">No templates for this brand yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Save a carousel as a template to reuse it later
        </p>
      </div>
    );
  }

  return (
    <div className="oc-stagger grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {templates.map((template) => (
        <TemplateCard
          key={template.id}
          template={template}
          onUse={handleUse}
          onDelete={handleDelete}
        />
      ))}
    </div>
  );
}
