import type { GenerationOptions, GeneratedImage, ListedModel } from "../types";
import { splitDataUrl } from "./image";
import { STUDIO_MODELS, is1KOnlyModel, selectedModelApiName } from "./models";
import { buildReferenceInstruction } from "./prompt";

/*
 * API CALLING RULES — one rule set for every studio model, both key types.
 *
 * This file talks to Google's REST APIs directly with fetch. It does NOT
 * use the @google/genai SDK, on purpose: the SDK's browser client throws
 * ("Vertex AI project based authentication is not supported on browser
 * runtimes") as soon as a `project` or `location` option is passed, and
 * older/newer SDK versions have routed Vertex requests differently
 * (notably through projects/<id>/locations/us-central1/...). Building the
 * URL ourselves removes that whole class of failures.
 *
 * Backend, decided ONLY by the key prefix — never by the model:
 *   - Key starting with "AQ."  = Vertex AI / Gemini Enterprise in
 *     Express Mode. Endpoint (the documented Express endpoint, global,
 *     no project, no location anywhere in the URL):
 *       POST https://aiplatform.googleapis.com/v1/publishers/google/models/<apiName>:streamGenerateContent?alt=sse
 *     Auth: header `x-goog-api-key: <key>`.
 *   - Any other key (e.g. "AIza...") = Gemini Developer API:
 *       POST https://generativelanguage.googleapis.com/v1beta/models/<apiName>:streamGenerateContent?alt=sse
 *     Auth: same `x-goog-api-key` header.
 *
 * Model, decided ONLY by the user's selection:
 *   - The exact apiName from models.ts is used, for all 5 models.
 *     No *-preview alias, no fallback to another model, ever.
 *   - All 5 studio models are served from the global endpoint, so there
 *     is no per-model location: 2.1, Pro and 2 Lite are global-only,
 *     3.1 Flash is global/us/eu, and 2.5 Flash is global plus regions.
 *     Sending a regional path (us-central1, ...) is therefore wrong
 *     for every model here, not just 2.1.
 *
 * Request config, per model:
 *   - Common: responseModalities ["TEXT", "IMAGE"], maxOutputTokens 32768,
 *     safetySettings OFF for the four harm categories.
 *   - imageConfig: aspectRatio (unless "auto"), imageSize (only for
 *     models that support 2K/4K; the 1K-only models get no imageSize and
 *     therefore default to 1K).
 *   - Vertex-only extras: outputMimeType "image/png" and
 *     personGeneration "ALLOW_ALL". These are NOT sent on the Gemini API.
 *   - Sampling: temperature/topP are sent for every model EXCEPT
 *     gemini-nano-banana-2.1, which returns an API error if temperature,
 *     topP, topK, seed or logprobs are set at all.
 *   - Thinking: thinkingLevel MINIMAL, except Pro (uses its own
 *     reasoning) and 2.5 Flash (no thinkingConfig). The minimal-config
 *     retry drops thinkingConfig, imageSize and the Vertex extras, and
 *     also drops temperature/topP — same model, smaller config only.
 */

const IMAGE_MIME_TYPE = "image/png";
// Retry delay for rate-limit / transient errors. There is intentionally
// no max-attempt cap for those errors: the wait backs off exponentially
// up to this ceiling and then keeps retrying until it succeeds or the
// user cancels (the delay is abortable). Non-retryable errors below
// still fail immediately.
const BASE_RETRY_DELAY_MS = 1800;
const MAX_RETRY_DELAY_MS = 60_000;

type ApiBackend = "vertex-express" | "gemini-api";

interface ApiPart {
  text?: string;
  inlineData?: { data: string; mimeType?: string };
  thought?: boolean;
}

interface ApiCandidate {
  finishReason?: string;
  content?: { parts?: ApiPart[] };
}

interface ApiResponse {
  candidates?: ApiCandidate[];
  error?: { code?: number; message?: string; status?: string };
}

