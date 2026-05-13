import type { AspectRatio, ImageSize, ModelId, StudioModel } from "../types";

export const STUDIO_MODELS: StudioModel[] = [
  {
    id: "gemini-3.1-flash-image-preview",
    label: "Nano Banana 2",
    description: "Default image model for fast generation and edits.",
  },
  {
    id: "gemini-3-pro-image-preview",
    label: "Nano Banana Pro",
    description: "Higher reasoning image model for complex references.",
  },
  {
    id: "nano-banana-pro-preview",
    label: "Nano Banana Pro Alias",
    description: "Alternate model id exposed by some keys.",
  },
  {
    id: "gemini-2.5-flash-image",
    label: "Nano Banana",
    description: "Previous generation fast image model.",
  },
];

export const ASPECT_RATIOS: AspectRatio[] = ["1:1", "3:4", "4:3", "9:16", "16:9"];
export const IMAGE_SIZES: ImageSize[] = ["1K", "2K", "4K"];

export const DEFAULT_MODEL: ModelId = "gemini-3.1-flash-image-preview";

export function modelLabel(model: ModelId) {
  return STUDIO_MODELS.find((item) => item.id === model)?.label ?? model;
}
