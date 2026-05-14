import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Aperture,
  BadgeCheck,
  Brush,
  Check,
  Download,
  Eraser,
  ImageIcon,
  KeyRound,
  Loader2,
  Maximize2,
  Palette,
  Plus,
  RefreshCw,
  Scissors,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import { generateImage, listModels } from "./lib/gemini";
import { ASPECT_RATIOS, DEFAULT_MODEL, IMAGE_SIZES, STUDIO_MODELS, modelLabel } from "./lib/models";
import { downloadDataUrl, fileToReference } from "./lib/image";
import { randomPrompt } from "./lib/prompt";
import type { AspectRatio, GeneratedImage, ImageSize, ModelId, ReferenceImage } from "./types";
import "./styles.css";

type FeatureId = "create" | "copyStyle" | "edit" | "ecommerce" | "extractOutfit" | "studio";
type SlotKey = "face" | "outfit" | "style" | "source" | "back";

interface FeatureConfig {
  id: FeatureId;
  label: string;
  subtitle: string;
  icon: React.ElementType;
  slots: Array<{ key: SlotKey; label: string; help: string; role: ReferenceImage["role"]; large?: boolean }>;
  promptLabel: string;
  placeholder: string;
  cta: string;
}

interface BatchTask {
  id: string;
  label: string;
  status: "running" | "done" | "error";
  message?: string;
  source?: ReferenceImage;
}

interface GenerationJob {
  id: string;
  title: string;
  tasks: BatchTask[];
  createdAt: number;
}

const features: FeatureConfig[] = [
  {
    id: "create",
    label: "Create",
    subtitle: "Prompt to image",
    icon: Sparkles,
    slots: [],
    promptLabel: "Prompt",
    placeholder: "Describe the image you want to create.",
    cta: "Generate image",
  },
  {
    id: "copyStyle",
    label: "Style Copy",
    subtitle: "Copy vibe, replace outfit or face",
    icon: Palette,
    slots: [
      { key: "style", label: "Style reference", help: "Copy vibe", role: "style" },
      { key: "outfit", label: "New outfit", help: "Upload outfit", role: "outfit" },
      { key: "face", label: "Model face", help: "Optional face", role: "face", large: true },
    ],
    promptLabel: "Model description",
    placeholder: "Example: A stylish Vietnamese woman, relaxed pose, natural expression.",
    cta: "Copy style",
  },
  {
    id: "edit",
    label: "Custom Edit",
    subtitle: "Prompt with multiple references",
    icon: Brush,
    slots: [{ key: "source", label: "Reference images", help: "Upload references", role: "source", large: true }],
    promptLabel: "Custom edit prompt",
    placeholder:
      "Example: Use image 1 as the main subject, image 2 for the outfit, and image 3 for the background style. Create one realistic final image.",
    cta: "Generate custom edit",
  },
  {
    id: "ecommerce",
    label: "E-commerce",
    subtitle: "Product model photos",
    icon: Aperture,
    slots: [
      { key: "outfit", label: "Front outfit", help: "Required", role: "outfit" },
      { key: "back", label: "Back outfit", help: "Optional", role: "outfit" },
      { key: "face", label: "Model face", help: "Optional", role: "face", large: true },
    ],
    promptLabel: "Pose direction",
    placeholder: "Example: Full body, eye-level, clean white studio background, natural pose.",
    cta: "Create e-commerce photo",
  },
  {
    id: "extractOutfit",
    label: "Extract Outfit",
    subtitle: "Garment on white background",
    icon: Scissors,
    slots: [{ key: "source", label: "Model image", help: "Extract clothing", role: "source", large: true }],
    promptLabel: "Extraction notes",
    placeholder: "Optional: keep front view, remove body parts, pure white background.",
    cta: "Extract outfit",
  },
  {
    id: "studio",
    label: "Studio Cutout",
    subtitle: "Batch white-studio output",
    icon: Eraser,
    slots: [{ key: "source", label: "Model images", help: "Upload batch", role: "source", large: true }],
    promptLabel: "Studio direction",
    placeholder: "Optional: keep identity, outfit, pose, and crop. Replace background with pure white studio.",
    cta: "Run batch",
  },
];

const posePresets = [
  "Full body, eye-level, front-facing, balanced commercial pose, pure white studio background.",
  "Full body, three-quarter view, one hand relaxed near the waist, premium catalog pose.",
  "Back view fashion pose, head slightly turned over shoulder, clean white studio background.",
];

