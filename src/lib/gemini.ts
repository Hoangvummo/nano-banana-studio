import { GoogleGenAI, HarmBlockThreshold, HarmCategory, ThinkingLevel } from "@google/genai";
import type { Content, GenerateContentConfig, Part } from "@google/genai";
import type { GenerationOptions, GeneratedImage, ListedModel } from "../types";
import { splitDataUrl } from "./image";
import { STUDIO_MODELS, is1KOnlyModel, selectedModelApiName } from "./models";
import { buildReferenceInstruction } from "./prompt";

const IMAGE_MIME_TYPE = "image/png";
// Retry delay for rate-limit / transient errors. There is intentionally
// no max-attempt cap for those errors: the wait backs off exponentially
// up to this ceiling and then keeps retrying until it succeeds or the
// user cancels (the delay is abortable). Non-retryable errors below
// still fail immediately.
const BASE_RETRY_DELAY_MS = 1800;
const MAX_RETRY_DELAY_MS = 60_000;

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

  const ai = createClient(apiKey);

  try {
    if (isVertexExpressKey(apiKey)) {
      return STUDIO_MODELS.map((model) => ({
        name: `models/${model.id}`,
        displayName: model.label,
        description: model.description,
        supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
      }));
    }

    const pager = await ai.models.list({ config: { pageSize: 100 } });
    const models: ListedModel[] = [];

    for await (const model of pager) {
      if (!model.name) continue;
      models.push({
        name: model.name,
        displayName: model.displayName,
        description: model.description,
        supportedGenerationMethods: model.supportedActions,
      });
    }

    return models;
  } catch (err) {
    throw new Error(readGenerationError(err));
  }
}

export async function generateImage(options: GenerationOptions): Promise<GeneratedImage[]> {
  throwIfAborted(options.signal);

  const ai = createClient(options.apiKey);
  const isVertex = isVertexExpressKey(options.apiKey);
  const results: GeneratedImage[] = [];
  const totalCount = Math.max(1, options.count);

  for (let index = 0; index < totalCount; index += 1) {
    throwIfAborted(options.signal);

    if (totalCount > 1) {
      options.onStatus?.(`Đang tạo biến thể ${index + 1}/${totalCount}...`);
    }

    const generated = await generateSingleImageWithRetry(ai, options, isVertex);
    results.push(generated);
  }

  return results;
}

async function generateSingleImageWithRetry(
  ai: GoogleGenAI,
  options: GenerationOptions,
  isVertex: boolean,
): Promise<GeneratedImage> {
  // Exact model only: no fallback to a *-preview alias or another model.
  // If this model is not found / not supported, that error is surfaced
  // as-is instead of silently generating with a different model.
  const targetModel = selectedModelApiName(options.model);
  let attempt = 0;

  for (;;) {
    throwIfAborted(options.signal);

    let lastError: unknown = null;
    try {
      return await executeModelGeneration(ai, targetModel, options, isVertex, false);
    } catch (err) {
      if (isAbortError(err) || options.signal?.aborted) {
        throw createAbortError();
      }
      lastError = err;

      // Same model, minimal config only (imageConfig / thinking fields
      // rejected by this model). This is not a model redirect.
      if (isInvalidConfigError(readGenerationError(err))) {
        try {
          return await executeModelGeneration(ai, targetModel, options, isVertex, true);
        } catch (minimalErr) {
          if (isAbortError(minimalErr) || options.signal?.aborted) {
            throw createAbortError();
          }
          lastError = minimalErr;
        }
      }
    }

    const errMessage = readGenerationError(lastError);

    // Rate limits, quota exhaustion and transient server/network
    // errors: wait and retry the SAME model until it succeeds or the
    // user cancels. There is no attempt cap here by design.
    if (isRetryableError(errMessage)) {
      const waitMs = Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * Math.pow(2, attempt));
      const waitSeconds = (waitMs / 1000).toFixed(1);
      attempt += 1;
      options.onStatus?.(
        isRateLimitError(errMessage)
          ? `Chạm giới hạn tốc độ của model ${targetModel} — đang chờ và sẽ thử lại lần ${attempt} sau ${waitSeconds}s, vẫn giữ đúng model này (bấm Hủy để dừng)...`
          : `Máy chủ đang bận — đang chờ và sẽ thử lại lần ${attempt} sau ${waitSeconds}s, vẫn giữ đúng model ${targetModel} (bấm Hủy để dừng)...`,
      );
      await abortableDelay(waitMs, options.signal);
      continue;
    }

    throw new Error(errMessage);
  }
}

