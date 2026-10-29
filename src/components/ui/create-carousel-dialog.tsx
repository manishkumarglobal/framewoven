"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Layers, X } from "lucide-react";
import { Button } from "./button";
import { Input } from "./input";
import { AspectRatioSelector } from "@/components/editor/AspectRatioSelector";
import type { AspectRatio } from "@/types/carousel";
import type { Brand } from "@/types/brand";

interface CreateCarouselDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string, aspectRatio: AspectRatio, brandId: string) => void;
  brands: Brand[];
  /** Preselected: the brand the dashboard is showing. */
  selectedBrandId: string | null;
}

export function CreateCarouselDialog({
  open,
  onOpenChange,
  onCreate,
  brands,
  selectedBrandId,
}: CreateCarouselDialogProps) {
  const [name, setName] = useState("");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("4:5");
  // Until the user picks one, the brand follows the dashboard's selection.
  const [brandChoice, setBrandChoice] = useState<string | null>(null);
  const brandId = brandChoice ?? selectedBrandId ?? "";

  const handleOpenChange = (next: boolean) => {
    if (!next) setBrandChoice(null);
    onOpenChange(next);
  };

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed || !brandId) return;
    onCreate(trimmed, aspectRatio, brandId);
    setName("");
    setAspectRatio("4:5");
    handleOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay data-oc-overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content data-oc-dialog className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-surface border border-border p-6 shadow-2xl">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-lg bg-accent/10 flex items-center justify-center">
                <Layers className="h-4 w-4 text-accent" />
              </div>
              <Dialog.Title className="text-base font-semibold">
                New Carousel
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button
                className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Carousel Name
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., 5 Tips for Remote Work"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
              />
            </div>

            <div>
              <label htmlFor="new-carousel-brand" className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Brand
              </label>
              <select
                id="new-carousel-brand"
                value={brandId}
                onChange={(e) => setBrandChoice(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                {brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name.trim() || "Unnamed brand"}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">
                A carousel keeps this brand for good.
              </p>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Aspect Ratio
              </label>
              <AspectRatioSelector
                value={aspectRatio}
                onChange={setAspectRatio}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-6">
            <Dialog.Close asChild>
              <Button variant="outline" size="sm">
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              variant="accent"
              size="sm"
              onClick={handleCreate}
              disabled={!name.trim() || !brandId}
            >
              Create
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
