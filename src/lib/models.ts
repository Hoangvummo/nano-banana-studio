import type { AspectRatio, ImageSize, ModelId, StudioModel } from "../types";

export const STUDIO_MODELS: StudioModel[] = [
  {
    id: "gemini-3.1-flash-image",
    label: "Nano Banana 2",
    description: "Default high-speed model for fast generation and multi-ref edits.",
    badge: "Fast • 4K",
  },
  {
    id: "gemini-3-pro-image",
    label: "Nano Banana Pro",
    description: "Deep thinking image model for complex visual references & studio fidelity.",
    badge: "Pro Reasoning",
  },
  {
    id: "gemini-2.5-flash-image",
    label: "Nano Banana",
    description: "Previous generation lightweight fast image model.",
    badge: "Legacy",
  },
];

export const MODEL_API_CANDIDATES: Record<ModelId, string[]> = {
  "gemini-3.1-flash-image": [
    "gemini-3.1-flash-image",
    "gemini-3.1-flash-image-preview",
  ],
  "gemini-3-pro-image": [
    "gemini-3-pro-image",
    "gemini-3-pro-image-preview",
  ],
  "gemini-2.5-flash-image": [
    "gemini-2.5-flash-image",
    "gemini-2.5-flash-image-preview",
  ],
};

export const ASPECT_RATIOS: AspectRatio[] = ["auto", "1:1", "3:4", "4:3", "9:16", "16:9"];
export const IMAGE_SIZES: ImageSize[] = ["1K", "2K", "4K"];

export const DEFAULT_MODEL: ModelId = "gemini-3.1-flash-image";

export function modelLabel(model: ModelId) {
  return STUDIO_MODELS.find((item) => item.id === model)?.label ?? model;
}

export function getModelCandidates(model: ModelId): string[] {
  return MODEL_API_CANDIDATES[model] ?? [model];
}
