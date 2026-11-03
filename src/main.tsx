import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Aperture,
  BadgeCheck,
  Bell,
  Brush,
  Check,
  ChevronDown,
  ChevronRight,
  Cpu,
  Download,
  Eraser,
  Flame,
  Gauge,
  HelpCircle,
  ImageIcon,
  KeyRound,
  Layers,
  Loader2,
  Maximize2,
  OctagonX,
  Palette,
  PauseCircle,
  Plus,
  RefreshCw,
  Scissors,
  Search,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  Upload,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { generateImage, isAbortError, listModels } from "./lib/gemini";
import {
  ASPECT_RATIOS,
  DEFAULT_MODEL,
  IMAGE_SIZES,
  STUDIO_MODELS,
  getModelCandidates,
  modelLabel,
} from "./lib/models";
import { downloadDataUrl, fileToReference } from "./lib/image";
import { randomPrompt } from "./lib/prompt";
import type { AspectRatio, GeneratedImage, ImageSize, ModelId, ReferenceImage } from "./types";
import "./styles.css";

type FeatureId = "create" | "copyStyle" | "edit" | "ecommerce" | "extractOutfit" | "studio";
type SlotKey = "face" | "outfit" | "style" | "source" | "back";
type TaskStatus = "queued" | "running" | "done" | "error" | "cancelled";

interface FeatureConfig {
  id: FeatureId;
  label: string;
  subtitle: string;
  tag: string;
  accentColor: string;
  group: "menu" | "tools";
  icon: React.ElementType;
  slots: Array<{ key: SlotKey; label: string; help: string; role: ReferenceImage["role"]; large?: boolean }>;
  promptLabel: string;
  placeholder: string;
  cta: string;
}

interface BatchTask {
  id: string;
  label: string;
  status: TaskStatus;
  message?: string;
  source?: ReferenceImage;
  outputUrl?: string;
  model: ModelId;
  prompt: string;
  references: ReferenceImage[];
  aspectRatio: AspectRatio;
  imageSize: ImageSize;
  count: number;
}

interface GenerationJob {
  id: string;
  title: string;
  featureId: FeatureId;
  model: ModelId;
  tasks: BatchTask[];
  createdAt: number;
}

const FEATURES: FeatureConfig[] = [
  {
    id: "create",
    label: "Create Art",
    subtitle: "Prompt to studio image",
    tag: "#promptGen",
    accentColor: "#4361ee",
    group: "menu",
    icon: Sparkles,
    slots: [],
    promptLabel: "Creative Prompt",
    placeholder: "Describe the subject, lighting, camera lens, and mood you want to create...",
    cta: "Generate Image",
  },
  {
    id: "copyStyle",
    label: "Style Copy",
    subtitle: "Copy vibe, swap outfit & face",
    tag: "#styleTransfer",
    accentColor: "#ec4899",
    group: "menu",
    icon: Palette,
    slots: [
      { key: "style", label: "Style Reference", help: "Copy environment & vibe", role: "style" },
      { key: "outfit", label: "New Outfit", help: "Upload garment", role: "outfit" },
      { key: "face", label: "Model Face", help: "Optional face identity", role: "face", large: true },
    ],
    promptLabel: "Model & Scene Direction",
    placeholder: "Example: A stylish Vietnamese model, relaxed editorial posture, natural skin tone.",
    cta: "Run Style Copy",
  },
  {
    id: "edit",
    label: "Custom Edit",
    subtitle: "Multi-reference fusion",
    tag: "#multiRefEdit",
    accentColor: "#06b6d4",
    group: "menu",
    icon: Brush,
    slots: [{ key: "source", label: "Reference Images", help: "Upload multiple refs", role: "source", large: true }],
    promptLabel: "Custom Fusion Prompt",
    placeholder:
      "Example: Use image 1 as the main subject, image 2 for the outfit, and image 3 for the lighting atmosphere.",
    cta: "Generate Custom Edit",
  },
  {
    id: "ecommerce",
    label: "E-Commerce",
    subtitle: "Lookbook & catalog models",
    tag: "#ecommercePro",
    accentColor: "#8b5cf6",
    group: "tools",
    icon: Aperture,
    slots: [
      { key: "outfit", label: "Front Outfit", help: "Required garment", role: "outfit" },
      { key: "back", label: "Back Outfit", help: "Optional back view", role: "outfit" },
      { key: "face", label: "Model Face", help: "Optional identity", role: "face", large: true },
    ],
    promptLabel: "Catalog Pose Direction",
    placeholder: "Example: Full body, eye-level, clean white studio background, natural commercial pose.",
    cta: "Create Catalog Photo",
  },
  {
    id: "extractOutfit",
    label: "Extract Outfit",
    subtitle: "Ghost mannequin on white",
    tag: "#outfitCutout",
    accentColor: "#f59e0b",
    group: "tools",
    icon: Scissors,
    slots: [{ key: "source", label: "Model Photo", help: "Extract clothing", role: "source", large: true }],
    promptLabel: "Extraction Notes",
    placeholder: "Optional: keep front view, remove body parts and accessories, pure white background.",
    cta: "Extract Garment",
  },
  {
    id: "studio",
    label: "Studio Cutout",
    subtitle: "Batch white-studio queue",
    tag: "#batchStudio",
    accentColor: "#10b981",
    group: "tools",
    icon: Eraser,
    slots: [{ key: "source", label: "Batch Model Photos", help: "Upload multiple photos", role: "source", large: true }],
    promptLabel: "Batch Studio Direction",
    placeholder: "Optional: keep identity, outfit, pose, and crop. Replace background with pure white studio.",
    cta: "Launch Batch Queue",
  },
];

const posePresets = [
  "Full body, eye-level, front-facing, balanced commercial pose, pure white studio background.",
  "Full body, three-quarter view, one hand relaxed near the waist, premium catalog pose.",
  "Back view fashion pose, head slightly turned over shoulder, clean white studio background.",
];

function handleSpotlightMove(e: React.MouseEvent<HTMLElement>) {
  const el = e.currentTarget;
  const rect = el.getBoundingClientRect();
  el.style.setProperty("--mx", `${e.clientX - rect.left}px`);
  el.style.setProperty("--my", `${e.clientY - rect.top}px`);
}

