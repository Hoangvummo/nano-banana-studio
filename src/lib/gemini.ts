import type { GenerationOptions, GeneratedImage, ListedModel } from "../types";
import { splitDataUrl } from "./image";
import { buildReferenceInstruction } from "./prompt";

const API_ROOT = "https://generativelanguage.googleapis.com/v1beta";

export async function listModels(apiKey: string): Promise<ListedModel[]> {
  const response = await fetch(`${API_ROOT}/models?key=${encodeURIComponent(apiKey)}`);
  const json = await response.json();

  if (!response.ok) {
    throw new Error(json?.error?.message ?? "Could not validate API key.");
  }

  return json.models ?? [];
}

export async function generateImage(options: GenerationOptions): Promise<GeneratedImage[]> {
  const results: GeneratedImage[] = [];

  for (let index = 0; index < options.count; index += 1) {
    const parts: Array<{ inlineData: { data: string; mimeType: string } } | { text: string }> = options.references.map((reference) => {
      const { data, mimeType } = splitDataUrl(reference.dataUrl);
      return { inlineData: { data, mimeType } };
    });

    parts.push({
      text: buildReferenceInstruction(options.prompt, options.references.length),
    });

    const body = {
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 1,
        topP: 0.95,
        maxOutputTokens: 32768,
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          aspectRatio: options.aspectRatio,
          imageSize: options.imageSize,
        },
      },
    };

    const response = await fetch(
      `${API_ROOT}/models/${options.model}:generateContent?key=${encodeURIComponent(options.apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    const json = await response.json();
    if (!response.ok) {
      throw new Error(json?.error?.message ?? `Generation failed with status ${response.status}.`);
    }

    const candidate = json.candidates?.[0];
    if (candidate?.finishReason === "SAFETY") {
      throw new Error("The image was blocked by the safety filter. Try a different prompt or reference.");
    }

    const imagePart = candidate?.content?.parts?.find((part: any) => part.inlineData?.data);
    if (!imagePart) {
      const text = candidate?.content?.parts?.map((part: any) => part.text).filter(Boolean).join(" ");
      throw new Error(text || "The model did not return image data.");
    }

    const mimeType = imagePart.inlineData.mimeType ?? "image/png";
    results.push({
      id: crypto.randomUUID(),
      url: `data:${mimeType};base64,${imagePart.inlineData.data}`,
      mimeType,
      prompt: options.prompt,
      model: options.model,
      createdAt: Date.now(),
    });
  }

  return results;
}
