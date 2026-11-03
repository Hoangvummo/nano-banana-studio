import { GoogleGenAI, HarmBlockThreshold, HarmCategory, ThinkingLevel } from "@google/genai";
import type { Content, GenerateContentConfig, Part } from "@google/genai";
import type { GenerationOptions, GeneratedImage, ListedModel } from "../types";
import { splitDataUrl } from "./image";
import { STUDIO_MODELS, getModelCandidates } from "./models";
import { buildReferenceInstruction } from "./prompt";

const IMAGE_MIME_TYPE = "image/png";
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1800;

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
      options.onStatus?.(`Generating variation ${index + 1}/${totalCount}...`);
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
  const candidates = getModelCandidates(options.model);
  let lastError: unknown = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    throwIfAborted(options.signal);

    for (let candidateIdx = 0; candidateIdx < candidates.length; candidateIdx += 1) {
      const candidateModel = candidates[candidateIdx];
      throwIfAborted(options.signal);

      try {
        return await executeModelGeneration(ai, candidateModel, options, isVertex, false);
      } catch (err) {
        if (isAbortError(err) || options.signal?.aborted) {
          throw createAbortError();
        }

        lastError = err;
        const rawMessage = readGenerationError(err);

        // If imageConfig field (like outputMimeType, personGeneration, or imageSize) was rejected,
        // immediately retry with a minimal compatible imageConfig.
        if (isInvalidConfigError(rawMessage)) {
          try {
            return await executeModelGeneration(ai, candidateModel, options, isVertex, true);
          } catch (fallbackErr) {
            if (isAbortError(fallbackErr) || options.signal?.aborted) {
              throw createAbortError();
            }
            lastError = fallbackErr;
          }
        }

        // Try next model alias (e.g. gemini-3-pro-image -> gemini-3-pro-image-preview) if model not found/supported
        if (candidateIdx < candidates.length - 1 && isModelNotFoundError(rawMessage)) {
          options.onStatus?.(`Switching to endpoint ${candidates[candidateIdx + 1]}...`);
          continue;
        }

        // Break inner candidate loop if it's a rate limit or transient error so outer loop backs off
        break;
      }
    }

    const errMessage = readGenerationError(lastError);
    if (attempt < MAX_RETRIES - 1 && isRetryableError(errMessage)) {
      const waitMs = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
      options.onStatus?.(
        `Rate limit / busy — retrying (${attempt + 1}/${MAX_RETRIES - 1}) in ${(waitMs / 1000).toFixed(1)}s...`,
      );
      await abortableDelay(waitMs, options.signal);
      continue;
    }

    break;
  }

  throw new Error(readGenerationError(lastError));
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

  const isProModel = options.model === "gemini-3-pro-image" || targetModel.includes("pro-image");

  const config: GenerateContentConfig = {
    maxOutputTokens: 32768,
    temperature: 1,
    topP: 0.95,
    responseModalities: ["TEXT", "IMAGE"],
    ...buildThinkingConfig(options, isProModel, minimalConfig),
    imageConfig: buildImageConfig(options, isVertex && !minimalConfig, minimalConfig),
    safetySettings,
    ...(options.signal ? { abortSignal: options.signal } : {}),
  };

  let responseText = "";
  let thoughtText = "";
  let finalImageData = "";
  let finalMimeType = IMAGE_MIME_TYPE;
  let thoughtImageData = "";
  let thoughtMimeType = IMAGE_MIME_TYPE;
  let finishReason = "";

  // For Nano Banana Pro, we support streaming with proper thought-part separation
  // and automatic non-streaming fallback if stream yields no final image.
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
            options.onStatus?.("Nano Banana Pro is reasoning composition...");
          }
        } else {
          responseText += part.text;
        }
      }

      if (part.inlineData?.data) {
        foundInlineInChunk = true;
        // CRITICAL FIX: Each inlineData.data in Gemini image responses is a complete
        // base64 image payload (or an interim thought image when part.thought === true).
        // Never concatenate (+=) separate image parts or interim thought images will
        // corrupt the final base64 PNG/JPEG payload.
        if (isThought) {
          thoughtImageData = part.inlineData.data;
          thoughtMimeType = part.inlineData.mimeType || thoughtMimeType;
          options.onStatus?.("Refining interim thought draft...");
        } else {
          finalImageData = part.inlineData.data;
          finalMimeType = part.inlineData.mimeType || finalMimeType;
        }
      }
    }

    // Safe fallback inside loop if SDK attaches raw base64 to chunk.data
    const rawChunkData = (chunk as { data?: string }).data;
    if (!foundInlineInChunk && !finalImageData && typeof rawChunkData === "string" && rawChunkData.length > 64) {
      finalImageData = rawChunkData;
    }
  }

  let resolvedImageData = finalImageData || thoughtImageData;
  let resolvedMimeType = finalImageData ? finalMimeType : thoughtMimeType;

  // Fallback to non-streaming generateContent for Nano Banana Pro if streaming closed early without image bytes
  if (!resolvedImageData && finishReason !== "SAFETY" && !options.signal?.aborted) {
    options.onStatus?.("Fetching full image payload...");
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
    throw new Error("The image was blocked by the safety filter. Try adjusting your prompt or reference images.");
  }

  if (!resolvedImageData) {
    const cleanMessage = responseText.trim() || thoughtText.trim();
    throw new Error(
      cleanMessage || `Model ${targetModel} did not return image bytes (finishReason: ${finishReason || "UNKNOWN"}).`,
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

  // "auto" is a UI option; never send "auto" to the Gemini API on any model
  if (options.aspectRatio && options.aspectRatio !== "auto") {
    config.aspectRatio = options.aspectRatio;
  }

  // gemini-2.5-flash-image only supports aspectRatio, whereas Gemini 3 models support imageSize (1K/2K/4K)
  if (!minimalConfig && options.model !== "gemini-2.5-flash-image" && options.imageSize) {
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

  // Nano Banana Pro (gemini-3-pro-image) has mandatory Thinking enabled by default
  // and does not accept ThinkingLevel.MINIMAL.
  if (isProModel || options.model === "gemini-2.5-flash-image") {
    return {};
  }

  return {
    thinkingConfig: {
      thinkingLevel: ThinkingLevel.MINIMAL,
    },
  };
}

function isModelNotFoundError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("404") ||
    lower.includes("not_found") ||
    lower.includes("not found") ||
    lower.includes("is not supported for generatecontent")
  );
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