function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [rememberKey, setRememberKey] = useState(false);
  const [apiStatus, setApiStatus] = useState<"idle" | "checking" | "ready" | "error">("idle");
  const [apiMessage, setApiMessage] = useState("API key not tested.");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [activeFeature, setActiveFeature] = useState<FeatureId>("studio");
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("3:4");
  const [imageSize, setImageSize] = useState<ImageSize>("2K");
  const [count, setCount] = useState(1);
  const [prompt, setPrompt] = useState("");
  const [slotImages, setSlotImages] = useState<Partial<Record<SlotKey, ReferenceImage>>>({});
  const [studioBatchImages, setStudioBatchImages] = useState<ReferenceImage[]>([]);
  const [editReferenceImages, setEditReferenceImages] = useState<ReferenceImage[]>([]);
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [expandedJobIds, setExpandedJobIds] = useState<string[]>([]);
  const [results, setResults] = useState<GeneratedImage[]>([]);
  const [galleryFilter, setGalleryFilter] = useState<"all" | "latest" | "errors">("all");
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);
  const [error, setError] = useState("");
  const [successToast, setSuccessToast] = useState("");

  const feature = useMemo(() => features.find((item) => item.id === activeFeature)!, [activeFeature]);
  const detectedModels = STUDIO_MODELS.filter((item) => availableModels.includes(`models/${item.id}`));
  const refs = feature.slots.map((slot) => slotImages[slot.key]).filter((item): item is ReferenceImage => Boolean(item));
  const latestJob = jobs[0];
  const latestResults = results.filter((image) => image.prompt.includes(latestJob?.id ?? "__none__"));
  const visibleResults =
    galleryFilter === "latest" && latestResults.length ? latestResults : galleryFilter === "errors" ? [] : results;

  useEffect(() => {
    const saved = localStorage.getItem("nano-banana-api-key");
    if (saved) {
      setApiKey(saved);
      setRememberKey(true);
      setApiMessage("Saved key loaded. Test it before generating.");
    }
  }, []);

  useEffect(() => {
    setSlotImages({});
    setStudioBatchImages([]);
    setEditReferenceImages([]);
    setPrompt(activeFeature === "create" ? randomPrompt() : "");
  }, [activeFeature]);

  useEffect(() => {
    if (!successToast) return;
    const timer = window.setTimeout(() => setSuccessToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [successToast]);

  async function handleTestKey() {
    if (!apiKey.trim()) {
      setError("Enter an API key first.");
      return;
    }
    setApiStatus("checking");
    setError("");
    setApiMessage("Checking image model access...");

    try {
      const models = await listModels(apiKey.trim());
      const names = models.map((item) => item.name);
      const imageModels = STUDIO_MODELS.filter((item) => names.includes(`models/${item.id}`));
      setAvailableModels(names);

      if (!imageModels.length) {
        setApiStatus("error");
        setApiMessage("Key works, but no Nano Banana image models were found.");
        return;
      }

      if (!names.includes(`models/${model}`)) setModel(imageModels[0].id);
      if (rememberKey) localStorage.setItem("nano-banana-api-key", apiKey.trim());
      else localStorage.removeItem("nano-banana-api-key");

      setApiStatus("ready");
      setApiMessage(`${imageModels.length} image models available.`);
    } catch (err) {
      setApiStatus("error");
      setApiMessage("Could not validate this API key.");
      setError(err instanceof Error ? err.message : "Key check failed.");
    }
  }

  async function handleSlotFile(files: FileList | null, slot: FeatureConfig["slots"][number]) {
    if (!files?.length) return;
    if (activeFeature === "edit" && slot.key === "source") {
      const references = await Promise.all(Array.from(files).map((file) => fileToReference(file, slot.role)));
      setEditReferenceImages((current) => [...current, ...references]);
      return;
    }

    if (activeFeature === "studio" && slot.key === "source") {
      const references = await Promise.all(Array.from(files).map((file) => fileToReference(file, slot.role)));
      setStudioBatchImages((current) => [...current, ...references]);
      return;
    }

    const reference = await fileToReference(files[0], slot.role);
    setSlotImages((current) => ({ ...current, [slot.key]: reference }));
  }

  function removeSlotImage(slot: SlotKey) {
    setSlotImages((current) => {
      const next = { ...current };
      delete next[slot];
      return next;
    });
  }

  async function handleGenerate(images = studioBatchImages) {
    if (!apiKey.trim()) {
      setError("Add and test an API key in Settings before generating.");
      setSettingsOpen(true);
      return;
    }

    const finalPrompt = composePrompt(feature, prompt);
    if (!finalPrompt.trim()) {
      setError("Write an instruction first.");
      return;
    }

    const jobFeature = feature;
    const jobFeatureId = activeFeature;
    const jobPrompt = finalPrompt;
    const jobModel = model;
    const jobAspectRatio = aspectRatio;
    const jobImageSize = imageSize;
    const jobCount = count;
    const jobRefs = refs;
    const jobEditRefs = editReferenceImages;

    setError("");

    if (jobFeatureId === "studio") {
      if (!images.length) {
        setError("Upload at least one image for Studio Cutout.");
        return;
      }

      const batchId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const tasks: BatchTask[] = images.map((image) => ({
        id: crypto.randomUUID(),
        label: image.name,
        status: "running",
        source: image,
      }));
      addJob({ id: batchId, title: "Studio Cutout", tasks, createdAt: Date.now() });

      void Promise.all(
        images.map(async (source, index) => {
          const taskId = tasks[index].id;
          try {
            const output = await generateImage({
              apiKey: apiKey.trim(),
              model: jobModel,
              prompt: `${finalPrompt}\n\nBatch marker: ${batchId}`,
              references: [source],
              aspectRatio: jobAspectRatio,
              imageSize: jobImageSize,
              count: 1,
            });
            setResults((current) => [...output, ...current]);
            updateTask(batchId, taskId, { status: "done", message: "Completed" });
          } catch (err) {
            updateTask(batchId, taskId, {
              status: "error",
              message: err instanceof Error ? err.message : "Failed",
            });
          }
        }),
      );

      return;
    }

    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const taskCount = Math.max(1, jobCount);
    const taskRefs = jobFeatureId === "edit" && jobEditRefs.length > 0 ? jobEditRefs : jobRefs;
    const tasks: BatchTask[] = Array.from({ length: taskCount }).map((_, index) => ({
      id: crypto.randomUUID(),
      label: taskCount > 1 ? `${jobFeature.label} ${index + 1}` : jobFeature.label,
      status: "running",
    }));
    addJob({ id: jobId, title: jobFeature.label, tasks, createdAt: Date.now() });

    void Promise.all(
      tasks.map(async (task) => {
        try {
          const output = await generateImage({
            apiKey: apiKey.trim(),
            model: jobModel,
            prompt: `${jobPrompt}\n\nBatch marker: ${jobId}`,
            references: taskRefs,
            aspectRatio: jobAspectRatio,
            imageSize: jobImageSize,
            count: 1,
          });
          setResults((current) => [...output, ...current]);
          updateTask(jobId, task.id, { status: "done", message: "Completed" });
        } catch (err) {
          updateTask(jobId, task.id, { status: "error", message: err instanceof Error ? err.message : "Failed" });
          setError(err instanceof Error ? err.message : "Generation failed.");
        }
      }),
    );
  }

  function addJob(job: GenerationJob) {
    setJobs((current) => [job, ...current]);
    setExpandedJobIds((current) => [job.id, ...current]);
  }

  function updateTask(jobId: string, taskId: string, patch: Partial<BatchTask>) {
    setJobs((current) =>
      current.map((job) =>
        job.id === jobId
          ? {
              ...job,
              tasks: job.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task)),
            }
          : job,
      ),
    );
  }

  function retryFailed(jobId: string) {
    const job = jobs.find((item) => item.id === jobId);
    const sources = job?.tasks
      .filter((task) => task.status === "error")
      .map((task) => task.source)
      .filter((item): item is ReferenceImage => Boolean(item));
    if (sources?.length) void handleGenerate(sources);
  }

  function toggleJob(jobId: string) {
    setExpandedJobIds((current) =>
      current.includes(jobId) ? current.filter((id) => id !== jobId) : [jobId, ...current],
    );
  }

  function dismissJob(jobId: string) {
    setJobs((current) => current.filter((job) => job.id !== jobId));
    setExpandedJobIds((current) => current.filter((id) => id !== jobId));
  }

  return (
    <main className="studio-shell">
      <aside className="icon-rail" aria-label="Feature tabs">
        <div className="rail-logo">
          <ImageIcon size={18} />
        </div>
        <div className="rail-tabs">
          {features.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={activeFeature === item.id ? "rail-tab active" : "rail-tab"}
                onClick={() => setActiveFeature(item.id)}
                title={`${item.label}: ${item.subtitle}`}
                aria-label={item.label}
              >
                <Icon size={17} />
              </button>
            );
          })}
        </div>
      </aside>

      <section className="tool-panel">
        <header className="tool-title">
          <div>
            <h1>{feature.label}</h1>
            <p>{feature.subtitle}</p>
          </div>
        </header>

        <section className="workflow-steps">
          <StepLabel number="1" label={activeFeature === "create" ? "Prompt" : "Upload"} />
          <FeatureInputs
            feature={feature}
            activeFeature={activeFeature}
            slotImages={slotImages}
            studioBatchImages={studioBatchImages}
            editReferenceImages={editReferenceImages}
            onFile={handleSlotFile}
            onRemove={removeSlotImage}
            onRemoveBatch={(id) => setStudioBatchImages((items) => items.filter((item) => item.id !== id))}
            onClearBatch={() => setStudioBatchImages([])}
            onRemoveEditReference={(id) => setEditReferenceImages((items) => items.filter((item) => item.id !== id))}
            onClearEditReferences={() => setEditReferenceImages([])}
          />

          {activeFeature === "ecommerce" && (
            <section className="preset-strip" aria-label="Pose presets">
              {posePresets.map((preset, index) => (
                <button key={preset} onClick={() => setPrompt(preset)}>
                  Pose {index + 1}
                </button>
              ))}
            </section>
          )}

          <StepLabel number="2" label="Direction" />
          <section className="instruction-section">
            <div className="instruction-heading">
              <p className="section-label">{feature.promptLabel}</p>
              {activeFeature === "create" && (
                <button className="micro-button" onClick={() => setPrompt(randomPrompt())}>
                  <RefreshCw size={14} />
                  Random
                </button>
              )}
            </div>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={feature.placeholder}
              spellCheck={false}
            />
          </section>

          <StepLabel number="3" label="Run" />
          <button className="generate-action" onClick={() => void handleGenerate()}>
            <Sparkles size={18} />
            {activeFeature === "studio" && studioBatchImages.length
              ? `Run ${studioBatchImages.length} images in parallel`
              : activeFeature === "edit" && editReferenceImages.length
                ? `Generate from ${editReferenceImages.length} references`
                : feature.cta}
          </button>
        </section>
      </section>

      <section className="gallery-stage">
        <header className="studio-topbar">
          <div className="readiness">
            <span className={`status-dot ${apiStatus}`} />
            <button onClick={() => setSettingsOpen(true)}>
              <Settings2 size={16} />
              {apiStatus === "ready" ? `Ready · ${detectedModels.length} models` : "Settings"}
            </button>
          </div>
          <div className="top-controls">
            <label>
              Model
              <select value={model} onChange={(event) => setModel(event.target.value as ModelId)}>
                {STUDIO_MODELS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Aspect
              <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as AspectRatio)}>
                {ASPECT_RATIOS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Quality
              <select value={imageSize} onChange={(event) => setImageSize(event.target.value as ImageSize)}>
                {IMAGE_SIZES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            {activeFeature !== "studio" && (
              <label>
                Count
                <input
                  type="number"
                  min={1}
                  max={4}
                  value={count}
                  onChange={(event) => setCount(Number(event.target.value))}
                />
              </label>
            )}
          </div>
        </header>

        <section className="gallery-canvas">
          <GalleryToolbar
            filter={galleryFilter}
            onFilter={setGalleryFilter}
            results={results}
            latestCount={latestResults.length}
            onClear={() => setResults([])}
          />

          {jobs.length > 0 && (
            <section className="jobs-panel" aria-label="Generation jobs">
              {jobs.map((job) => {
                const hasRetryableFailures = job.tasks.some((task) => task.status === "error" && task.source);
                return (
                  <BatchSummary
                    key={job.id}
                    batch={job}
                    expanded={expandedJobIds.includes(job.id)}
                    onToggle={() => toggleJob(job.id)}
                    onDismiss={() => dismissJob(job.id)}
                    onRetry={hasRetryableFailures ? () => retryFailed(job.id) : undefined}
                  />
                );
              })}
            </section>
          )}

          {visibleResults.length === 0 ? (
            <div className="stage-empty">
              <div className="empty-icon">
                <ImageIcon size={38} />
              </div>
              <h2>Studio Gallery</h2>
              <p>Outputs appear here. The workspace stays clean while tasks run in the background.</p>
            </div>
          ) : (
            <div className="result-grid">
              {visibleResults.map((image) => (
                <article className="result-card" key={image.id}>
                  <button onClick={() => setSelectedImage(image)}>
                    <img src={image.url} alt="Generated image result" />
                    <span>
                      <Maximize2 size={16} />
                    </span>
                  </button>
                  <div>
                    <p>{modelLabel(image.model)}</p>
                    <button onClick={() => downloadDataUrl(image.url, `nano-banana-${image.id}.png`)}>
                      <Download size={15} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>

      {settingsOpen && (
        <SettingsModal
          apiKey={apiKey}
          rememberKey={rememberKey}
          apiStatus={apiStatus}
          apiMessage={apiMessage}
          models={detectedModels}
          onClose={() => setSettingsOpen(false)}
          onApiKey={setApiKey}
          onRemember={setRememberKey}
          onTest={() => void handleTestKey()}
        />
      )}

      {error && (
        <div className="toast error" role="alert" aria-live="assertive">
          <X size={16} />
          <span>{error}</span>
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}

      {successToast && (
        <div className="toast success" role="status">
          <Check size={16} />
          <span>{successToast}</span>
        </div>
      )}

      {selectedImage && (
        <div className="modal-backdrop" onClick={() => setSelectedImage(null)}>
          <section className="image-modal" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelectedImage(null)} aria-label="Close preview">
              <X size={22} />
            </button>
            <img src={selectedImage.url} alt="Generated image preview" />
            <div>
              <p className="section-label">{modelLabel(selectedImage.model)}</p>
              <h2>Prompt</h2>
              <pre>{selectedImage.prompt}</pre>
              <button
                className="generate-action"
                onClick={() => downloadDataUrl(selectedImage.url, `nano-banana-${selectedImage.id}.png`)}
              >
                <Download size={18} />
                Download
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function FeatureInputs(props: {
  feature: FeatureConfig;
  activeFeature: FeatureId;
  slotImages: Partial<Record<SlotKey, ReferenceImage>>;
  studioBatchImages: ReferenceImage[];
  editReferenceImages: ReferenceImage[];
  onFile: (files: FileList | null, slot: FeatureConfig["slots"][number]) => void;
  onRemove: (slot: SlotKey) => void;
  onRemoveBatch: (id: string) => void;
  onClearBatch: () => void;
  onRemoveEditReference: (id: string) => void;
  onClearEditReferences: () => void;
}) {
  if (props.activeFeature === "create") {
    return (
      <div className="solo-prompt-note">
        <WandSparkles size={26} />
        <p>Text-only generation. Use direction below as the full creative brief.</p>
      </div>
    );
  }

  return (
    <section className="slot-grid">
      {props.feature.slots.map((slot) => {
        const image = props.slotImages[slot.key];
        const isStudioBatch = props.activeFeature === "studio" && slot.key === "source";
        const isCustomEdit = props.activeFeature === "edit" && slot.key === "source";
        return (
          <div className={slot.large ? "slot-wrap large" : "slot-wrap"} key={slot.key}>
            <p className="section-label">{slot.label}</p>
            <label
              className={
                image || (isStudioBatch && props.studioBatchImages.length) || (isCustomEdit && props.editReferenceImages.length)
                  ? "upload-slot filled"
                  : "upload-slot"
              }
            >
              {isStudioBatch && props.studioBatchImages.length > 0 ? (
                <>
                  <div className="batch-stack">
                    {props.studioBatchImages.slice(0, 8).map((batchImage) => (
                      <img key={batchImage.id} src={batchImage.dataUrl} alt={`${batchImage.name} preview`} />
                    ))}
                  </div>
                  <span>{props.studioBatchImages.length} images queued</span>
                </>
              ) : isCustomEdit && props.editReferenceImages.length > 0 ? (
                <>
                  <div className="batch-stack">
                    {props.editReferenceImages.slice(0, 8).map((reference) => (
                      <img key={reference.id} src={reference.dataUrl} alt={`${reference.name} preview`} />
                    ))}
                  </div>
                  <span>{props.editReferenceImages.length} references attached</span>
                </>
              ) : image ? (
                <>
                  <img src={image.dataUrl} alt={`${slot.label} reference`} />
                  <span>{image.name}</span>
                </>
              ) : (
                <>
                  <Upload size={26} />
                  <span>{slot.help}</span>
                </>
              )}
              <input
                type="file"
                accept="image/*"
                multiple={isStudioBatch || isCustomEdit}
                onChange={(event) => props.onFile(event.target.files, slot)}
              />
            </label>
            {isStudioBatch && props.studioBatchImages.length > 0 ? (
              <BatchThumbs images={props.studioBatchImages} onRemove={props.onRemoveBatch} onClear={props.onClearBatch} />
            ) : isCustomEdit && props.editReferenceImages.length > 0 ? (
              <BatchThumbs
                images={props.editReferenceImages}
                onRemove={props.onRemoveEditReference}
                onClear={props.onClearEditReferences}
              />
            ) : (
              image && (
                <button className="remove-slot" onClick={() => props.onRemove(slot.key)}>
                  <X size={14} />
                  Remove
                </button>
              )
            )}
          </div>
        );
      })}
    </section>
  );
}

function BatchThumbs(props: { images: ReferenceImage[]; onRemove: (id: string) => void; onClear: () => void }) {
  return (
    <div className="batch-thumbs">
      <div>
        {props.images.map((image) => (
          <button key={image.id} onClick={() => props.onRemove(image.id)} title={`Remove ${image.name}`}>
            <img src={image.dataUrl} alt={`${image.name} thumbnail`} />
            <X size={12} />
          </button>
        ))}
      </div>
      <button className="remove-slot" onClick={props.onClear}>
        <Trash2 size={14} />
        Clear all
      </button>
    </div>
  );
}

function StepLabel(props: { number: string; label: string }) {
  return (
    <div className="step-label">
      <span>{props.number}</span>
      <p>{props.label}</p>
    </div>
  );
}

function BatchSummary(props: {
  batch: GenerationJob;
  expanded: boolean;
  onToggle: () => void;
  onDismiss: () => void;
  onRetry?: () => void;
}) {
  const running = props.batch.tasks.filter((task) => task.status === "running").length;
  const done = props.batch.tasks.filter((task) => task.status === "done").length;
  const failed = props.batch.tasks.filter((task) => task.status === "error");
  const progress = Math.round(((done + failed.length) / props.batch.tasks.length) * 100);
  const lastError = failed[0]?.message;
  const lastSuccess = props.batch.tasks.find((task) => task.status === "done")?.label;

  return (
    <section className={failed.length ? "batch-summary has-error" : "batch-summary"}>
      <div className="batch-summary-row">
        <div className="batch-main">
          <span>{running ? <Loader2 className="spin" size={16} /> : failed.length ? <X size={16} /> : <Check size={16} />}</span>
          <div>
            <strong>{props.batch.title}</strong>
            <p>
              {running} running · {done} done · {failed.length} failed
              {lastError ? ` · ${failed[0].label}: ${lastError}` : lastSuccess && !running ? ` · Last success: ${lastSuccess}` : ""}
            </p>
          </div>
        </div>
        <div className="batch-meter" aria-label={`${progress}% complete`}>
          <i style={{ width: `${progress}%` }} />
        </div>
        <div className="batch-actions">
          {props.onRetry && <button onClick={props.onRetry}>Retry failed</button>}
          <button onClick={props.onToggle}>{props.expanded ? "Collapse" : "Details"}</button>
          <button onClick={props.onDismiss}>Hide</button>
        </div>
      </div>
      {props.expanded && (
        <div className="batch-details">
          {props.batch.tasks.map((task) => (
            <div className={`batch-detail ${task.status}`} key={task.id}>
              <span>{task.status === "running" ? <Loader2 className="spin" size={14} /> : task.status === "done" ? <Check size={14} /> : <X size={14} />}</span>
              <div>
                <strong>{task.label}</strong>
                <p>
                  {task.status === "running"
                    ? "Running..."
                    : task.status === "done"
                      ? "Completed successfully."
                      : task.message || "Failed with an unknown error."}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function GalleryToolbar(props: {
  filter: "all" | "latest" | "errors";
  onFilter: (filter: "all" | "latest" | "errors") => void;
  results: GeneratedImage[];
  latestCount: number;
  onClear: () => void;
}) {
  return (
    <header className="gallery-toolbar">
      <div>
        <button className={props.filter === "all" ? "active" : ""} onClick={() => props.onFilter("all")}>
          All
        </button>
        <button className={props.filter === "latest" ? "active" : ""} onClick={() => props.onFilter("latest")}>
          Latest batch {props.latestCount ? `(${props.latestCount})` : ""}
        </button>
        <button className={props.filter === "errors" ? "active" : ""} onClick={() => props.onFilter("errors")}>
          Errors
        </button>
      </div>
      {props.results.length > 0 && (
        <button onClick={props.onClear}>
          <Trash2 size={14} />
          Clear
        </button>
      )}
    </header>
  );
}

function SettingsModal(props: {
  apiKey: string;
  rememberKey: boolean;
  apiStatus: "idle" | "checking" | "ready" | "error";
  apiMessage: string;
  models: typeof STUDIO_MODELS;
  onClose: () => void;
  onApiKey: (value: string) => void;
  onRemember: (value: boolean) => void;
  onTest: () => void;
}) {
  return (
    <div className="settings-backdrop" onClick={props.onClose}>
      <section className="settings-modal" onClick={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={props.onClose} aria-label="Close settings">
          <X size={20} />
        </button>
        <div>
          <p className="section-label">Connection</p>
          <h2>API Settings</h2>
        </div>
        <label className="settings-field">
          Gemini API key
          <input
            type="password"
            value={props.apiKey}
            onChange={(event) => props.onApiKey(event.target.value)}
            placeholder="Paste API key"
          />
        </label>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={props.rememberKey}
            onChange={(event) => props.onRemember(event.target.checked)}
          />
          Save key locally in this browser
        </label>
        <button className="generate-action" onClick={props.onTest} disabled={props.apiStatus === "checking"}>
          {props.apiStatus === "checking" ? <Loader2 className="spin" size={18} /> : <BadgeCheck size={18} />}
          Test key
        </button>
        <p className="settings-message">{props.apiMessage}</p>
        {props.models.length > 0 && (
          <div className="settings-models">
            {props.models.map((item) => (
              <span key={item.id}>
                <Check size={12} />
                {item.label}
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function composePrompt(feature: FeatureConfig, userPrompt: string) {
  const text = userPrompt.trim();
  switch (feature.id) {
    case "copyStyle":
      return [
        "TASK: Copy the environment, lighting, camera feel, and overall vibe from the style reference image.",
        "Use the outfit reference as the new clothing if provided. Use the face reference only for identity if provided.",
        `MODEL DESCRIPTION: ${text || "A realistic fashion model with a natural pose and expression."}`,
        "OUTPUT: Photorealistic editorial fashion image.",
      ].join("\n");
    case "edit":
      return [
        "TASK: Create or edit one final image using all uploaded reference images.",
        "Interpret the images in order as visual references. The user prompt defines which image provides the subject, outfit, background, style, pose, or object details.",
        "Preserve important visual details from the referenced images when requested, and blend them into a coherent photorealistic result.",
        `USER PROMPT: ${text}`,
      ].join("\n");
    case "ecommerce":
      return [
        "TASK: Generate a high-end e-commerce fashion photo.",
        "The model must wear the uploaded outfit accurately. Use a pure white professional studio background with clean commercial lighting.",
        `POSE AND DIRECTION: ${text || posePresets[0]}`,
      ].join("\n");
    case "extractOutfit":
      return [
        "TASK: Extract only the complete main outfit from the source image.",
        "Remove face, body parts, accessories, shoes, bags, jewelry, and background. Output ghost-mannequin clothing on pure white.",
        `NOTES: ${text}`,
      ].join("\n");
    case "studio":
      return [
        "TASK: Recreate the person from the source image in a clean white studio.",
        "Preserve identity, outfit, pose, crop, fabric texture, and realistic lighting. Replace only the background.",
        `NOTES: ${text}`,
      ].join("\n");
    default:
      return text;
  }
}

createRoot(document.getElementById("root")!).render(<App />);