async function executeModelGeneration(
  ai: GoogleGenAI,
  targetModel: string,
  options: GenerationOptions,
  isVertex: boolean,
  minimalConfig: boolean,
): Promise<GeneratedImage> {
  const contents: Content[] = [
    {
      role: "user",
      parts: buildParts(options),
    },
  ];

  const isProModel = options.model === "gemini-3-pro-image";

  const config: GenerateContentConfig = {
    maxOutputTokens: 32768,
    temperature: 1,
    topP: 0.95,
    responseModalities: ["TEXT", "IMAGE"],
    ...buildThinkingConfig(options, isProModel, minimalConfig),
    imageConfig: buildImageConfig(options, isVertex && !minimalConfig, minimalConfig),
    safetySettings,
    ...(options.signal ? ({ abortSignal: options.signal } as Partial<GenerateContentConfig>) : {}),
  };

  let responseText = "";
  let thoughtText = "";
  let finalImageData = "";
  let finalMimeType = IMAGE_MIME_TYPE;
  let thoughtImageData = "";
  let thoughtMimeType = IMAGE_MIME_TYPE;
  let finishReason = "";

  const stream = await ai.models.generateContentStream({
    model: targetModel,
    contents,
    config,
  });

  for await (const chunk of stream) {
    throwIfAborted(options.signal);

    const candidate = chunk.candidates?.[0];
    if (candidate?.finishReason) {
      finishReason = String(candidate.finishReason);
    }

    const parts = candidate?.content?.parts ?? [];
    let foundInlineInChunk = false;

    for (const part of parts) {
      const isThought = Boolean((part as { thought?: boolean }).thought);

      if (part.text) {
        if (isThought) {
          thoughtText += part.text;
          if (isProModel) {
            options.onStatus?.("Nano Banana Pro đang suy luận bố cục...");
          }
        } else {
          responseText += part.text;
        }
      }

      if (part.inlineData?.data) {
        foundInlineInChunk = true;
        if (isThought) {
          thoughtImageData = part.inlineData.data;
          thoughtMimeType = part.inlineData.mimeType || thoughtMimeType;
          options.onStatus?.("Đang tinh chỉnh bản nháp suy luận...");
        } else {
          finalImageData = part.inlineData.data;
          finalMimeType = part.inlineData.mimeType || finalMimeType;
        }
      }
    }

    const rawChunkData = (chunk as { data?: string }).data;
    if (!foundInlineInChunk && !finalImageData && typeof rawChunkData === "string" && rawChunkData.length > 64) {
      finalImageData = rawChunkData;
    }
  }

  let resolvedImageData = finalImageData || thoughtImageData;
  let resolvedMimeType = finalImageData ? finalMimeType : thoughtMimeType;

  if (!resolvedImageData && finishReason !== "SAFETY" && !options.signal?.aborted) {
    options.onStatus?.("Đang tải dữ liệu ảnh hoàn chỉnh...");
    const singleResponse = await ai.models.generateContent({
      model: targetModel,
      contents,
      config,
    });

    const singleCandidate = singleResponse.candidates?.[0];
    if (singleCandidate?.finishReason) {
      finishReason = String(singleCandidate.finishReason);
    }

    for (const part of singleCandidate?.content?.parts ?? []) {
      const isThought = Boolean((part as { thought?: boolean }).thought);
      if (part.inlineData?.data) {
        if (isThought) {
          thoughtImageData = part.inlineData.data;
          thoughtMimeType = part.inlineData.mimeType || thoughtMimeType;
        } else {
          finalImageData = part.inlineData.data;
          finalMimeType = part.inlineData.mimeType || finalMimeType;
        }
      } else if (part.text && !isThought) {
        responseText += part.text;
      }
    }

    resolvedImageData = finalImageData || thoughtImageData;
    resolvedMimeType = finalImageData ? finalMimeType : thoughtMimeType;
  }

  if (finishReason === "SAFETY" || finishReason === "IMAGE_SAFETY") {
    throw new Error("Ảnh bị bộ lọc an toàn chặn. Hãy thử điều chỉnh lại câu lệnh hoặc ảnh tham chiếu.");
  }

  if (!resolvedImageData) {
    const cleanMessage = responseText.trim() || thoughtText.trim();
    throw new Error(
      cleanMessage || `Model ${targetModel} không trả về dữ liệu ảnh (finishReason: ${finishReason || "UNKNOWN"}).`,
    );
  }

  return {
    id: crypto.randomUUID(),
    url: `data:${resolvedMimeType};base64,${resolvedImageData}`,
    mimeType: resolvedMimeType,
    prompt: options.prompt,
    model: options.model,
    createdAt: Date.now(),
    aspectRatio: options.aspectRatio,
    imageSize: options.imageSize,
    referenceThumbnails: options.references.slice(0, 4).map((ref) => ref.dataUrl),
  };
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

function buildImageConfig(
  options: GenerationOptions,
  includeVertexExtras: boolean,
  minimalConfig = false,
): NonNullable<GenerateContentConfig["imageConfig"]> {
  const config: NonNullable<GenerateContentConfig["imageConfig"]> = {};

  if (options.aspectRatio && options.aspectRatio !== "auto") {
    config.aspectRatio = options.aspectRatio;
  }

  if (!minimalConfig && !is1KOnlyModel(options.model) && options.imageSize) {
    config.imageSize = options.imageSize;
  }

  if (includeVertexExtras && !minimalConfig) {
    config.outputMimeType = IMAGE_MIME_TYPE;
    config.personGeneration = "ALLOW_ALL";
  }

  return config;
}

function buildThinkingConfig(
  options: GenerationOptions,
  isProModel: boolean,
  minimalConfig = false,
): Pick<GenerateContentConfig, "thinkingConfig"> {
  if (minimalConfig) return {};

  if (isProModel || options.model === "gemini-2.5-flash-image") {
    return {};
  }

  return {
    thinkingConfig: {
      thinkingLevel: ThinkingLevel.MINIMAL,
    },
  };
}

function isInvalidConfigError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("invalid_argument") ||
    lower.includes("unknown name") ||
    lower.includes("outputmimetype") ||
    lower.includes("persongeneration") ||
    lower.includes("imagesize") ||
    lower.includes("thinking_config") ||
    lower.includes("thinkinglevel")
  );
}