interface GenerationState {
  responseText: string;
  thoughtText: string;
  finalImageData: string;
  finalMimeType: string;
  thoughtImageData: string;
  thoughtMimeType: string;
  finishReason: string;
}

const safetySettings = [
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
];

function resolveBackend(apiKey: string): ApiBackend {
  return isVertexExpressKey(apiKey) ? "vertex-express" : "gemini-api";
}

function isVertexExpressKey(apiKey: string) {
  return apiKey.trim().startsWith("AQ.");
}

// Exact endpoint for one backend + one model. Note what is absent:
// no projects/, no locations/, no region — for either backend.
function endpointFor(backend: ApiBackend, apiName: string, stream: boolean): string {
  const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
  if (backend === "vertex-express") {
    return `https://aiplatform.googleapis.com/v1/publishers/google/models/${apiName}:${action}`;
  }
  return `https://generativelanguage.googleapis.com/v1beta/models/${apiName}:${action}`;
}

export async function listModels(apiKey: string): Promise<ListedModel[]> {
  if (!apiKey.trim()) throw new Error("Enter an API key first.");

  try {
    if (resolveBackend(apiKey) === "vertex-express") {
      // Express Mode has no project-scoped model list to query from a
      // browser; the studio model list is the source of truth here.
      return STUDIO_MODELS.map((model) => ({
        name: `models/${model.id}`,
        displayName: model.label,
        description: model.description,
        supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
      }));
    }

    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=100",
      { headers: { "x-goog-api-key": apiKey.trim() } },
    );
    if (!res.ok) {
      throw new Error(await readApiError(res));
    }
    const data = (await res.json()) as {
      models?: Array<{
        name?: string;
        displayName?: string;
        description?: string;
        supportedGenerationMethods?: string[];
      }>;
    };
    return (data.models ?? [])
      .filter((model) => model.name)
      .map((model) => ({
        name: model.name as string,
        displayName: model.displayName,
        description: model.description,
        supportedGenerationMethods: model.supportedGenerationMethods,
      }));
  } catch (err) {
    throw new Error(readGenerationError(err));
  }
}

export async function generateImage(options: GenerationOptions): Promise<GeneratedImage[]> {
  throwIfAborted(options.signal);

  const backend = resolveBackend(options.apiKey);
  const results: GeneratedImage[] = [];
  const totalCount = Math.max(1, options.count);

  for (let index = 0; index < totalCount; index += 1) {
    throwIfAborted(options.signal);

    if (totalCount > 1) {
      options.onStatus?.(`Đang tạo biến thể ${index + 1}/${totalCount}...`);
    }

    const generated = await generateSingleImageWithRetry(backend, options);
    results.push(generated);
  }

  return results;
}

