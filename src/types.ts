export type ModelId =
  | "gemini-nano-banana-2.1"
  | "gemini-3.1-flash-image"
  | "gemini-3.1-flash-lite-image"
  | "gemini-3-pro-image"
  | "gemini-2.5-flash-image";

export type AspectRatio = "auto" | "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
export type ImageSize = "1K" | "2K" | "4K";

export interface StudioModel {
  id: ModelId;
  label: string;
  shortLabel: string;
  apiName: string;
  description: string;
  badge?: string;
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
  aspectRatio?: AspectRatio;
  imageSize?: ImageSize;
  featureId?: string;
  jobId?: string;
  referenceThumbnails?: string[];
}

export interface GenerationOptions {
  apiKey: string;
  // Optional Vertex project id. When set, Vertex keys go straight to
  // the global project endpoint in one call; when unset, gemini.ts
  // uses a cached discovered project, or the Express endpoint first.
  vertexProjectId?: string;
  model: ModelId;
  prompt: string;
  references: ReferenceImage[];
  aspectRatio: AspectRatio;
  imageSize: ImageSize;
  count: number;
  signal?: AbortSignal;
  onStatus?: (message: string) => void;
}

export interface ListedModel {
  name: string;
  displayName?: string;
  description?: string;
  supportedGenerationMethods?: string[];
}