function isRetryableError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("429") ||
    lower.includes("resource_exhausted") ||
    lower.includes("quota") ||
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    lower.includes("503") ||
    lower.includes("unavailable") ||
    lower.includes("overloaded") ||
    lower.includes("network") ||
    lower.includes("failed to fetch")
  );
}

function isRateLimitError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("429") ||
    lower.includes("resource_exhausted") ||
    lower.includes("quota") ||
    lower.includes("rate limit") ||
    lower.includes("too many requests")
  );
}

export function isAbortError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (err instanceof Error) {
    const lower = err.message.toLowerCase();
    return err.name === "AbortError" || lower.includes("aborted") || lower.includes("cancelled by user");
  }
  return false;
}

function createAbortError(): Error {
  const err = new Error("Generation cancelled by user.");
  err.name = "AbortError";
  return err;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      globalThis.clearTimeout(timer);
      reject(createAbortError());
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function readGenerationError(err: unknown): string {
  if (isAbortError(err)) return "Generation cancelled by user.";
  const message = err instanceof Error ? err.message : String(err ?? "Unknown error");

  try {
    const parsed = JSON.parse(message);
    return parsed?.error?.message ?? parsed?.message ?? message;
  } catch {
    return message;
  }
}

function createClient(apiKey: string) {
  const key = apiKey.trim();
  return new GoogleGenAI(isVertexExpressKey(key) ? { apiKey: key, vertexai: true } : { apiKey: key });
}

function isVertexExpressKey(apiKey: string) {
  return apiKey.trim().startsWith("AQ.");
}