function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [rememberKey, setRememberKey] = useState(true);
  const [apiStatus, setApiStatus] = useState<"idle" | "checking" | "ready" | "error">("idle");
  const [apiMessage, setApiMessage] = useState("API key not tested yet.");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [activeFeature, setActiveFeature] = useState<FeatureId>("create");
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("3:4");
  const [imageSize, setImageSize] = useState<ImageSize>("2K");
  const [count, setCount] = useState(1);
  const [concurrency, setConcurrency] = useState<number>(2);
  const [prompt, setPrompt] = useState(() => randomPrompt());
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryPill, setCategoryPill] = useState<"all" | FeatureId | "pro">("all");
  const [slotImages, setSlotImages] = useState<Partial<Record<SlotKey, ReferenceImage>>>({});
  const [studioBatchImages, setStudioBatchImages] = useState<ReferenceImage[]>([]);
  const [editReferenceImages, setEditReferenceImages] = useState<ReferenceImage[]>([]);
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [expandedJobIds, setExpandedJobIds] = useState<string[]>([]);
  const [results, setResults] = useState<GeneratedImage[]>([]);
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);
  const [error, setError] = useState("");
  const [successToast, setSuccessToast] = useState("");

  // Refs for Batch Queue & Cancellation (AbortController)
  const taskControllersRef = useRef<Map<string, AbortController>>(new Map());
  const cancelledTaskIdsRef = useRef<Set<string>>(new Set());

  const feature = useMemo(() => FEATURES.find((item) => item.id === activeFeature)!, [activeFeature]);
  const refs = useMemo(
    () => feature.slots.map((slot) => slotImages[slot.key]).filter((item): item is ReferenceImage => Boolean(item)),
    [feature, slotImages],
  );

  // Compute global batch telemetry metrics for the radial gauge widget
  const queueMetrics = useMemo(() => {
    const allTasks = jobs.flatMap((j) => j.tasks);
    const total = allTasks.length;
    const running = allTasks.filter((t) => t.status === "running").length;
    const queued = allTasks.filter((t) => t.status === "queued").length;
    const done = allTasks.filter((t) => t.status === "done").length;
    const failed = allTasks.filter((t) => t.status === "error").length;
    const cancelled = allTasks.filter((t) => t.status === "cancelled").length;
    const activeCount = running + queued;
    const finishedCount = done + failed + cancelled;
    const percentage = total > 0 ? Math.round((finishedCount / total) * 100) : apiStatus === "ready" ? 100 : 65;
    return { total, running, queued, done, failed, cancelled, activeCount, finishedCount, percentage };
  }, [jobs, apiStatus]);

  const filteredResults = useMemo(() => {
    return results.filter((img) => {
      if (categoryPill === "pro" && img.model !== "gemini-3-pro-image") return false;
      if (categoryPill !== "all" && categoryPill !== "pro" && img.featureId && img.featureId !== categoryPill) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const inPrompt = img.prompt.toLowerCase().includes(q);
        const inModel = modelLabel(img.model).toLowerCase().includes(q);
        const inFeature = (img.featureId ?? "").toLowerCase().includes(q);
        return inPrompt || inModel || inFeature;
      }
      return true;
    });
  }, [results, categoryPill, searchQuery]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("nano-banana-api-key");
      if (saved) {
        setApiKey(saved);
        setRememberKey(true);
        setApiMessage("Saved API key loaded. Ready for generation.");
      }
    } catch {
      // Ignore storage access errors in restricted frames
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
    const timer = window.setTimeout(() => setSuccessToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [successToast]);

  // Clipboard paste (Ctrl+V) support for quick reference uploads
  useEffect(() => {
    async function onPaste(e: ClipboardEvent) {
      if (!feature.slots.length) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i += 1) {
        if (items[i].type.startsWith("image/")) {
          const f = items[i].getAsFile();
          if (f) imageFiles.push(f);
        }
      }
      if (!imageFiles.length) return;
      const dt = new DataTransfer();
      imageFiles.forEach((f) => dt.items.add(f));
      const targetSlot = feature.slots.find((s) => !slotImages[s.key]) ?? feature.slots[0];
      await handleSlotFile(dt.files, targetSlot);
      setSuccessToast(`Pasted ${imageFiles.length} image(s) into ${targetSlot.label}`);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [feature, slotImages, activeFeature]);

  async function handleTestKey() {
    if (!apiKey.trim()) {
      setError("Enter an API key first.");
      return;
    }
    setApiStatus("checking");
    setError("");
    setApiMessage("Checking Nano Banana & Pro model access...");

    try {
      const models = await listModels(apiKey.trim());
      const names = models.map((item) => item.name);
      const imageModels = STUDIO_MODELS.filter((item) => hasModelAccess(names, item.id));
      setAvailableModels(names);

      try {
        if (rememberKey) localStorage.setItem("nano-banana-api-key", apiKey.trim());
        else localStorage.removeItem("nano-banana-api-key");
      } catch {
        // Ignore storage errors
      }

      if (!imageModels.length) {
        // Even if model listing doesn't show preview aliases, allow user to generate directly
        setApiStatus("ready");
        setApiMessage("API key saved. All Nano Banana models unlocked for direct generation.");
        setSuccessToast("API key connected!");
        return;
      }

      if (!hasModelAccess(names, model)) setModel(imageModels[0].id);

      setApiStatus("ready");
      setApiMessage(`${imageModels.length} Nano Banana models verified (${imageModels.map((m) => m.label).join(", ")}).`);
      setSuccessToast("API key verified & ready!");
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

  function updateTaskInJob(jobId: string, taskId: string, patch: Partial<BatchTask>) {
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

  // Cancel a single queued or running task
  function cancelTask(jobId: string, taskId: string) {
    cancelledTaskIdsRef.current.add(taskId);
    const controller = taskControllersRef.current.get(taskId);
    if (controller) {
      controller.abort();
      taskControllersRef.current.delete(taskId);
    }
    updateTaskInJob(jobId, taskId, {
      status: "cancelled",
      message: "Cancelled by user.",
    });
  }

  // Cancel all tasks in a specific job
  function cancelJob(jobId: string) {
    const targetJob = jobs.find((j) => j.id === jobId);
    if (!targetJob) return;

    for (const task of targetJob.tasks) {
      if (task.status === "queued" || task.status === "running") {
        cancelledTaskIdsRef.current.add(task.id);
        const controller = taskControllersRef.current.get(task.id);
        if (controller) {
          controller.abort();
          taskControllersRef.current.delete(task.id);
        }
      }
    }

    setJobs((current) =>
      current.map((job) =>
        job.id === jobId
          ? {
              ...job,
              tasks: job.tasks.map((t) =>
                t.status === "queued" || t.status === "running"
                  ? { ...t, status: "cancelled", message: "Batch stopped by user." }
                  : t,
              ),
            }
          : job,
      ),
    );
    setSuccessToast("Stopped active batch tasks.");
  }

  // Emergency Stop All across all running jobs
  function cancelAllJobs() {
    for (const [taskId, controller] of taskControllersRef.current.entries()) {
      cancelledTaskIdsRef.current.add(taskId);
      controller.abort();
    }
    taskControllersRef.current.clear();

    setJobs((current) =>
      current.map((job) => ({
        ...job,
        tasks: job.tasks.map((t) =>
          t.status === "queued" || t.status === "running"
            ? { ...t, status: "cancelled", message: "Stopped all queues." }
            : t,
        ),
      })),
    );
    setSuccessToast("All running & queued tasks cancelled.");
  }

  // Controlled Concurrency Worker Pool
  async function executeTasksWithQueue(jobId: string, tasksToRun: BatchTask[]) {
    const maxWorkers = Math.max(1, Math.min(4, concurrency));
    let cursor = 0;

    async function worker() {
      while (cursor < tasksToRun.length) {
        const currentIndex = cursor;
        cursor += 1;
        const task = tasksToRun[currentIndex];
        if (!task) continue;

        // Skip immediately if cancelled while waiting in queue
        if (cancelledTaskIdsRef.current.has(task.id)) {
          updateTaskInJob(jobId, task.id, {
            status: "cancelled",
            message: "Cancelled before start.",
          });
          continue;
        }

        const controller = new AbortController();
        taskControllersRef.current.set(task.id, controller);

        updateTaskInJob(jobId, task.id, {
          status: "running",
          message:
            task.model === "gemini-3-pro-image"
              ? "Nano Banana Pro initializing deep reasoning..."
              : `Generating with ${modelLabel(task.model)}...`,
        });

        try {
          const generatedList = await generateImage({
            apiKey: apiKey.trim(),
            model: task.model,
            prompt: task.prompt,
            references: task.references,
            aspectRatio: task.aspectRatio,
            imageSize: task.imageSize,
            count: task.count,
            signal: controller.signal,
            onStatus: (statusText) => {
              updateTaskInJob(jobId, task.id, { message: statusText });
            },
          });

          taskControllersRef.current.delete(task.id);

          const taggedImages: GeneratedImage[] = generatedList.map((img) => ({
            ...img,
            featureId: activeFeature,
            jobId,
          }));

          setResults((current) => [...taggedImages, ...current]);
          updateTaskInJob(jobId, task.id, {
            status: "done",
            message: `Completed (${taggedImages.length} image${taggedImages.length > 1 ? "s" : ""})`,
            outputUrl: taggedImages[0]?.url,
          });
        } catch (err) {
          taskControllersRef.current.delete(task.id);
          if (isAbortError(err) || cancelledTaskIdsRef.current.has(task.id)) {
            updateTaskInJob(jobId, task.id, {
              status: "cancelled",
              message: "Cancelled by user.",
            });
          } else {
            const msg = err instanceof Error ? err.message : "Generation failed.";
            updateTaskInJob(jobId, task.id, {
              status: "error",
              message: msg,
            });
            setError(msg);
          }
        }
      }
    }

    const workers = Array.from({ length: Math.min(maxWorkers, tasksToRun.length) }, () => worker());
    await Promise.all(workers);
  }

  async function handleGenerate(batchOverride?: ReferenceImage[]) {
    if (!apiKey.trim()) {
      setError("Please enter your Gemini API key in Settings before generating.");
      setSettingsOpen(true);
      return;
    }

    setError("");

    // Validate required references per feature
    if (activeFeature === "copyStyle" && (!slotImages.style || !slotImages.outfit)) {
      setError("Style Copy requires both a Style Reference and a New Outfit image.");
      return;
    }
    if (activeFeature === "edit" && editReferenceImages.length === 0) {
      setError("Custom Edit requires at least 1 reference image.");
      return;
    }
    if (activeFeature === "ecommerce" && !slotImages.outfit) {
      setError("E-Commerce mode requires at least a Front Outfit image.");
      return;
    }
    if (activeFeature === "extractOutfit" && !slotImages.source) {
      setError("Extract Outfit requires a source Model Photo.");
      return;
    }

    const batchList = batchOverride ?? studioBatchImages;
    if (activeFeature === "studio" && batchList.length === 0) {
      setError("Upload at least 1 photo to run the Studio Cutout batch queue.");
      return;
    }

    const jobId = crypto.randomUUID();
    const activeReferences = activeFeature === "edit" ? editReferenceImages : refs;
    const composedPrompt = composePrompt(feature, prompt, activeReferences);

    let tasks: BatchTask[] = [];

    if (activeFeature === "studio") {
      tasks = batchList.map((img, idx) => ({
        id: crypto.randomUUID(),
        label: img.name || `Studio Cutout #${idx + 1}`,
        status: "queued",
        message: `Waiting in queue (max ${concurrency} parallel)...`,
        source: img,
        model,
        prompt: composedPrompt,
        references: [img],
        aspectRatio,
        imageSize,
        count: 1,
      }));
    } else if (count > 1) {
      // Split multi-image count into individual queue tasks so each can be tracked, parallelized & cancelled!
      tasks = Array.from({ length: count }, (_, idx) => ({
        id: crypto.randomUUID(),
        label: `${feature.label} • Variation #${idx + 1}`,
        status: "queued",
        message: `Queued (slot ${idx + 1}/${count})...`,
        source: activeReferences[0],
        model,
        prompt: composedPrompt,
        references: activeReferences,
        aspectRatio,
        imageSize,
        count: 1,
      }));
    } else {
      tasks = [
        {
          id: crypto.randomUUID(),
          label: `${feature.label} • ${modelLabel(model)}`,
          status: "queued",
          message: "Preparing task...",
          source: activeReferences[0],
          model,
          prompt: composedPrompt,
          references: activeReferences,
          aspectRatio,
          imageSize,
          count: 1,
        },
      ];
    }

    const newJob: GenerationJob = {
      id: jobId,
      title: `${feature.label} (${tasks.length} task${tasks.length > 1 ? "s" : ""})`,
      featureId: activeFeature,
      model,
      tasks,
      createdAt: Date.now(),
    };

    setJobs((current) => [newJob, ...current]);
    setExpandedJobIds((current) => [jobId, ...current]);

    await executeTasksWithQueue(jobId, tasks);
  }

  async function retryFailed(job: GenerationJob) {
    const retryable = job.tasks.filter((t) => t.status === "error" || t.status === "cancelled");
    if (!retryable.length) return;

    const resetTasks: BatchTask[] = retryable.map((t) => {
      cancelledTaskIdsRef.current.delete(t.id);
      return {
        ...t,
        status: "queued",
        message: "Re-queued for retry...",
      };
    });

    setJobs((current) =>
      current.map((j) =>
        j.id === job.id
          ? {
              ...j,
              tasks: j.tasks.map((t) => {
                const found = resetTasks.find((r) => r.id === t.id);
                return found ?? t;
              }),
            }
          : j,
      ),
    );

    await executeTasksWithQueue(job.id, resetTasks);
  }

  const gaugeRadius = 58;
  const gaugeCircumference = 2 * Math.PI * gaugeRadius;
  const gaugeDashOffset =
    gaugeCircumference - (Math.min(100, Math.max(5, queueMetrics.percentage)) / 100) * gaugeCircumference;

  return (
    <div className="aimage-shell">
      {/* LEFT SIDEBAR NAVIGATION (Inspired by Aimage! dark vertical sidebar) */}
      <aside className="aimage-sidebar">
        <div className="brand-header">
          <div className="brand-prism">
            <Sparkles size={18} />
          </div>
          <span className="brand-title">NanoBanana!</span>
        </div>

        <div className="nav-group">
          <div className="nav-group-label">MENU</div>
          {FEATURES.filter((f) => f.group === "menu").map((item) => {
            const Icon = item.icon;
            const isActive = activeFeature === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`sidebar-pill-btn ${isActive ? "active" : ""}`}
                onClick={() => setActiveFeature(item.id)}
              >
                <Icon size={17} className="sidebar-pill-icon" />
                <div className="sidebar-pill-text">
                  <span>{item.label}</span>
                  <small>{item.subtitle}</small>
                </div>
              </button>
            );
          })}
        </div>

        <div className="nav-group">
          <div className="nav-group-label">STUDIO TOOLS</div>
          {FEATURES.filter((f) => f.group === "tools").map((item) => {
            const Icon = item.icon;
            const isActive = activeFeature === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`sidebar-pill-btn ${isActive ? "active" : ""}`}
                onClick={() => setActiveFeature(item.id)}
              >
                <Icon size={17} className="sidebar-pill-icon" />
                <div className="sidebar-pill-text">
                  <span>{item.label}</span>
                  <small>{item.subtitle}</small>
                </div>
              </button>
            );
          })}
        </div>

        <div className="nav-group nav-group-bottom">
          <div className="nav-group-label">OTHERS</div>
          <button
            type="button"
            className={`sidebar-pill-btn ${settingsOpen ? "active" : ""}`}
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 size={17} className="sidebar-pill-icon" />
            <div className="sidebar-pill-text">
              <span>API Settings</span>
              <small>{apiKey ? "Key configured" : "Connect Gemini"}</small>
            </div>
          </button>

          {queueMetrics.activeCount > 0 && (
            <button type="button" className="sidebar-stop-all-btn" onClick={cancelAllJobs}>
              <OctagonX size={16} />
              <span>Stop Queue ({queueMetrics.activeCount})</span>
            </button>
          )}
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="aimage-main">
        {/* TOP HEADER BAR */}
        <header className="aimage-topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="circle-icon-btn"
              title="Randomize Prompt"
              onClick={() => setPrompt(randomPrompt())}
            >
              <WandSparkles size={16} />
            </button>
            <div className="status-chip">
              <span className={`status-dot ${apiKey ? "online" : "idle"}`} />
              <span>{modelLabel(model)}</span>
              {model === "gemini-3-pro-image" && <span className="pro-mini-tag">PRO REASONING</span>}
            </div>
          </div>

          <div className="topbar-right">
            <div className="search-pill-box">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by prompt, model, or #tag..."
              />
              {searchQuery ? (
                <button type="button" className="search-circle-btn" onClick={() => setSearchQuery("")}>
                  <X size={15} />
                </button>
              ) : (
                <button type="button" className="search-circle-btn" aria-label="Search">
                  <Search size={15} />
                </button>
              )}
            </div>

            <button
              type="button"
              className="circle-icon-btn"
              title="API Key & Model Settings"
              onClick={() => setSettingsOpen(true)}
            >
              <KeyRound size={16} />
            </button>

            <button
              type="button"
              className="circle-icon-btn notification-btn"
              title="Active Batch Tasks"
              onClick={() => {
                const el = document.getElementById("batch-queue-section");
                el?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              <Bell size={16} />
              {queueMetrics.activeCount > 0 && <span className="notif-badge">{queueMetrics.activeCount}</span>}
            </button>

            <button
              type="button"
              className="avatar-pill-btn"
              title="Studio Settings"
              onClick={() => setSettingsOpen(true)}
            >
              <div className="avatar-ring">NB</div>
            </button>
          </div>
        </header>

        {/* TOAST & ERROR ALERTS */}
        {error && (
          <div className="banner-alert error-banner">
            <div className="banner-content">
              <OctagonX size={18} />
              <span>{error}</span>
            </div>
            <button type="button" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}

        {successToast && (
          <div className="banner-alert toast-banner">
            <BadgeCheck size={18} />
            <span>{successToast}</span>
          </div>
        )}

        {/* SECTION HEADER + CATEGORY PILL STRIP ("Generate Your AI") */}
        <section className="discover-section">
          <div className="section-title-row">
            <div>
              <h1 className="section-heading">Generate Your AI</h1>
              <p className="section-subtext">
                {feature.label} — {feature.subtitle} • Fixed Nano Banana Pro deep-thinking image pipeline
              </p>
            </div>
            <div className="model-quick-switcher">
              {STUDIO_MODELS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`model-chip-btn ${model === m.id ? "active" : ""}`}
                  onClick={() => setModel(m.id)}
                >
                  <Zap size={13} />
                  <span>{m.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* HORIZONTAL PILL FILTER BAR (Inspired by All / Design / Arts / Cinematic / Fantasy pills) */}
          <div className="category-pills-row">
            <button
              type="button"
              className={`cat-pill ${categoryPill === "all" ? "active" : ""}`}
              onClick={() => setCategoryPill("all")}
            >
              <span>All</span>
            </button>

            {FEATURES.map((item) => {
              const Icon = item.icon;
              const isSelected = activeFeature === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`cat-pill ${isSelected ? "active" : ""}`}
                  onClick={() => {
                    setActiveFeature(item.id);
                    setCategoryPill("all");
                  }}
                >
                  <span className="cat-pill-icon" style={{ background: `${item.accentColor}22`, color: item.accentColor }}>
                    <Icon size={14} />
                  </span>
                  <span>{item.label}</span>
                </button>
              );
            })}

            <button
              type="button"
              className={`cat-pill ${categoryPill === "pro" ? "active" : ""}`}
              onClick={() => setCategoryPill(categoryPill === "pro" ? "all" : "pro")}
            >
              <span className="cat-pill-icon" style={{ background: "rgba(67, 97, 238, 0.2)", color: "#60a5fa" }}>
                <Flame size={14} />
              </span>
              <span>Nano Banana Pro Only</span>
            </button>
          </div>
        </section>

        {/* WORKSPACE BUILDER CARD (Prompt + Reference Slots + Batch Controls) */}
        <section className="studio-builder-card spotlight-card" onMouseMove={handleSpotlightMove}>
          <div className="builder-grid">
            {/* LEFT: PROMPT & PARAMETERS */}
            <div className="builder-prompt-col">
              <div className="builder-label-row">
                <label className="builder-label">
                  <Sparkles size={15} className="text-electric" />
                  <span>{feature.promptLabel}</span>
                </label>
                <div className="prompt-helper-actions">
                  {activeFeature === "ecommerce" &&
                    posePresets.map((preset, idx) => (
                      <button
                        key={idx}
                        type="button"
                        className="mini-preset-pill"
                        onClick={() => setPrompt(preset)}
                      >
                        Pose {idx + 1}
                      </button>
                    ))}
                  <button type="button" className="mini-preset-pill" onClick={() => setPrompt(randomPrompt())}>
                    <WandSparkles size={12} />
                    <span>Surprise Me</span>
                  </button>
                </div>
              </div>

              <textarea
                className="studio-textarea"
                rows={4}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={feature.placeholder}
              />

              {/* PARAMETER BAR */}
              <div className="param-pills-bar">
                <div className="param-group">
                  <span className="param-caption">Aspect Ratio</span>
                  <div className="segmented-pills">
                    {ASPECT_RATIOS.map((ratio) => (
                      <button
                        key={ratio}
                        type="button"
                        className={`seg-pill ${aspectRatio === ratio ? "active" : ""}`}
                        onClick={() => setAspectRatio(ratio)}
                      >
                        {ratio}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="param-group">
                  <span className="param-caption">Resolution</span>
                  <div className="segmented-pills">
                    {IMAGE_SIZES.map((size) => (
                      <button
                        key={size}
                        type="button"
                        className={`seg-pill ${imageSize === size ? "active" : ""}`}
                        onClick={() => setImageSize(size)}
                        disabled={model === "gemini-2.5-flash-image" && size !== "1K"}
                        title={
                          model === "gemini-2.5-flash-image" && size !== "1K"
                            ? "Gemini 2.5 Flash only supports 1K"
                            : `Generate at ${size}`
                        }
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>

                {activeFeature !== "studio" && (
                  <div className="param-group">
                    <span className="param-caption">Variations</span>
                    <div className="segmented-pills">
                      {[1, 2, 3, 4].map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={`seg-pill ${count === n ? "active" : ""}`}
                          onClick={() => setCount(n)}
                        >
                          {n}x
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="param-group">
                  <span className="param-caption">Batch Threads</span>
                  <div className="segmented-pills">
                    {[1, 2, 3, 4].map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={`seg-pill ${concurrency === c ? "active" : ""}`}
                        onClick={() => setConcurrency(c)}
                        title={`Run up to ${c} tasks in parallel`}
                      >
                        {c}⚡
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* GENERATE & STOP CTA ROW */}
              <div className="cta-action-row">
                <button
                  type="button"
                  className="primary-generate-btn"
                  onClick={() => handleGenerate()}
                >
                  <Sparkles size={17} />
                  <span>{feature.cta}</span>
                  <span className="cta-sub-badge">{modelLabel(model)}</span>
                </button>

                {queueMetrics.activeCount > 0 && (
                  <button type="button" className="danger-stop-btn" onClick={cancelAllJobs}>
                    <Square size={15} fill="currentColor" />
                    <span>Cancel Active ({queueMetrics.activeCount})</span>
                  </button>
                )}
              </div>
            </div>

            {/* RIGHT: REFERENCE SLOTS / BATCH UPLOAD */}
            <div className="builder-refs-col">
              <div className="builder-label-row">
                <span className="builder-label">
                  <Layers size={15} className="text-electric" />
                  <span>
                    {feature.slots.length > 0
                      ? "Reference Inputs (Drag, Click or Ctrl+V)"
                      : "Pure Prompt Mode (No Reference Required)"}
                  </span>
                </span>
              </div>

              {feature.slots.length === 0 ? (
                <div className="empty-ref-showcase">
                  <div className="prism-orb" />
                  <p>
                    <strong>{modelLabel(model)}</strong> is ready for direct text-to-image synthesis. Switch to{" "}
                    <em>Style Copy</em>, <em>E-Commerce</em>, or <em>Studio Cutout</em> to attach reference photos.
                  </p>
                </div>
              ) : (
                <div className="slots-grid">
                  {feature.slots.map((slot) => {
                    const currentSingle = slotImages[slot.key];
                    const multiList =
                      activeFeature === "edit" && slot.key === "source"
                        ? editReferenceImages
                        : activeFeature === "studio" && slot.key === "source"
                          ? studioBatchImages
                          : null;

                    return (
                      <div key={slot.key} className={`ref-slot-card ${slot.large ? "slot-wide" : ""}`}>
                        <div className="slot-header">
                          <span className="slot-title">{slot.label}</span>
                          <span className="slot-badge">{slot.help}</span>
                        </div>

                        {multiList ? (
                          <div className="multi-upload-zone">
                            <label className="upload-drop-trigger">
                              <Upload size={18} />
                              <span>Add {slot.label}</span>
                              <input
                                type="file"
                                accept="image/*"
                                multiple
                                hidden
                                onChange={(e) => handleSlotFile(e.target.files, slot)}
                              />
                            </label>
                            {multiList.length > 0 && (
                              <div className="multi-thumb-strip">
                                {multiList.map((item) => (
                                  <div key={item.id} className="mini-ref-thumb">
                                    <img src={item.dataUrl} alt={item.name} />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (activeFeature === "edit") {
                                          setEditReferenceImages((list) => list.filter((x) => x.id !== item.id));
                                        } else {
                                          setStudioBatchImages((list) => list.filter((x) => x.id !== item.id));
                                        }
                                      }}
                                    >
                                      <X size={12} />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : currentSingle ? (
                          <div className="single-slot-preview">
                            <img src={currentSingle.dataUrl} alt={currentSingle.name} />
                            <button
                              type="button"
                              className="slot-remove-btn"
                              onClick={() => removeSlotImage(slot.key)}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ) : (
                          <label className="upload-drop-trigger">
                            <Plus size={20} />
                            <span>Upload {slot.label}</span>
                            <input
                              type="file"
                              accept="image/*"
                              hidden
                              onChange={(e) => handleSlotFile(e.target.files, slot)}
                            />
                          </label>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* GALLERY CARDS ROW (Inspired by the 4 portrait cards in Aimage! screenshot) */}
        <section className="gallery-showcase-section">
          <div className="section-title-row">
            <h2 className="section-subheading">
              Generated Studio Gallery ({filteredResults.length})
            </h2>
            {results.length > 0 && (
              <button
                type="button"
                className="see-all-link"
                onClick={() => setResults([])}
              >
                <span>Clear Gallery</span>
                <ChevronRight size={14} />
              </button>
            )}
          </div>

          {filteredResults.length === 0 ? (
            <div className="empty-gallery-grid">
              {[
                {
                  title: "Neon editorial portrait with cobalt rim light & water reflections",
                  tag: "#3dDesign",
                  modelTag: "Nano Banana Pro",
                  gradient: "linear-gradient(135deg, #1d3557 0%, #4361ee 55%, #f72585 100%)",
                },
                {
                  title: "High-fashion lookbook street style on seamless studio backdrop",
                  tag: "#ecommercePro",
                  modelTag: "Nano Banana 2",
                  gradient: "linear-gradient(135deg, #0f172a 0%, #0284c7 55%, #38bdf8 100%)",
                },
                {
                  title: "Futuristic metallic outerwear with holographic fabric threads",
                  tag: "#styleTransfer",
                  modelTag: "Nano Banana Pro",
                  gradient: "linear-gradient(135deg, #311042 0%, #7209b7 55%, #4cc9f0 100%)",
                },
                {
                  title: "Underwater silhouette in front of electric blue diffused key light",
                  tag: "#reflective",
                  modelTag: "Nano Banana 2",
                  gradient: "linear-gradient(135deg, #0b132b 0%, #1c2541 50%, #3a506b 100%)",
                },
              ].map((demo, idx) => (
                <article
                  key={idx}
                  className="aimage-art-card demo-art-card spotlight-card"
                  onMouseMove={handleSpotlightMove}
                  onClick={() => setPrompt(demo.title)}
                >
                  <div className="art-card-media" style={{ background: demo.gradient }}>
                    <div className="art-card-shimmer" />
                    <span className="demo-badge">Click to try prompt</span>
                    <div className="avatar-stack-overlay">
                      <span className="avatar-dot" style={{ background: "#4361ee" }}>AI</span>
                      <span className="avatar-dot" style={{ background: "#ec4899" }}>2K</span>
                    </div>
                  </div>
                  <div className="art-card-body">
                    <p className="art-card-title">{demo.title}</p>
                    <div className="art-card-footer">
                      <span className="art-tag-pill">{demo.tag}</span>
                      <button
                        type="button"
                        className="art-download-circle"
                        title="Use this prompt"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPrompt(demo.title);
                          setSuccessToast("Loaded sample studio prompt!");
                        }}
                      >
                        <WandSparkles size={15} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="aimage-cards-grid">
              {filteredResults.map((img) => {
                const featObj = FEATURES.find((f) => f.id === img.featureId);
                return (
                  <article
                    key={img.id}
                    className="aimage-art-card spotlight-card"
                    onMouseMove={handleSpotlightMove}
                  >
                    <div className="art-card-media" onClick={() => setSelectedImage(img)}>
                      <img src={img.url} alt={img.prompt} loading="lazy" />
                      <button
                        type="button"
                        className="art-expand-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedImage(img);
                        }}
                      >
                        <Maximize2 size={14} />
                      </button>

                      {/* Overlapping Reference Thumbnails Stack (like Aimage! creator avatars) */}
                      <div className="avatar-stack-overlay">
                        {(img.referenceThumbnails ?? []).slice(0, 3).map((thumb, i) => (
                          <img key={i} src={thumb} alt="ref" className="avatar-stack-img" />
                        ))}
                        <span className="avatar-dot" title={modelLabel(img.model)}>
                          {img.model === "gemini-3-pro-image" ? "PRO" : "NB2"}
                        </span>
                      </div>
                    </div>

                    <div className="art-card-body">
                      <p className="art-card-title" title={img.prompt}>
                        {img.prompt.replace(/^(TASK:|USER PROMPT:|MODEL DESCRIPTION:)/im, "").trim() ||
                          "Studio generated artwork"}
                      </p>
                      <div className="art-card-footer">
                        <div className="art-tags-wrap">
                          <span className="art-tag-pill">{featObj?.tag ?? "#studioAI"}</span>
                          <span className="art-tag-pill">#{img.imageSize ?? "2K"}</span>
                        </div>
                        <button
                          type="button"
                          className="art-download-circle"
                          title="Download PNG"
                          onClick={() => downloadDataUrl(img.url, `nano-banana-${img.id.slice(0, 6)}.png`)}
                        >
                          <Download size={15} />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* BOTTOM 2-COLUMN DASHBOARD: "Batch Task Queue" (left) + "Your Queue Usage" Radial Ring (right) */}
        <section id="batch-queue-section" className="bottom-dashboard-grid">
          {/* LEFT WIDGET: BATCH QUEUE & ACTIVE TASKS (Inspired by "Top Creator" pill list) */}
          <div className="queue-stream-col">
            <div className="section-title-row">
              <h2 className="section-subheading">Batch Queue & Task Stream</h2>
              {jobs.length > 0 && (
                <button
                  type="button"
                  className="see-all-link"
                  onClick={() => setJobs([])}
                >
                  <span>Clear History</span>
                  <ChevronRight size={14} />
                </button>
              )}
            </div>

            {jobs.length === 0 ? (
              <div className="empty-queue-pill-list">
                {[
                  {
                    name: "Concurrency Worker Pool Ready",
                    sub: `Max ${concurrency} parallel streams • Auto-backoff retry enabled`,
                    badge: "IDLE",
                  },
                  {
                    name: "Nano Banana Pro Thought Filter Active",
                    sub: "Separates interim thought drafts from final 2K/4K render",
                    badge: "FIXED",
                  },
                  {
                    name: "Instant AbortController Cancellation",
                    sub: "Stop individual tasks or abort entire batch queue anytime",
                    badge: "READY",
                  },
                ].map((info, idx) => (
                  <div key={idx} className="creator-pill-row spotlight-card" onMouseMove={handleSpotlightMove}>
                    <div className="creator-avatar-wrap">
                      <div className="creator-icon-circle">
                        <Zap size={18} />
                      </div>
                      <span className="creator-heart-dot">✓</span>
                    </div>
                    <div className="creator-info">
                      <div className="creator-name-line">
                        <strong>{info.name}</strong>
                        <BadgeCheck size={15} className="verified-blue" />
                      </div>
                      <span className="creator-sub">{info.sub}</span>
                    </div>
                    <span className="queue-status-pill status-done">{info.badge}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="queue-jobs-stack">
                {jobs.map((job) => {
                  const hasActive = job.tasks.some((t) => t.status === "running" || t.status === "queued");
                  const hasFailedOrCancelled = job.tasks.some(
                    (t) => t.status === "error" || t.status === "cancelled",
                  );

                  return (
                    <div key={job.id} className="job-group-box">
                      <div className="job-group-header">
                        <div className="job-group-title">
                          <strong>{job.title}</strong>
                          <span className="job-model-tag">{modelLabel(job.model)}</span>
                        </div>
                        <div className="job-group-actions">
                          {hasFailedOrCancelled && (
                            <button
                              type="button"
                              className="mini-action-pill retry-pill"
                              onClick={() => retryFailed(job)}
                            >
                              <RefreshCw size={12} />
                              <span>Retry Failed</span>
                            </button>
                          )}
                          {hasActive && (
                            <button
                              type="button"
                              className="mini-action-pill cancel-pill"
                              onClick={() => cancelJob(job.id)}
                            >
                              <Square size={11} fill="currentColor" />
                              <span>Stop Job</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {job.tasks.map((task) => (
                        <div
                          key={task.id}
                          className={`creator-pill-row task-pill-${task.status} spotlight-card`}
                          onMouseMove={handleSpotlightMove}
                        >
                          <div className="creator-avatar-wrap">
                            {task.outputUrl || task.source?.dataUrl ? (
                              <img
                                src={task.outputUrl ?? task.source?.dataUrl}
                                alt={task.label}
                                className="creator-avatar-img"
                              />
                            ) : (
                              <div className="creator-icon-circle">
                                {task.status === "running" ? (
                                  <Loader2 size={18} className="spin" />
                                ) : (
                                  <ImageIcon size={18} />
                                )}
                              </div>
                            )}
                            <span className={`creator-heart-dot dot-${task.status}`}>
                              {task.status === "done" ? "✓" : task.status === "running" ? "⚡" : "•"}
                            </span>
                          </div>

                          <div className="creator-info">
                            <div className="creator-name-line">
                              <strong>{task.label}</strong>
                              {task.status === "done" && <BadgeCheck size={15} className="verified-blue" />}
                              {task.status === "running" && <Loader2 size={14} className="spin text-electric" />}
                            </div>
                            <span className="creator-sub">{task.message || task.status}</span>
                          </div>

                          <div className="creator-right-thumbs">
                            {task.source?.dataUrl && (
                              <img src={task.source.dataUrl} alt="in" className="mini-pair-thumb" />
                            )}
                            {task.outputUrl && (
                              <img src={task.outputUrl} alt="out" className="mini-pair-thumb" />
                            )}

                            {(task.status === "running" || task.status === "queued") && (
                              <button
                                type="button"
                                className="task-cancel-icon-btn"
                                title="Cancel this task"
                                onClick={() => cancelTask(job.id, task.id)}
                              >
                                <X size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* RIGHT WIDGET: YOUR USAGE / QUEUE TELEMETRY (Inspired by the radial gauge in Aimage!) */}
          <div className="usage-telemetry-col">
            <div className="section-title-row">
              <h2 className="section-subheading">Queue Telemetry</h2>
              <button type="button" className="see-all-link" onClick={() => setSettingsOpen(true)}>
                <span>Configure</span>
                <ChevronRight size={14} />
              </button>
            </div>

            <div className="usage-gauge-card spotlight-card" onMouseMove={handleSpotlightMove}>
              <div className="gauge-svg-wrap">
                <svg width="148" height="148" viewBox="0 0 148 148" className="radial-gauge-svg">
                  <defs>
                    <linearGradient id="electricBlueGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#4cc9f0" />
                      <stop offset="50%" stopColor="#4361ee" />
                      <stop offset="100%" stopColor="#3a0ca3" />
                    </linearGradient>
                  </defs>
                  <circle
                    cx="74"
                    cy="74"
                    r={gaugeRadius}
                    fill="none"
                    stroke="rgba(255, 255, 255, 0.06)"
                    strokeWidth="12"
                  />
                  <circle
                    cx="74"
                    cy="74"
                    r={gaugeRadius}
                    fill="none"
                    stroke="url(#electricBlueGrad)"
                    strokeWidth="12"
                    strokeLinecap="round"
                    strokeDasharray={gaugeCircumference}
                    strokeDashoffset={gaugeDashOffset}
                    transform="rotate(-125 74 74)"
                    className="gauge-progress-arc"
                  />
                </svg>
                <div className="gauge-center-text">
                  <span className="gauge-caption">Queue</span>
                  <strong className="gauge-percent">{queueMetrics.percentage}%</strong>
                  <span className="gauge-sub">
                    {queueMetrics.activeCount > 0 ? "processing" : "ready"}
                  </span>
                </div>
              </div>

              <div className="gauge-legend-col">
                <div className="legend-metric-item">
                  <span className="legend-dot blue-dot" />
                  <div>
                    <span className="legend-label">Completed / Active</span>
                    <strong className="legend-val">
                      {queueMetrics.done} Done • {queueMetrics.running} Live
                    </strong>
                  </div>
                </div>

                <div className="legend-metric-item">
                  <span className="legend-dot muted-dot" />
                  <div>
                    <span className="legend-label">Queued / Cancelled</span>
                    <strong className="legend-val">
                      {queueMetrics.queued} Wait • {queueMetrics.cancelled} Stopped
                    </strong>
                  </div>
                </div>

                <div className="telemetry-concurrency-box">
                  <span>Max Parallel Streams</span>
                  <div className="mini-concurrency-pills">
                    {[1, 2, 3, 4].map((n) => (
                      <button
                        key={n}
                        type="button"
                        className={concurrency === n ? "active" : ""}
                        onClick={() => setConcurrency(n)}
                      >
                        {n}x
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* SETTINGS MODAL */}
      {settingsOpen && (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="settings-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>Gemini & Vertex API Configuration</h3>
                <p>Connect your Google AI Studio key (`AIza...`) or Vertex Express key (`AQ...`)</p>
              </div>
              <button type="button" className="circle-icon-btn" onClick={() => setSettingsOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="modal-body">
              <label className="modal-field-label">Gemini API Key</label>
              <div className="api-input-row">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Paste your Gemini API key..."
                />
                <button
                  type="button"
                  className="primary-generate-btn compact-btn"
                  onClick={handleTestKey}
                  disabled={apiStatus === "checking"}
                >
                  {apiStatus === "checking" ? <Loader2 size={15} className="spin" /> : <BadgeCheck size={15} />}
                  <span>{apiStatus === "checking" ? "Testing..." : "Verify & Save"}</span>
                </button>
              </div>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={rememberKey}
                  onChange={(e) => setRememberKey(e.target.checked)}
                />
                <span>Remember API key in browser storage</span>
              </label>

              <div className={`api-status-box status-${apiStatus}`}>
                <span>{apiMessage}</span>
              </div>

              <div className="model-status-list">
                {STUDIO_MODELS.map((m) => {
                  const unlocked = availableModels.length === 0 || hasModelAccess(availableModels, m.id);
                  return (
                    <div
                      key={m.id}
                      className={`model-status-item ${model === m.id ? "selected" : ""}`}
                      onClick={() => setModel(m.id)}
                    >
                      <div>
                        <strong>{m.label}</strong>
                        <small>{m.description}</small>
                      </div>
                      <span className={`model-access-pill ${unlocked ? "ok" : "warn"}`}>
                        {model === m.id ? "Active" : unlocked ? "Ready" : "Select"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FULLSCREEN IMAGE PREVIEW MODAL */}
      {selectedImage && (
        <div className="modal-backdrop" onClick={() => setSelectedImage(null)}>
          <div className="lightbox-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="lightbox-media">
              <img src={selectedImage.url} alt={selectedImage.prompt} />
            </div>
            <div className="lightbox-sidebar">
              <div className="modal-header">
                <h3>{modelLabel(selectedImage.model)}</h3>
                <button type="button" className="circle-icon-btn" onClick={() => setSelectedImage(null)}>
                  <X size={16} />
                </button>
              </div>
              <p className="lightbox-prompt">{selectedImage.prompt}</p>
              <div className="lightbox-meta-chips">
                <span>Aspect: {selectedImage.aspectRatio ?? "3:4"}</span>
                <span>Size: {selectedImage.imageSize ?? "2K"}</span>
              </div>
              <button
                type="button"
                className="primary-generate-btn"
                onClick={() => downloadDataUrl(selectedImage.url, `nano-banana-${selectedImage.id.slice(0, 6)}.png`)}
              >
                <Download size={16} />
                <span>Download High-Res PNG</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function composePrompt(feature: FeatureConfig, userPrompt: string, references: ReferenceImage[] = []) {
  const text = userPrompt.trim();
  const hasFaceReference = references.some((reference) => reference.role === "face");
  switch (feature.id) {
    case "copyStyle":
      return [
        "TASK: Copy the environment, lighting, camera feel, and overall vibe from the style reference image.",
        "Preserve the model pose, body posture, crop, camera angle, and composition from the style reference image.",
        "Use the outfit reference only for the clothing and footwear: garment shape, fabric, color, pattern, fit, socks, and shoes.",
        "Do not copy jewelry, watches, bags, hats, glasses, makeup, tattoos, or other non-clothing accessories from the outfit reference.",
        "Do not copy the face, body identity, pose, background, lighting, or camera style from the outfit reference.",
        hasFaceReference
          ? "FACE CONTROL: A face reference is attached. The final image must use the facial appearance from the face reference: face shape, eyes, nose, mouth, hair style, skin tone."
          : "FACE CONTROL: No face reference is attached. Use the face/general facial look from the style reference when it contains a person. Otherwise create a natural model.",
        `MODEL DESCRIPTION: ${text || "A realistic fashion model with a natural pose and expression."}`,
        "OUTPUT: Photorealistic editorial fashion image.",
      ].join("\n");
    case "edit":
      return [
        "TASK: Create or edit one final image using all uploaded reference images.",
        "Interpret the images in order as visual references. The user prompt defines which image provides the subject, outfit, background, style, pose, or object.",
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

function hasModelAccess(names: string[], modelId: ModelId) {
  const candidates = getModelCandidates(modelId);
  return candidates.some((candidate) =>
    names.some(
      (name) => name === candidate || name === `models/${candidate}` || name.endsWith(`/models/${candidate}`),
    ),
  );
}

createRoot(document.getElementById("root")!).render(<App />);
