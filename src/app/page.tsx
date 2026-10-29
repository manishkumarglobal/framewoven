"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, Layers, AlertTriangle } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CreateCarouselDialog } from "@/components/ui/create-carousel-dialog";
import { BrandSetup, type BrandSetupMode } from "@/components/brand/BrandSetup";
import { BrandSelector } from "@/components/brand/BrandSelector";
import { useBrandSelection } from "@/components/brand/useBrandSelection";
import { CarouselCard } from "@/components/dashboard/CarouselCard";
import { TemplateGallery } from "@/components/templates/TemplateGallery";
import type { Carousel } from "@/types/carousel";

export default function DashboardPage() {
  const router = useRouter();
  const { brands, defaultBrandId, selectedBrandId, selectedBrand, select, reload, error: brandError } =
    useBrandSelection();
  const [chosenDialog, setChosenDialog] = useState<BrandSetupMode | null>(null);
  const [setupDismissed, setSetupDismissed] = useState(false);
  // First run: the default brand has no name yet, so it is asked for until saved or dismissed.
  const defaultBrand = brands.find((b) => b.id === defaultBrandId);
  const needsSetup = !!defaultBrand && !defaultBrand.name.trim() && !setupDismissed;
  const brandDialog: BrandSetupMode | null = chosenDialog ?? (needsSetup ? "setup" : null);
  const setBrandDialog = (mode: BrandSetupMode | null) => {
    if (mode === null) setSetupDismissed(true);
    setChosenDialog(mode);
  };

  // Tagged with the brand it was fetched for: switching brands changes this
  // view, never a carousel, and a slow response can't show under another brand.
  const [list, setList] = useState<{ brandId: string; carousels: Carousel[]; error: string | null } | null>(null);
  const loading = !selectedBrandId || list?.brandId !== selectedBrandId;
  const carousels = loading ? [] : list.carousels;
  const loadError = loading ? null : list.error;

  useEffect(() => {
    if (!selectedBrandId) return;
    let current = true;
    // A failed load must not look like an empty account. If the stored data
    // cannot be read the server says why, and that reason is shown instead of
    // the "no carousels yet" empty state.
    fetch(`/api/carousels?brandId=${encodeURIComponent(selectedBrandId)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error((body as { error?: string }).error || `Request failed with status ${res.status}.`);
        }
        const loaded = (body as { carousels?: Carousel[] }).carousels || [];
        if (current) setList({ brandId: selectedBrandId, carousels: loaded, error: null });
      })
      .catch((err: unknown) => {
        const error = err instanceof Error ? err.message : "Could not load your carousels.";
        if (current) setList({ brandId: selectedBrandId, carousels: [], error });
      });
    return () => {
      current = false;
    };
  }, [selectedBrandId]);

  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    description: string;
    onConfirm: () => void;
  }>({ open: false, title: "", description: "", onConfirm: () => {} });

  const handleDelete = useCallback((e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    setConfirmState({
      open: true,
      title: `Delete "${name}"?`,
      description: "This will permanently delete the carousel and all its slides.",
      onConfirm: async () => {
        const res = await fetch(`/api/carousels/${id}`, { method: "DELETE" });
        if (res.ok) {
          setList((prev) => prev && { ...prev, carousels: prev.carousels.filter((c) => c.id !== id) });
        }
      },
    });
  }, []);

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [activeTab, setActiveTab] = useState<"carousels" | "templates">("carousels");

  const handleCreate = useCallback(async (name: string, aspectRatio: string, brandId: string) => {
    const res = await fetch("/api/carousels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        aspectRatio,
        brandId,
      }),
    });
    if (res.ok) {
      const carousel = await res.json();
      router.push(`/carousel/${carousel.id}`);
    }
  }, [router]);

  return (
    <div className="h-full flex flex-col">
      {/* Brand settings open only once a brand is selected, so an edit always has a brand to save to. */}
      <TopBar onSettingsClick={selectedBrandId ? () => setBrandDialog("edit") : undefined} />

      <ConfirmDialog
        open={confirmState.open}
        onOpenChange={(open) => setConfirmState((s) => ({ ...s, open }))}
        title={confirmState.title}
        description={confirmState.description}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmState.onConfirm}
      />

      <CreateCarouselDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreate={handleCreate}
        brands={brands}
        selectedBrandId={selectedBrandId}
      />

      <BrandSetup
        open={brandDialog !== null}
        mode={brandDialog ?? "edit"}
        brandId={brandDialog === "setup" ? defaultBrandId ?? undefined : selectedBrandId ?? undefined}
        initialBrand={
          brandDialog === "create"
            ? undefined
            : (brandDialog === "setup" ? brands.find((b) => b.id === defaultBrandId) : selectedBrand) ?? undefined
        }
        onComplete={(saved) => {
          const created = brandDialog === "create";
          setBrandDialog(null);
          // A new brand becomes the selected one, so its empty dashboard is shown next.
          if (saved) reload(created ? saved.id : undefined);
        }}
      />

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold">Framewoven</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Create Instagram carousels with AI
              </p>
            </div>
            <Button onClick={() => setShowCreateDialog(true)} variant="accent">
              <Plus className="h-4 w-4" />
              New Carousel
            </Button>
          </div>

          {/* Tabs */}
          <div className="flex flex-wrap items-end justify-between gap-3 mb-6 border-b border-border">
            <div className="flex gap-1">
              <button
                onClick={() => setActiveTab("carousels")}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === "carousels"
                    ? "border-accent text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                My Carousels
              </button>
              <button
                onClick={() => setActiveTab("templates")}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === "templates"
                    ? "border-accent text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                Templates
              </button>
            </div>
            <div className="pb-2">
              <BrandSelector
                brands={brands}
                selectedBrandId={selectedBrandId}
                onSelect={select}
                onEdit={() => setBrandDialog("edit")}
                onAdd={() => setBrandDialog("create")}
              />
            </div>
          </div>

          {/* A brand load failure blocks both tabs, so it is shown on either. */}
          {activeTab === "templates" && !brandError ? (
            <TemplateGallery brandId={selectedBrandId} />
          ) : loadError || brandError ? (
            <div
              role="alert"
              className="rounded-xl border border-destructive/30 bg-destructive/5 p-6"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-destructive">
                    {brandError ? "Couldn\u2019t load your brands" : "Couldn\u2019t load your carousels"}
                  </h2>
                  <p className="text-xs text-muted-foreground mt-1 break-words">
                    {loadError || brandError}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    Nothing was deleted. Your data files were left as they are.
                  </p>
                </div>
              </div>
            </div>
          ) : loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-48 rounded-xl bg-muted animate-pulse"
                />
              ))}
            </div>
          ) : carousels.length === 0 ? (
            <div className="text-center py-20">
              <Layers className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h2 className="text-lg font-semibold mb-2">
                No carousels for {selectedBrand?.name.trim() || "this brand"} yet
              </h2>
              <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
                Create your first Instagram carousel. Our AI assistant will
                help you design beautiful slides in seconds.
              </p>
              <Button onClick={() => setShowCreateDialog(true)} variant="accent" size="lg">
                <Plus className="h-5 w-5" />
                Create Your First Carousel
              </Button>
            </div>
          ) : (
            <div className="oc-stagger grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {carousels.map((carousel) => (
                <CarouselCard
                  key={carousel.id}
                  carousel={carousel}
                  onOpen={() => router.push(`/carousel/${carousel.id}`)}
                  onDuplicated={(copy) => setList((prev) => prev && { ...prev, carousels: [copy, ...prev.carousels] })}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
