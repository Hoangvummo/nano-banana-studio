import { GoogleGenAI, HarmBlockThreshold, HarmCategory, ThinkingLevel } from "@google/genai";
import type { Content, GenerateContentConfig, Part } from "@google/genai";
import type { GenerationOptions, GeneratedImage, ListedModel } from "../types";
import { splitDataUrl } from "./image";
import { STUDIO_MODELS } from "./models";
import { buildReferenceInstruction } from "./prompt";

const IMAGE_MIME_TYPE = "image/png";

const safetySettings: GenerateContentConfig["safetySettings"] = [
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.OFF,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.OFF,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.OFF,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.OFF,
  },
];

export async function listModels(apiKey: string): Promise<ListedModel[]> {
  if (!apiKey.trim()) throw new Error("Enter an API key first.");

  return STUDIO_MODELS.map((model) => ({
    name: `models/${model.id}`,
    displayName: model.label,
    description: model.description,
    supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
  }));
}

export async function generateImage(options: GenerationOptions): Promise<GeneratedImage[]> {
  const ai = new GoogleGenAI({ apiKey: options.apiKey, vertexai: true });
  const results: GeneratedImage[] = [];

  for (let index = 0; index < options.count; index += 1) {
    const contents: Content[] = [
      {
        role: "user",
        parts: buildParts(options),
      },
    ];

    let responseText = "";
    let imageData = "";
    let mimeType = IMAGE_MIME_TYPE;
    let finishReason = "";

    try {
      const stream = await ai.models.generateContentStream({
        model: options.model,
        contents,
        config: {
          maxOutputTokens: 32768,
          temperature: 1,
          topP: 0.95,
          responseModalities: ["TEXT", "IMAGE"],
          ...buildThinkingConfig(options),
          imageConfig: buildImageConfig(options),
          safetySettings,
        },
      });

      for await (const chunk of stream) {
        responseText += chunk.text ?? "";
        finishReason = chunk.candidates?.[0]?.finishReason ?? finishReason;

        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          if (part.inlineData?.data) {
            imageData += part.inlineData.data;
            mimeType = part.inlineData.mimeType ?? mimeType;
          }
        }

        if (!imageData && chunk.data) imageData += chunk.data;
      }
    } catch (err) {
      throw new Error(readGenerationError(err));
    }

    if (finishReason === "SAFETY") {
      throw new Error("The image was blocked by the safety filter. Try a different prompt or reference.");
    }

    if (!imageData) {
      throw new Error(responseText.trim() || "The model did not return image data.");
    }

    results.push({
      id: crypto.randomUUID(),
      url: `data:${mimeType};base64,${imageData}`,
      mimeType,
      prompt: options.prompt,
      model: options.model,
      createdAt: Date.now(),
    });
  }

  return results;
}

function buildParts(options: GenerationOptions): Part[] {
  const parts: Part[] = options.references.map((reference) => {
    const { data, mimeType } = splitDataUrl(reference.dataUrl);
    return { inlineData: { data, mimeType } };
  });

  parts.push({
    text: buildReferenceInstruction(options.prompt, options.references.length),
  });

  return parts;
}

function buildImageConfig(options: GenerationOptions): NonNullable<GenerateContentConfig["imageConfig"]> {
  return {
    ...(options.aspectRatio === "auto" && options.model === "gemini-3-pro-image-preview"
      ? {}
      : { aspectRatio: options.aspectRatio }),
    imageSize: options.imageSize,
    outputMimeType: IMAGE_MIME_TYPE,
    personGeneration: "ALLOW_ALL",
  };
}

function buildThinkingConfig(options: GenerationOptions): Pick<GenerateContentConfig, "thinkingConfig"> {
  if (options.model === "gemini-3-pro-image-preview") return {};

  return {
    thinkingConfig: {
      thinkingLevel: ThinkingLevel.MINIMAL,
    },
  };
}

function readGenerationError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);

  try {
    const parsed = JSON.parse(message);
    return parsed?.error?.message ?? parsed?.message ?? message;
  } catch {
    return message;
  }
}
