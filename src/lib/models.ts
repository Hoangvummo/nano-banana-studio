import type { AspectRatio, ImageSize, ModelId, StudioModel } from "../types";

export const STUDIO_MODELS: StudioModel[] = [
  {
    id: "gemini-nano-banana-2.1",
    label: "Nano Banana 2.1 (Gemini Nano Banana 2.1)",
    shortLabel: "Nano Banana 2.1",
    apiName: "gemini-nano-banana-2.1",
    description: "Bản mới nhất — nâng cấp độ nét, chữ trên ảnh & giữ đồng nhất nhân vật (1K/2K/4K).",
    badge: "Mới nhất • 4K",
  },
  {
    id: "gemini-3.1-flash-image",
    label: "Nano Banana 2 (Gemini 3.1 Flash Image)",
    shortLabel: "Nano Banana 2 (3.1 Flash)",
    apiName: "gemini-3.1-flash-image",
    description: "Tốc độ nhanh, hỗ trợ ghép nhiều ảnh tham chiếu và xuất ảnh 1K/2K/4K.",
    badge: "Nhanh • 4K",
  },
  {
    id: "gemini-3-pro-image",
    label: "Nano Banana Pro (Gemini 3 Pro Image)",
    shortLabel: "Nano Banana Pro (3 Pro)",
    apiName: "gemini-3-pro-image",
    description: "Bản Pro có suy luận sâu (Thinking) — chuyên xử lý yêu cầu phức tạp, ánh sáng & chi tiết khó (1K/2K/4K).",
    badge: "Pro Reasoning • 4K",
  },
  {
    id: "gemini-3.1-flash-lite-image",
    label: "Nano Banana 2 Lite (Gemini 3.1 Flash-Lite Image)",
    shortLabel: "Nano Banana 2 Lite (3.1 Lite)",
    apiName: "gemini-3.1-flash-lite-image",
    description: "Bản siêu tốc & tiết kiệm chi phí nhất của dòng 3.1 (chỉ hỗ trợ 1K).",
    badge: "Siêu tốc • 1K",
  },
  {
    id: "gemini-2.5-flash-image",
    label: "Nano Banana 1 (Gemini 2.5 Flash Image)",
    shortLabel: "Nano Banana 1 (2.5 Flash)",
    apiName: "gemini-2.5-flash-image",
    description: "Model thế hệ đầu tiên (Legacy), chỉ hỗ trợ độ phân giải 1K.",
    badge: "Đời cũ • 1K",
  },
];

export const ASPECT_RATIOS: AspectRatio[] = ["auto", "1:1", "3:4", "4:3", "9:16", "16:9"];
export const IMAGE_SIZES: ImageSize[] = ["1K", "2K", "4K"];

export const DEFAULT_MODEL: ModelId = "gemini-nano-banana-2.1";

export function modelLabel(model: ModelId) {
  return STUDIO_MODELS.find((item) => item.id === model)?.label ?? model;
}

export function modelShortLabel(model: ModelId) {
  return STUDIO_MODELS.find((item) => item.id === model)?.shortLabel ?? model;
}

export function is1KOnlyModel(model: ModelId): boolean {
  return model === "gemini-2.5-flash-image" || model === "gemini-3.1-flash-lite-image";
}

// Intentionally no model fallback: a generation always uses the exact
// model the user selected (its apiName), never a *-preview alias or
// another model, even if that model returns 404 / not supported.
export function selectedModelApiName(model: ModelId): string {
  return STUDIO_MODELS.find((item) => item.id === model)?.apiName ?? model;
}