async function generateSingleImageWithRetry(
  backend: ApiBackend,
  options: GenerationOptions,
): Promise<GeneratedImage> {
  // Exact model only: no fallback to a *-preview alias or another model.
  // If this model is not found / not supported, that error is surfaced
  // as-is instead of silently generating with a different model.
  const apiName = selectedModelApiName(options.model);
  let attempt = 0;

  for (;;) {
    throwIfAborted(options.signal);

    let lastError: unknown = null;
    try {
      return await executeModelGeneration(backend, apiName, options, false);
    } catch (err) {
      if (isAbortError(err) || options.signal?.aborted) {
        throw createAbortError();
      }
      lastError = err;

      // Same model, minimal config only (imageConfig extras / thinking
      // fields / sampling fields rejected by this model). This is not
      // a model redirect.
      if (isInvalidConfigError(readGenerationError(err))) {
        try {
          return await executeModelGeneration(backend, apiName, options, true);
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
          ? `Chạm giới hạn tốc độ của model ${apiName} — đang chờ và sẽ thử lại lần ${attempt} sau ${waitSeconds}s, vẫn giữ đúng model này (bấm Hủy để dừng)...`
          : `Máy chủ đang bận — đang chờ và sẽ thử lại lần ${attempt} sau ${waitSeconds}s, vẫn giữ đúng model ${apiName} (bấm Hủy để dừng)...`,
      );
      await abortableDelay(waitMs, options.signal);
      continue;
    }

    throw new Error(errMessage);
  }
}

async function executeModelGeneration(
  backend: ApiBackend,
  apiName: string,
  options: GenerationOptions,
  minimalConfig: boolean,
): Promise<GeneratedImage> {
  const body = buildRequestBody(backend, options, minimalConfig);
  const state: GenerationState = {
    responseText: "",
    thoughtText: "",
    finalImageData: "",
    finalMimeType: IMAGE_MIME_TYPE,
    thoughtImageData: "",
    thoughtMimeType: IMAGE_MIME_TYPE,
    finishReason: "",
  };

  const streamRes = await fetch(endpointFor(backend, apiName, true), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": options.apiKey.trim(),
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!streamRes.ok) {
    throw new Error(await readApiError(streamRes));
  }
  if (!streamRes.body) {
    throw new Error("Máy chủ không trả về luồng dữ liệu.");
  }

  await consumeStream(streamRes.body, options, state);

  let resolvedImageData = state.finalImageData || state.thoughtImageData;
  let resolvedMimeType = state.finalImageData ? state.finalMimeType : state.thoughtMimeType;

  if (!resolvedImageData && state.finishReason !== "SAFETY" && !options.signal?.aborted) {
    options.onStatus?.("Đang tải dữ liệu ảnh hoàn chỉnh...");
    const singleRes = await fetch(endpointFor(backend, apiName, false), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": options.apiKey.trim(),
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });
    if (!singleRes.ok) {
      throw new Error(await readApiError(singleRes));
    }
    const single = (await singleRes.json()) as ApiResponse;
    for (const candidate of single.candidates ?? []) {
      applyCandidate(candidate, options, state);
    }
    resolvedImageData = state.finalImageData || state.thoughtImageData;
    resolvedMimeType = state.finalImageData ? state.finalMimeType : state.thoughtMimeType;
  }

  if (state.finishReason === "SAFETY" || state.finishReason === "IMAGE_SAFETY") {
    throw new Error("Ảnh bị bộ lọc an toàn chặn. Hãy thử điều chỉnh lại câu lệnh hoặc ảnh tham chiếu.");
  }

  if (!resolvedImageData) {
    const cleanMessage = state.responseText.trim() || state.thoughtText.trim();
    throw new Error(
      cleanMessage || `Model ${apiName} không trả về dữ liệu ảnh (finishReason: ${state.finishReason || "UNKNOWN"}).`,
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

function buildRequestBody(
  backend: ApiBackend,
  options: GenerationOptions,
  minimalConfig: boolean,
): Record<string, unknown> {
  const parts: ApiPart[] = options.references.map((reference) => {
    const { data, mimeType } = splitDataUrl(reference.dataUrl);
    return { inlineData: { data, mimeType } };
  });
  parts.push({ text: buildReferenceInstruction(options.prompt, options.references.length) });

  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: 32768,
    responseModalities: ["TEXT", "IMAGE"],
  };

  // 2.1 rejects temperature/topP outright; every other studio model
  // accepts the defaults, so only 2.1 omits them. The minimal retry
  // omits them for all models.
  if (!minimalConfig && options.model !== "gemini-nano-banana-2.1") {
    generationConfig.temperature = 1;
    generationConfig.topP = 0.95;
  }

  if (!minimalConfig && options.model !== "gemini-3-pro-image" && options.model !== "gemini-2.5-flash-image") {
    generationConfig.thinkingConfig = { thinkingLevel: "MINIMAL" };
  }

  const imageConfig = buildImageConfig(backend, options, minimalConfig);
  if (Object.keys(imageConfig).length > 0) {
    generationConfig.imageConfig = imageConfig;
  }

  return {
    contents: [{ role: "user", parts }],
    generationConfig,
    safetySettings,
  };
}

function buildImageConfig(
  backend: ApiBackend,
  options: GenerationOptions,
  minimalConfig = false,
): Record<string, unknown> {
  const config: Record<string, unknown> = {};

  if (options.aspectRatio && options.aspectRatio !== "auto") {
    config.aspectRatio = options.aspectRatio;
  }

  if (!minimalConfig && !is1KOnlyModel(options.model) && options.imageSize) {
    config.imageSize = options.imageSize;
  }

  // Vertex-only fields: never sent on the Gemini Developer API.
  if (backend === "vertex-express" && !minimalConfig) {
    config.outputMimeType = IMAGE_MIME_TYPE;
    config.personGeneration = "ALLOW_ALL";
  }

  return config;
}

function applyCandidate(candidate: ApiCandidate, options: GenerationOptions, state: GenerationState) {
  if (candidate.finishReason) {
    state.finishReason = String(candidate.finishReason);
  }
  const isProModel = options.model === "gemini-3-pro-image";
  for (const part of candidate.content?.parts ?? []) {
    const isThought = Boolean(part.thought);
    if (part.text) {
      if (isThought) {
        state.thoughtText += part.text;
        if (isProModel) {
          options.onStatus?.("Nano Banana Pro đang suy luận bố cục...");
        }
      } else {
        state.responseText += part.text;
      }
    }
    if (part.inlineData?.data) {
      if (isThought) {
        state.thoughtImageData = part.inlineData.data;
        state.thoughtMimeType = part.inlineData.mimeType || state.thoughtMimeType;
        options.onStatus?.("Đang tinh chỉnh bản nháp suy luận...");
      } else {
        state.finalImageData = part.inlineData.data;
        state.finalMimeType = part.inlineData.mimeType || state.finalMimeType;
      }
    }
  }
}

async function consumeStream(
  body: ReadableStream<Uint8Array>,
  options: GenerationOptions,
  state: GenerationState,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      throwIfAborted(options.signal);
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const line of event.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice("data:".length).trim();
          if (!payload || payload === "[DONE]") continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(payload);
          } catch {
            continue;
          }
          const chunks = Array.isArray(parsed) ? parsed : [parsed];
          for (const chunk of chunks) {
            throwIfAborted(options.signal);
            if (chunk && typeof chunk === "object" && "error" in chunk) {
              const apiErr = chunk as ApiResponse;
              throw new Error(
                `${apiErr.error?.code ?? ""} ${apiErr.error?.status ?? ""} ${apiErr.error?.message ?? "Stream error"}`.trim(),
              );
            }
            for (const candidate of (chunk as ApiResponse).candidates ?? []) {
              applyCandidate(candidate, options, state);
            }
          }
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
    // A final event without a trailing blank line.
    const tail = buffer.trim();
    if (tail.startsWith("data:")) {
      try {
        const parsed = JSON.parse(tail.slice("data:".length).trim()) as ApiResponse;
        for (const candidate of parsed.candidates ?? []) {
          applyCandidate(candidate, options, state);
        }
      } catch {
        // Ignore a truncated trailing event; the non-stream fallback
        // in executeModelGeneration covers a missing image.
      }
    }
  } catch (err) {
    if (isAbortError(err) || options.signal?.aborted) {
      throw createAbortError();
    }
    throw err;
  } finally {
    try {
      reader.cancel();
    } catch {
      // Reader already closed.
    }
  }
}

async function readApiError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as ApiResponse;
    const message = parsed.error?.message ?? text;
    const status = parsed.error?.status ? ` (${parsed.error.status})` : "";
    return `HTTP ${res.status}${status}: ${message}`;
  } catch {
    return `HTTP ${res.status}: ${text || res.statusText}`;
  }
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
    lower.includes("thinkinglevel") ||
    lower.includes("temperature") ||
    lower.includes("topp")
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
