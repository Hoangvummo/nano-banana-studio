import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Aperture,
  BadgeCheck,
  Brush,
  ChevronRight,
  Download,
  Eraser,
  ImageIcon,
  KeyRound,
  Layers,
  Loader2,
  Maximize2,
  Palette,
  Plus,
  RefreshCw,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import { generateImage, isAbortError, listModels } from "./lib/gemini";
import {
  ASPECT_RATIOS,
  DEFAULT_MODEL,
  IMAGE_SIZES,
  STUDIO_MODELS,
  getModelCandidates,
  is1KOnlyModel,
  modelLabel,
  modelShortLabel,
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
  shortLabel: string;
  label: string;
  guide: string;
  icon: React.ElementType;
  slots: Array<{ key: SlotKey; label: string; help: string; role: ReferenceImage["role"] }>;
  promptLabel: string;
  placeholder: string;
  cta: string;
}

interface BatchTask {
  id: string;
  jobId: string;
  featureId: FeatureId;
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
    shortLabel: "Create",
    label: "Create Image",
    guide: "Nhập mô tả chi tiết (hoặc đính kèm ảnh tham chiếu tùy chọn) để tạo ảnh mới.",
    icon: Sparkles,
    slots: [],
    promptLabel: "Prompt",
    placeholder: "Mô tả bức ảnh bạn muốn tạo...",
    cta: "Generate",
  },
  {
    id: "copyStyle",
    shortLabel: "Style",
    label: "Style Copy",
    guide: "Tải lên ảnh mẫu phong cách (Style) và trang phục mới (Outfit), có thể kèm ảnh mặt (Face).",
    icon: Palette,
    slots: [
      { key: "style", label: "Style Ref", help: "Required", role: "style" },
      { key: "outfit", label: "Outfit", help: "Required", role: "outfit" },
      { key: "face", label: "Face", help: "Optional", role: "face" },
    ],
    promptLabel: "Model description",
    placeholder: "Mô tả thêm về người mẫu hoặc bối cảnh...",
    cta: "Copy Style",
  },
  {
    id: "edit",
    shortLabel: "Edit",
    label: "Custom Edit",
    guide: "Tải lên một hoặc nhiều ảnh tham chiếu, sau đó nhập yêu cầu chỉnh sửa hoặc ghép ảnh.",
    icon: Brush,
    slots: [{ key: "source", label: "References", help: "Up to 14", role: "source" }],
    promptLabel: "Edit instructions",
    placeholder: "Ví dụ: Dùng người ở ảnh 1, mặc bộ đồ ở ảnh 2...",
    cta: "Generate Edit",
  },
  {
    id: "ecommerce",
    shortLabel: "E-com",
    label: "E-Commerce",
    guide: "Tải ảnh trang phục mặt trước (bắt buộc), mặt sau và gương mặt mẫu để tạo ảnh lookbook nền trắng.",
    icon: Aperture,
    slots: [
      { key: "outfit", label: "Front Outfit", help: "Required", role: "outfit" },
      { key: "back", label: "Back Outfit", help: "Optional", role: "outfit" },
      { key: "face", label: "Model Face", help: "Optional", role: "face" },
    ],
    promptLabel: "Pose direction",
    placeholder: "Mô tả tư thế đứng, góc chụp studio nền trắng...",
    cta: "Create Photo",
  },
  {
    id: "extractOutfit",
    shortLabel: "Outfit",
    label: "Extract Outfit",
    guide: "Tải ảnh người mẫu đang mặc đồ để tách riêng bộ trang phục sang nền trắng tinh.",
    icon: Scissors,
    slots: [{ key: "source", label: "Model Photo", help: "Required", role: "source" }],
    promptLabel: "Extraction notes",
    placeholder: "Ghi chú thêm (tùy chọn): giữ nguyên form áo, xóa phụ kiện...",
    cta: "Extract",
  },
  {
    id: "studio",
    shortLabel: "Studio",
    label: "Studio Cutout",
    guide: "Tải lên hàng loạt ảnh người mẫu để tự động tách và đổi sang nền trắng studio theo hàng đợi.",
    icon: Eraser,
    slots: [{ key: "source", label: "Batch Photos", help: "Multi-upload", role: "source" }],
    promptLabel: "Studio direction",
    placeholder: "Ghi chú thêm (tùy chọn): giữ nguyên dáng, ánh sáng tự nhiên trên nền trắng...",
    cta: "Run Batch",
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
  const [rememberKey, setRememberKey] = useState(true);
  const [apiStatus, setApiStatus] = useState<"idle" | "checking" | "ready" | "error">("idle");
  const [apiMessage, setApiMessage] = useState("API key not tested yet.");
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  const [activeFeature, setActiveFeature] = useState<FeatureId>("create");
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL);
  const [modelDrawerOpen, setModelDrawerOpen] = useState(false);
  const [outputDrawerOpen, setOutputDrawerOpen] = useState(false);

  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("3:4");
  const [imageSize, setImageSize] = useState<ImageSize>("2K");
  const [count, setCount] = useState(1);
  const [concurrency, setConcurrency] = useState<number>(2);
  const [prompt, setPrompt] = useState("");

  const [slotImages, setSlotImages] = useState<Partial<Record<SlotKey, ReferenceImage>>>({});
  const [studioBatchImages, setStudioBatchImages] = useState<ReferenceImage[]>([]);
  const [editReferenceImages, setEditReferenceImages] = useState<ReferenceImage[]>([]);

  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [results, setResults] = useState<GeneratedImage[]>([]);
  const [canvasFilter, setCanvasFilter] = useState<"all" | "active" | "done">("all");
  const [cardMinWidth, setCardMinWidth] = useState<number>(290);
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);
  const [error, setError] = useState("");
  const [successToast, setSuccessToast] = useState("");

  const taskControllersRef = useRef<Map<string, AbortController>>(new Map());
  const cancelledTaskIdsRef = useRef<Set<string>>(new Set());

  const feature = useMemo(() => FEATURES.find((item) => item.id === activeFeature)!, [activeFeature]);
  const selectedModelInfo = useMemo(
    () => STUDIO_MODELS.find((item) => item.id === model) ?? STUDIO_MODELS[0],
    [model],
  );
  const slotRefs = useMemo(
    () => feature.slots.map((slot) => slotImages[slot.key]).filter((item): item is ReferenceImage => Boolean(item)),
    [feature, slotImages],
  );

  const totalUploadedRefs = useMemo(() => {
    if (activeFeature === "edit" || activeFeature === "create") return editReferenceImages.length;
    if (activeFeature === "studio") return studioBatchImages.length;
    return slotRefs.length;
  }, [activeFeature, editReferenceImages, studioBatchImages, slotRefs]);

  const liveTasks = useMemo(() => {
    return jobs.flatMap((j) => j.tasks).filter((t) => t.status !== "done");
  }, [jobs]);

  const activeRunningOrQueued = useMemo(() => {
    return liveTasks.filter((t) => t.status === "running" || t.status === "queued");
  }, [liveTasks]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("nano-banana-api-key");
      if (saved) {
        setApiKey(saved);
        setRememberKey(true);
        setApiStatus("ready");
        setApiMessage("Saved API key loaded.");
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  useEffect(() => {
    if (is1KOnlyModel(model) && imageSize !== "1K") {
      setImageSize("1K");
    }
  }, [model, imageSize]);

  useEffect(() => {
    if (!successToast) return;
    const timer = window.setTimeout(() => setSuccessToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [successToast]);

  // Clipboard paste (Ctrl+V) support
  useEffect(() => {
    async function onPaste(e: ClipboardEvent) {
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

      if (feature.slots.length > 0) {
        const targetSlot = feature.slots.find((s) => !slotImages[s.key]) ?? feature.slots[0];
        await handleSlotFile(dt.files, targetSlot);
        setSuccessToast(`Đã dán ảnh vào ${targetSlot.label}`);
      } else {
        const refs = await Promise.all(Array.from(dt.files).map((file) => fileToReference(file, "source")));
        setEditReferenceImages((curr) => [...curr, ...refs]);
        setSuccessToast(`Đã đính kèm ${refs.length} ảnh tham chiếu`);
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [feature, slotImages]);

  async function handleTestKey() {
    if (!apiKey.trim()) {
      setError("Enter an API key first.");
      return;
    }
    setApiStatus("checking");
    setError("");
    setApiMessage("Verifying Nano Banana & Pro models...");

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

      if (imageModels.length > 0 && !hasModelAccess(names, model)) {
        setModel(imageModels[0].id);
      }

      setApiStatus("ready");
      setApiMessage(
        imageModels.length
          ? `${imageModels.length} Nano Banana models verified and ready.`
          : "API key saved. Models unlocked for direct generation.",
      );
      setSuccessToast("API key connected!");
      setSettingsOpen(false);
    } catch (err) {
      setApiStatus("error");
      setApiMessage("Could not validate this API key.");
      setError(err instanceof Error ? err.message : "Key check failed.");
    }
  }

  async function handleSlotFile(files: FileList | null, slot?: FeatureConfig["slots"][number]) {
    if (!files?.length) return;
    if (!slot || (activeFeature === "edit" && slot.key === "source") || activeFeature === "create") {
      const references = await Promise.all(
        Array.from(files).map((file) => fileToReference(file, slot?.role ?? "source")),
      );
      setEditReferenceImages((current) => [...current, ...references].slice(0, 14));
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

  function cancelTask(jobId: string, taskId: string) {
    cancelledTaskIdsRef.current.add(taskId);
    const controller = taskControllersRef.current.get(taskId);
    if (controller) {
      controller.abort();
      taskControllersRef.current.delete(taskId);
    }
    updateTaskInJob(jobId, taskId, {
      status: "cancelled",
      message: "Đã hủy tiến trình.",
    });
  }

  function dismissTask(jobId: string, taskId: string) {
    setJobs((current) =>
      current.map((job) =>
        job.id === jobId ? { ...job, tasks: job.tasks.filter((t) => t.id !== taskId) } : job,
      ),
    );
  }

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
            ? { ...t, status: "cancelled", message: "Đã dừng toàn bộ hàng đợi." }
            : t,
        ),
      })),
    );
    setSuccessToast("Đã dừng tất cả tiến trình đang chạy.");
  }

  async function executeTasksWithQueue(jobId: string, tasksToRun: BatchTask[]) {
    const maxWorkers = Math.max(1, Math.min(4, concurrency));
    let cursor = 0;

    async function worker() {
      while (cursor < tasksToRun.length) {
        const currentIndex = cursor;
        cursor += 1;
        const task = tasksToRun[currentIndex];
        if (!task) continue;

        if (cancelledTaskIdsRef.current.has(task.id)) {
          updateTaskInJob(jobId, task.id, {
            status: "cancelled",
            message: "Đã hủy trước khi chạy.",
          });
          continue;
        }

        const controller = new AbortController();
        taskControllersRef.current.set(task.id, controller);

        updateTaskInJob(jobId, task.id, {
          status: "running",
          message:
            task.model === "gemini-3-pro-image"
              ? "Nano Banana Pro đang suy luận bố cục..."
              : `Đang tạo bằng ${modelShortLabel(task.model)}...`,
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
            featureId: task.featureId,
            jobId,
          }));

          setResults((current) => [...taggedImages, ...current]);
          updateTaskInJob(jobId, task.id, {
            status: "done",
            message: "Hoàn tất",
            outputUrl: taggedImages[0]?.url,
          });
        } catch (err) {
          taskControllersRef.current.delete(task.id);
          if (isAbortError(err) || cancelledTaskIdsRef.current.has(task.id)) {
            updateTaskInJob(jobId, task.id, {
              status: "cancelled",
              message: "Đã hủy bởi người dùng.",
            });
          } else {
            const msg = err instanceof Error ? err.message : "Tạo ảnh thất bại.";
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

  async function handleGenerate() {
    if (!apiKey.trim()) {
      setError("Vui lòng bấm Connect API ở góc trên bên phải trước khi tạo ảnh.");
      setSettingsOpen(true);
      return;
    }

    setError("");

    if (activeFeature === "copyStyle" && (!slotImages.style || !slotImages.outfit)) {
      setError("Style Copy cần tải lên cả ảnh Style Ref và ảnh Outfit.");
      return;
    }
    if (activeFeature === "edit" && editReferenceImages.length === 0) {
      setError("Custom Edit cần tải lên ít nhất 1 ảnh tham chiếu.");
      return;
    }
    if (activeFeature === "ecommerce" && !slotImages.outfit) {
      setError("E-Commerce cần tải lên ảnh trang phục mặt trước (Front Outfit).");
      return;
    }
    if (activeFeature === "extractOutfit" && !slotImages.source) {
      setError("Extract Outfit cần tải lên ảnh người mẫu (Model Photo).");
      return;
    }
    if (activeFeature === "studio" && studioBatchImages.length === 0) {
      setError("Studio Cutout cần tải lên ít nhất 1 ảnh để chạy batch.");
      return;
    }

    const jobId = crypto.randomUUID();
    const activeReferences =
      activeFeature === "edit" || activeFeature === "create" ? editReferenceImages : slotRefs;
    const composedPrompt = composePrompt(feature, prompt, activeReferences);

    let tasks: BatchTask[] = [];

    if (activeFeature === "studio") {
      tasks = studioBatchImages.map((img, idx) => ({
        id: crypto.randomUUID(),
        jobId,
        featureId: activeFeature,
        label: img.name || `Studio #${idx + 1}`,
        status: "queued",
        message: `Đang chờ luồng (${concurrency}⚡)...`,
        source: img,
        model,
        prompt: composedPrompt,
        references: [img],
        aspectRatio,
        imageSize,
        count: 1,
      }));
    } else {
      tasks = Array.from({ length: Math.max(1, count) }, (_, idx) => ({
        id: crypto.randomUUID(),
        jobId,
        featureId: activeFeature,
        label: `${feature.shortLabel} #${idx + 1}`,
        status: "queued",
        message: `Đang chờ (${idx + 1}/${count})...`,
        source: activeReferences[0],
        model,
        prompt: composedPrompt,
        references: activeReferences,
        aspectRatio,
        imageSize,
        count: 1,
      }));
    }

    const newJob: GenerationJob = {
      id: jobId,
      title: `${feature.label} (${tasks.length})`,
      featureId: activeFeature,
      model,
      tasks,
      createdAt: Date.now(),
    };

    setJobs((current) => [newJob, ...current]);
    await executeTasksWithQueue(jobId, tasks);
  }

  async function retrySingleTask(task: BatchTask) {
    cancelledTaskIdsRef.current.delete(task.id);
    const resetTask: BatchTask = {
      ...task,
      status: "queued",
      message: "Đang thử lại...",
    };
    updateTaskInJob(task.jobId, task.id, resetTask);
    await executeTasksWithQueue(task.jobId, [resetTask]);
  }

  const visibleTasks = canvasFilter === "done" ? [] : liveTasks;
  const visibleImages = canvasFilter === "active" ? [] : results;
  const hasAnythingInGrid = visibleTasks.length > 0 || visibleImages.length > 0;

  return (
    <div className="openart-shell">
      {/* 1. MINIMAL TOP HEADER (Only Title & API Connection) */}
      <header className="openart-topbar">
        <div className="brand-logo-lockup">
          <span>Nano Banana Studio</span>
        </div>

        <div className="topbar-api-area">
          <div className="api-status-pill">
            <span className={`api-dot ${apiKey ? "ready" : ""}`} />
            <span>{apiKey ? `${modelShortLabel(model)} Ready` : "Chưa kết nối API"}</span>
          </div>

          <button type="button" className="api-connect-btn" onClick={() => setSettingsOpen(true)}>
            <KeyRound size={13} />
            <span>{apiKey ? "API Key" : "Connect API"}</span>
          </button>
        </div>
      </header>

      {/* 2. 3-COLUMN STUDIO BODY */}
      <div className="openart-body">
        {/* COLUMN 1: FAR-LEFT COMPACT ICON RAIL (Only the 6 Feature Buttons) */}
        <aside className="openart-icon-rail">
          {FEATURES.map((item) => {
            const Icon = item.icon;
            const isActive = activeFeature === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`rail-tool-btn ${isActive ? "active" : ""}`}
                title={item.label}
                onClick={() => setActiveFeature(item.id)}
              >
                <Icon size={18} />
                <span>{item.shortLabel}</span>
              </button>
            );
          })}
        </aside>

        {/* COLUMN 2: LEFT INSPECTOR PANEL (Static Title/Guide + Model + Upload/Prompt + Output + Generate) */}
        <aside className="openart-inspector">
          <div className="inspector-scroll">
            {/* Static Title & Usage Guide */}
            <div className="feature-intro-header">
              <h2>{feature.label}</h2>
              <p>{feature.guide}</p>
            </div>

            {/* Compact Model Selector Card (Single-line full names + scrollable list) */}
            <div className="compact-select-card">
              <button
                type="button"
                className="compact-select-trigger"
                onClick={() => setModelDrawerOpen((open) => !open)}
              >
                <div className="compact-trigger-left">
                  <div className="google-g-badge">G</div>
                  <div className="compact-trigger-labels">
                    <span>Model</span>
                    <strong>{selectedModelInfo.label}</strong>
                  </div>
                </div>
                <ChevronRight size={16} className={`chevron-icon ${modelDrawerOpen ? "rotated" : ""}`} />
              </button>

              {modelDrawerOpen && (
                <div className="compact-drawer-body model-scroll-list">
                  {STUDIO_MODELS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={`drawer-model-option compact-single-line ${model === m.id ? "selected" : ""}`}
                      onClick={() => {
                        setModel(m.id);
                        setModelDrawerOpen(false);
                      }}
                    >
                      <strong>{m.label}</strong>
                      {m.badge && <span className="drawer-model-badge">{m.badge}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Unified Upload + Prompt Box */}
            <div className="describe-unified-card">
              <div className="describe-header-row">
                <span>{feature.promptLabel}</span>
              </div>

              {/* Embedded Visual Reference Upload Box */}
              <div className="visual-ref-banner">
                {feature.slots.length > 1 ? (
                  <>
                    <div className="ref-banner-top">
                      <div className="ref-banner-left">
                        <div className="ref-stack-icon">
                          <Layers size={15} />
                        </div>
                        <div className="ref-banner-titles">
                          <strong>Ảnh tham chiếu</strong>
                          <small>Bấm chọn hoặc dán Ctrl+V</small>
                        </div>
                      </div>
                      <span className="ref-counter-tag">
                        {slotRefs.length}/{feature.slots.length}
                      </span>
                    </div>

                    <div className="ref-slots-mini-grid">
                      {feature.slots.map((slot) => {
                        const current = slotImages[slot.key];
                        return current ? (
                          <div key={slot.key} className="mini-slot-box">
                            <img src={current.dataUrl} alt={slot.label} />
                            <button
                              type="button"
                              className="mini-slot-remove"
                              onClick={() => removeSlotImage(slot.key)}
                            >
                              <X size={10} />
                            </button>
                          </div>
                        ) : (
                          <label key={slot.key} className="mini-slot-box">
                            <Plus size={13} />
                            <span>{slot.label}</span>
                            <input
                              type="file"
                              accept="image/*"
                              hidden
                              onChange={(e) => handleSlotFile(e.target.files, slot)}
                            />
                          </label>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <>
                    <label className="ref-banner-top">
                      <div className="ref-banner-left">
                        <div className="ref-stack-icon">
                          <Upload size={15} />
                        </div>
                        <div className="ref-banner-titles">
                          <strong>
                            Thêm ảnh tham chiếu{" "}
                            <span className="opt-pill">
                              {activeFeature === "create" ? "Tùy chọn" : "Bắt buộc"}
                            </span>
                          </strong>
                          <small>Tải ảnh lên hoặc dán Ctrl+V</small>
                        </div>
                      </div>
                      <span className="ref-counter-tag">
                        {totalUploadedRefs}/{activeFeature === "extractOutfit" ? 1 : 14}
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        multiple={activeFeature !== "extractOutfit"}
                        hidden
                        onChange={(e) => handleSlotFile(e.target.files, feature.slots[0])}
                      />
                    </label>

                    {activeFeature === "extractOutfit" && slotImages.source && (
                      <div className="uploaded-thumbs-row">
                        <div className="uploaded-thumb-chip">
                          <img src={slotImages.source.dataUrl} alt="source" />
                          <button type="button" onClick={() => removeSlotImage("source")}>
                            <X size={10} />
                          </button>
                        </div>
                      </div>
                    )}

                    {(activeFeature === "create" || activeFeature === "edit") &&
                      editReferenceImages.length > 0 && (
                        <div className="uploaded-thumbs-row">
                          {editReferenceImages.map((item) => (
                            <div key={item.id} className="uploaded-thumb-chip">
                              <img src={item.dataUrl} alt={item.name} />
                              <button
                                type="button"
                                onClick={() =>
                                  setEditReferenceImages((list) => list.filter((x) => x.id !== item.id))
                                }
                              >
                                <X size={10} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                    {activeFeature === "studio" && studioBatchImages.length > 0 && (
                      <div className="uploaded-thumbs-row">
                        {studioBatchImages.map((item) => (
                          <div key={item.id} className="uploaded-thumb-chip">
                            <img src={item.dataUrl} alt={item.name} />
                            <button
                              type="button"
                              onClick={() =>
                                setStudioBatchImages((list) => list.filter((x) => x.id !== item.id))
                              }
                            >
                              <X size={10} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Prompt Textarea */}
              <textarea
                className="openart-prompt-textarea"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={feature.placeholder}
              />

              {/* Simple Utility Actions */}
              <div className="prompt-inner-toolbar">
                <div className="prompt-tool-icons">
                  <button
                    type="button"
                    className="mini-icon-action"
                    title="Gợi ý prompt ngẫu nhiên"
                    onClick={() => setPrompt(randomPrompt())}
                  >
                    <WandSparkles size={12} />
                    <span>Ngẫu nhiên</span>
                  </button>
                  {activeFeature === "ecommerce" && (
                    <button
                      type="button"
                      className="mini-icon-action"
                      title="Chọn mẫu dáng đứng"
                      onClick={() =>
                        setPrompt(posePresets[Math.floor(Math.random() * posePresets.length)])
                      }
                    >
                      <Aperture size={12} />
                      <span>Dáng mẫu</span>
                    </button>
                  )}
                  {prompt && (
                    <button
                      type="button"
                      className="mini-icon-action"
                      title="Xóa prompt"
                      onClick={() => setPrompt("")}
                    >
                      <Trash2 size={12} />
                      <span>Xóa</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Compact Output Summary Card */}
            <div className="compact-select-card">
              <button
                type="button"
                className="compact-select-trigger"
                onClick={() => setOutputDrawerOpen((open) => !open)}
              >
                <div className="compact-trigger-left">
                  <div className="google-g-badge">
                    <SlidersHorizontal size={14} />
                  </div>
                  <div className="compact-trigger-labels">
                    <span>Output</span>
                    <strong>
                      {aspectRatio} | {imageSize} | {concurrency}⚡
                    </strong>
                  </div>
                </div>
                <ChevronRight size={16} className={`chevron-icon ${outputDrawerOpen ? "rotated" : ""}`} />
              </button>

              {outputDrawerOpen && (
                <div className="compact-drawer-body">
                  <div className="output-param-section">
                    <span className="output-param-label">Tỷ lệ khung hình</span>
                    <div className="output-pills-grid">
                      {ASPECT_RATIOS.map((ratio) => (
                        <button
                          key={ratio}
                          type="button"
                          className={`out-pill-btn ${aspectRatio === ratio ? "active" : ""}`}
                          onClick={() => setAspectRatio(ratio)}
                        >
                          {ratio}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="output-param-section">
                    <span className="output-param-label">Chất lượng ảnh</span>
                    <div className="output-pills-grid">
                      {IMAGE_SIZES.map((size) => (
                        <button
                          key={size}
                          type="button"
                          className={`out-pill-btn ${imageSize === size ? "active" : ""}`}
                          onClick={() => setImageSize(size)}
                          disabled={is1KOnlyModel(model) && size !== "1K"}
                        >
                          {size}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="output-param-section">
                    <span className="output-param-label">Số luồng chạy song song</span>
                    <div className="output-pills-row">
                      {[1, 2, 3, 4].map((c) => (
                        <button
                          key={c}
                          type="button"
                          className={`out-pill-btn ${concurrency === c ? "active" : ""}`}
                          onClick={() => setConcurrency(c)}
                        >
                          {c}⚡
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Sticky Bottom Action Bar */}
          <div className="inspector-footer">
            {activeFeature !== "studio" && (
              <div className="count-stepper" title="Số lượng ảnh tạo">
                <button
                  type="button"
                  className="stepper-btn"
                  onClick={() => setCount((c) => Math.max(1, c - 1))}
                >
                  −
                </button>
                <span className="stepper-val">
                  {count}
                  <small>/4</small>
                </span>
                <button
                  type="button"
                  className="stepper-btn"
                  onClick={() => setCount((c) => Math.min(4, c + 1))}
                >
                  +
                </button>
              </div>
            )}

            <button type="button" className="openart-generate-btn" onClick={handleGenerate}>
              <Sparkles size={15} />
              <span>
                {feature.cta}{" "}
                {activeFeature === "studio" && studioBatchImages.length > 0
                  ? `(${studioBatchImages.length})`
                  : ""}
              </span>
            </button>

            {activeRunningOrQueued.length > 0 && (
              <button
                type="button"
                className="openart-stop-btn"
                title="Dừng toàn bộ tiến trình"
                onClick={cancelAllJobs}
              >
                <Square size={13} fill="currentColor" />
                <span>Dừng</span>
              </button>
            )}
          </div>
        </aside>

        {/* COLUMN 3: MASSIVE RIGHT MAIN CANVAS */}
        <main className="openart-canvas-area">
          <div className="canvas-subtoolbar">
            <div className="canvas-filter-pills">
              <button
                type="button"
                className={`canvas-tab-pill ${canvasFilter === "all" ? "active" : ""}`}
                onClick={() => setCanvasFilter("all")}
              >
                <span>Tất cả ({results.length + liveTasks.length})</span>
              </button>
              {activeRunningOrQueued.length > 0 && (
                <button
                  type="button"
                  className={`canvas-tab-pill ${canvasFilter === "active" ? "active" : ""}`}
                  onClick={() => setCanvasFilter("active")}
                >
                  <span>Đang tạo ({activeRunningOrQueued.length})</span>
                </button>
              )}
            </div>

            <div className="canvas-toolbar-right">
              <div className="zoom-slider-wrap" title="Chỉnh kích thước hiển thị ảnh">
                <ImageIcon size={13} />
                <input
                  type="range"
                  min={200}
                  max={520}
                  step={20}
                  value={cardMinWidth}
                  onChange={(e) => setCardMinWidth(Number(e.target.value))}
                />
                <Maximize2 size={13} />
              </div>

              {results.length > 0 && (
                <button
                  type="button"
                  className="canvas-tab-pill"
                  onClick={() => setResults([])}
                >
                  <Trash2 size={13} />
                  <span>Xóa hết</span>
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="canvas-alert-strip error">
              <span>{error}</span>
              <button type="button" onClick={() => setError("")}>
                <X size={15} />
              </button>
            </div>
          )}

          {successToast && (
            <div className="canvas-alert-strip toast">
              <span>{successToast}</span>
            </div>
          )}

          <div className="canvas-gallery-scroll">
            {!hasAnythingInGrid ? (
              <div className="openart-empty-state">
                <div className="empty-stack-icon">
                  <ImageIcon size={26} />
                </div>
                <h2>Chưa có ảnh nào</h2>
                <p>Nhập prompt ở cột bên trái và bấm Generate để bắt đầu tạo ảnh.</p>
              </div>
            ) : (
              <div
                className="openart-live-grid"
                style={{
                  gridTemplateColumns: `repeat(auto-fill, minmax(${cardMinWidth}px, 1fr))`,
                }}
              >
                {/* 1. LIVE GENERATING / QUEUED / FAILED CARDS */}
                {visibleTasks.map((task) => {
                  const isRunningOrQueued = task.status === "running" || task.status === "queued";

                  if (isRunningOrQueued) {
                    return (
                      <article
                        key={task.id}
                        className="studio-grid-card generating-card"
                        style={{ aspectRatio: toCssAspectRatio(task.aspectRatio) }}
                      >
                        <div className="generating-card-inner">
                          {task.source?.dataUrl && (
                            <img src={task.source.dataUrl} alt="ref" className="gen-bg-blur" />
                          )}

                          <div className="gen-top-bar">
                            <span className="gen-live-pill">
                              <Loader2 size={12} className="spin" />
                              <span>{task.status === "running" ? "ĐANG TẠO" : "ĐANG CHỜ"}</span>
                            </span>

                            <button
                              type="button"
                              className="gen-cancel-btn"
                              title="Hủy ảnh này"
                              onClick={() => cancelTask(task.jobId, task.id)}
                            >
                              <X size={14} />
                            </button>
                          </div>

                          <div className="gen-center-status">
                            <div className="gen-pulse-orb">
                              <Sparkles size={20} />
                            </div>
                            <strong>{task.label}</strong>
                            <p>{task.message || "Đang xử lý..."}</p>
                          </div>

                          <div className="gen-bottom-meta">
                            <span>{modelShortLabel(task.model)}</span>
                            <span>
                              {task.aspectRatio} · {task.imageSize}
                            </span>
                          </div>
                        </div>
                      </article>
                    );
                  }

                  return (
                    <article
                      key={task.id}
                      className="studio-grid-card failed-card"
                      style={{ aspectRatio: toCssAspectRatio(task.aspectRatio) }}
                    >
                      <div className="gen-top-bar">
                        <span className="gen-live-pill" style={{ color: "#fecaca", borderColor: "#ef4444" }}>
                          {task.status === "cancelled" ? "ĐÃ HỦY" : "LỖI"}
                        </span>
                        <button
                          type="button"
                          className="gen-cancel-btn"
                          title="Xóa thẻ này"
                          onClick={() => dismissTask(task.jobId, task.id)}
                        >
                          <X size={14} />
                        </button>
                      </div>

                      <div className="gen-center-status">
                        <strong>{task.label}</strong>
                        <p>{task.message || "Tác vụ đã dừng."}</p>
                        <button
                          type="button"
                          className="empty-sample-btn"
                          onClick={() => retrySingleTask(task)}
                        >
                          <RefreshCw size={12} style={{ marginRight: 6, display: "inline" }} />
                          Thử lại
                        </button>
                      </div>

                      <div className="gen-bottom-meta">
                        <span>{modelShortLabel(task.model)}</span>
                        <span>{task.imageSize}</span>
                      </div>
                    </article>
                  );
                })}

                {/* 2. COMPLETED IMAGE CARDS */}
                {visibleImages.map((img) => {
                  const featObj = FEATURES.find((f) => f.id === img.featureId);
                  return (
                    <article
                      key={img.id}
                      className="studio-grid-card"
                      style={{ aspectRatio: toCssAspectRatio(img.aspectRatio) }}
                      onClick={() => setSelectedImage(img)}
                    >
                      <div className="completed-card-media">
                        <img src={img.url} alt={img.prompt} loading="lazy" />

                        <div className="card-hover-overlay">
                          <div className="overlay-top-actions">
                            <span className="overlay-model-pill">{modelShortLabel(img.model)}</span>

                            <div className="overlay-icon-btns">
                              <button
                                type="button"
                                className="overlay-circle-btn"
                                title="Phóng to"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedImage(img);
                                }}
                              >
                                <Maximize2 size={13} />
                              </button>
                              <button
                                type="button"
                                className="overlay-circle-btn"
                                title="Tải ảnh về"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  downloadDataUrl(img.url, `nano-banana-${img.id.slice(0, 6)}.png`);
                                }}
                              >
                                <Download size={13} />
                              </button>
                              <button
                                type="button"
                                className="overlay-circle-btn"
                                title="Xóa ảnh"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setResults((list) => list.filter((x) => x.id !== img.id));
                                }}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>

                          <div className="overlay-bottom-info">
                            <p>{cleanDisplayPrompt(img.prompt)}</p>
                            <div className="overlay-tags">
                              <span>{featObj?.shortLabel ?? "Studio"}</span>
                              <span>{img.aspectRatio ?? "3:4"}</span>
                              <span>{img.imageSize ?? "2K"}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>

          {activeRunningOrQueued.length > 0 && (
            <div className="floating-queue-dock">
              <Loader2 size={15} className="spin" style={{ color: "#38bdf8" }} />
              <span>
                Đang chạy {activeRunningOrQueued.filter((t) => t.status === "running").length}/
                {activeRunningOrQueued.length} ảnh ({concurrency}⚡ luồng)
              </span>
              <button type="button" className="dock-stop-btn" onClick={cancelAllJobs}>
                Hủy tất cả
              </button>
            </div>
          )}
        </main>
      </div>

      {/* API KEY SETTINGS MODAL */}
      {settingsOpen && (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="settings-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>Kết nối Gemini API Key</h3>
                <p>Nhập Google AI Studio key (`AIza...`) hoặc Vertex Express key (`AQ...`)</p>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setSettingsOpen(false)}>
                <X size={15} />
              </button>
            </div>

            <div className="modal-body">
              <label className="modal-field-label">Gemini API Key</label>
              <div className="api-input-row">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Dán Gemini API key vào đây..."
                />
                <button
                  type="button"
                  className="api-connect-btn"
                  onClick={handleTestKey}
                  disabled={apiStatus === "checking"}
                >
                  {apiStatus === "checking" ? <Loader2 size={14} className="spin" /> : <BadgeCheck size={14} />}
                  <span>{apiStatus === "checking" ? "Đang kiểm tra..." : "Lưu & Kiểm tra"}</span>
                </button>
              </div>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={rememberKey}
                  onChange={(e) => setRememberKey(e.target.checked)}
                />
                <span>Lưu API key trên trình duyệt này</span>
              </label>

              <div className={`api-status-box status-${apiStatus}`}>
                <span>{apiMessage}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FULLSCREEN IMAGE ZOOM LIGHTBOX */}
      {selectedImage && (
        <div className="modal-backdrop" onClick={() => setSelectedImage(null)}>
          <div className="lightbox-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="lightbox-media">
              <img src={selectedImage.url} alt={selectedImage.prompt} />
            </div>
            <div className="lightbox-sidebar">
              <div className="modal-header">
                <div>
                  <h3>{modelLabel(selectedImage.model)}</h3>
                  <p>Xem chi tiết và tải ảnh độ phân giải gốc</p>
                </div>
                <button type="button" className="modal-close-btn" onClick={() => setSelectedImage(null)}>
                  <X size={15} />
                </button>
              </div>

              <div className="lightbox-prompt">{cleanDisplayPrompt(selectedImage.prompt)}</div>

              <div className="lightbox-meta-chips">
                <span>Model: {modelShortLabel(selectedImage.model)}</span>
                <span>Tỷ lệ: {selectedImage.aspectRatio ?? "3:4"}</span>
                <span>Chất lượng: {selectedImage.imageSize ?? "2K"}</span>
              </div>

              <button
                type="button"
                className="openart-generate-btn"
                onClick={() => downloadDataUrl(selectedImage.url, `nano-banana-${selectedImage.id.slice(0, 6)}.png`)}
              >
                <Download size={16} />
                <span>Tải ảnh PNG</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function toCssAspectRatio(ratio?: AspectRatio): string {
  switch (ratio) {
    case "1:1":
      return "1 / 1";
    case "4:3":
      return "4 / 3";
    case "9:16":
      return "9 / 16";
    case "16:9":
      return "16 / 9";
    case "3:4":
    default:
      return "3 / 4";
  }
}

function cleanDisplayPrompt(raw: string): string {
  return (
    raw
      .replace(/^TASK:.*$/gim, "")
      .replace(/^FACE CONTROL:.*$/gim, "")
      .replace(/^OUTPUT:.*$/gim, "")
      .trim() || raw
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
