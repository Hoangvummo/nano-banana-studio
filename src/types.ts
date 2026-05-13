export type ModelId =
  | "gemini-2.5-flash-image"
  | "gemini-3.1-flash-image-preview"
  | "gemini-3-pro-image-preview"
  | "nano-banana-pro-preview";

export type AspectRatio = "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
export type ImageSize = "1K" | "2K" | "4K";

export interface StudioModel {
  id: ModelId;
  label: string;
  description: string;
}

export interface ReferenceImage {
  id: string;
  name: string;
  dataUrl: string;
  mimeType: string;
  role: "face" | "outfit" | "style" | "source" | "free";
}

export interface GeneratedImage {
  id: string;
  url: string;
  mimeType: string;
  prompt: string;
  model: ModelId;
  createdAt: number;
}

export interface GenerationOptions {
  apiKey: string;
  model: ModelId;
  prompt: string;
  references: ReferenceImage[];
  aspectRatio: AspectRatio;
  imageSize: ImageSize;
  count: number;
}

export interface ListedModel {
  name: string;
  displayName?: string;
  description?: string;
  supportedGenerationMethods?: string[];
}
