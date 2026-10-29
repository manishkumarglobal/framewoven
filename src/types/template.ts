import type { AspectRatio, Slide } from "./carousel";

export interface Template {
  id: string;
  name: string;
  description: string;
  aspectRatio: AspectRatio;
  slides: Omit<Slide, "previousVersions">[];
  tags: string[];
  /** The brand of the carousel it was saved from; none means the default brand. */
  brandId?: string;
  createdAt: string;
}

export interface TemplatesData {
  templates: Template[];
}
