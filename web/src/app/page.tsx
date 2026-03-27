"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Papa from "papaparse";
import { Upload, FileText, Search, Activity, Loader2, Users, Boxes, ChevronRight, Square, Trash2, ArrowUp, MoveHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import NavRail from "./components/NavRail";
import WelcomeCanvas from "./components/WelcomeCanvas";
import WorkflowCanvas from "./components/WorkflowCanvas";
import DataroomCanvas from "./components/DataroomCanvas";
import Dropdown from "./components/Dropdown";
import { C, BEHAVIORAL_AXES, PRIMARY_FEATURES, CLOUD_FUNCTION_URL, DATASETS_URL, OPTIMIZATION_CACHE_STORAGE_KEY, type View, type ProfilerTab, type GeneratorTab } from "./components/theme";

export default function Home() {
  const [activeView, setActiveView] = useState<View>("welcome");
  const [profilerTab, setProfilerTab] = useState<ProfilerTab>("test");
  const [generatorTab, setGeneratorTab] = useState<GeneratorTab>("learn");
  const [agentChatDraft, setAgentChatDraft] = useState("");
  const [agentChatMessages, setAgentChatMessages] = useState<Array<{ id: string; role: "user" | "agent"; text: string; submittedAt: string }>>([]);
  const [agentChatLoading, setAgentChatLoading] = useState(false);
  const agentOptLastStep = useRef("");
  const agentOptDoneRef = useRef(false);
  const agentLearnAbortRef = useRef<AbortController | null>(null);
  const [pendingDeleteCatalog, _setPendingDeleteCatalog] = useState<string | null>(null);
  const pendingDeleteCatalogRef = useRef<string | null>(null);
  const setPendingDeleteCatalog = (v: string | null) => { pendingDeleteCatalogRef.current = v; _setPendingDeleteCatalog(v); };
  const [pendingDeleteIncentiveSet, _setPendingDeleteIncentiveSet] = useState<string | null>(null);
  const pendingDeleteIncentiveSetRef = useRef<string | null>(null);
  const setPendingDeleteIncentiveSet = (v: string | null) => { pendingDeleteIncentiveSetRef.current = v; _setPendingDeleteIncentiveSet(v); };

  // Custom computed columns for the Optimal Incentive Program grid
  // Each column: { id, label, expr, format }
  // expr is a function string referencing row fields: original_portfolio_ltv, new_gross_portfolio_ltv, portfolio_cost, lift, new_net_portfolio_ltv
  const [gridCustomColumns, setGridCustomColumns] = useState<Array<{
    id: string;
    label: string;
    expr: (r: any) => number;
    exprSource: string;          // human-readable formula
    format: "dollar" | "percent" | "ratio" | "number";
    totalsExpr?: "sum" | "avg" | "weighted";
  }>>([]);
  const [typedWelcomeLine, setTypedWelcomeLine] = useState("");
  const [splitRatio, setSplitRatio] = useState(50);
  const [isResizingSplit, setIsResizingSplit] = useState(false);
  const [isDesktopViewport, setIsDesktopViewport] = useState(false);
  const [showRecentCatalogDetail, setShowRecentCatalogDetail] = useState(false);
  const [showRecentIncentiveDetail, setShowRecentIncentiveDetail] = useState(false);

  // Test Users State
  const [testUserIds, setTestUserIds] = useState<string[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [testUsersLoading, setTestUsersLoading] = useState(false);

  // Upload State
  const [file, setFile] = useState<File | null>(null);
  const [customerId, setCustomerId] = useState("uploaded");

  // Common State
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [results, setResults] = useState<any>(null);
  const [error, setError] = useState("");

  // Profile Generator State
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState("");
  const [learnStatus, setLearnStatus] = useState("");
  const [learnInProgress, setLearnInProgress] = useState(false);
  const [learnSource, setLearnSource] = useState("uploaded");
  const [learnUploadFile, setLearnUploadFile] = useState<File | null>(null);
  const [learnUploadName, setLearnUploadName] = useState("");
  const [learnUploadSubmitted, setLearnUploadSubmitted] = useState(false);
  const [pendingUploadedPortfolioName, setPendingUploadedPortfolioName] = useState("");
  const [uploadedDatasets, setUploadedDatasets] = useState<any[]>([]);
  const [learnSourceAutoInitialized, setLearnSourceAutoInitialized] = useState(false);
  const [learnK, setLearnK] = useState(10);
  const [catalog, setCatalog] = useState<any>(null);
  const [catalogList, setCatalogList] = useState<any[]>([]);
  const [selectedCatalogVersion, setSelectedCatalogVersion] = useState("");

  // Optimization State
  const [optimizationId, setOptimizationId] = useState<string | null>(null);
  const [optimizationState, setOptimizationState] = useState<any>(null);
  const [optimizationPolling, setOptimizationPolling] = useState(false);
  const [optimizationStarting, setOptimizationStarting] = useState(false);
  const [optimizeInProgress, setOptimizeInProgress] = useState(false);
  const [optimizationStopPhase, setOptimizationStopPhase] = useState<"idle" | "cancelling" | "cleaning">("idle");
  const [savedOptimizations, setSavedOptimizations] = useState<any[]>([]);
  const [selectedSavedOptimizationId, setSelectedSavedOptimizationId] = useState<string | null>(null);
  const [showOptimizationProgress, setShowOptimizationProgress] = useState(false);

  // Incentive Set State
  const [incentiveSets, setIncentiveSets] = useState<any[]>([]);
  const [selectedIncentiveSetVersion, setSelectedIncentiveSetVersion] = useState("");
  const [selectedIncentiveSetDetail, setSelectedIncentiveSetDetail] = useState<any>(null);
  const [incentiveSetDetailLoading, setIncentiveSetDetailLoading] = useState(false);
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [activeWorkflow, setActiveWorkflow] = useState<{ id: string; name: string; description: string; detail: string } | null>(null);
  const [pendingDeleteWorkflow, _setPendingDeleteWorkflow] = useState<string | null>(null);
  const pendingDeleteWorkflowRef = useRef<string | null>(null);
  const setPendingDeleteWorkflow = (v: string | null) => { pendingDeleteWorkflowRef.current = v; _setPendingDeleteWorkflow(v); };
  // Multi-step workflow creation: awaiting_name → awaiting_description → awaiting_detail → create
  const [pendingCreateWorkflow, _setPendingCreateWorkflow] = useState<
    | { step: "awaiting_name" }
    | { step: "awaiting_description"; name: string }
    | { step: "awaiting_detail"; name: string; description: string }
    | null
  >(null);
  const pendingCreateWorkflowRef = useRef<typeof pendingCreateWorkflow>(null);
  const setPendingCreateWorkflow = (v: typeof pendingCreateWorkflow) => { pendingCreateWorkflowRef.current = v; _setPendingCreateWorkflow(v); };
  // Pending workflow selection for edit/delete: user picks a number from a listed set of custom workflows
  const [pendingWorkflowAction, _setPendingWorkflowAction] = useState<{ action: "edit" | "delete"; candidates: any[] } | null>(null);
  const pendingWorkflowActionRef = useRef<typeof pendingWorkflowAction>(null);
  const setPendingWorkflowAction = (v: typeof pendingWorkflowAction) => { pendingWorkflowActionRef.current = v; _setPendingWorkflowAction(v); };
  // Multi-step edit workflow: name → description → detail → save
  type PendingEdit = { workflow_id: string; name?: string; description?: string; step: "awaiting_description" | "awaiting_detail" } | null;
  const [pendingEditWorkflow, _setPendingEditWorkflow] = useState<PendingEdit>(null);
  const pendingEditWorkflowRef = useRef<PendingEdit>(null);
  const setPendingEditWorkflow = (v: PendingEdit) => { pendingEditWorkflowRef.current = v; _setPendingEditWorkflow(v); };
  const profilerAbortRef = useRef<AbortController | null>(null);
  const learnXhrRef = useRef<XMLHttpRequest | null>(null);
  const learnFetchAbortRef = useRef<AbortController | null>(null);
  const activeLearnUploadNameRef = useRef("");
  const activeLearnStartedAtRef = useRef("");
  const learnStopRequestedRef = useRef(false);
  const optimizationStartAbortRef = useRef<AbortController | null>(null);
  const optimizationStopRequestedRef = useRef(false);
  const optimizationCacheRef = useRef<Record<string, any>>({});
  const optimizationLatestByCatalogRef = useRef<Record<string, string>>({});
  const savedOptimizationsFetchSeqRef = useRef(0);
  const loadOptimizationFetchSeqRef = useRef(0);
  const optimizationCacheBootstrappedRef = useRef(false);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const agentChatScrollRef = useRef<HTMLDivElement | null>(null);

  if (!optimizationCacheBootstrappedRef.current && typeof window !== "undefined") {
    optimizationCacheBootstrappedRef.current = true;
    try {
      const raw = localStorage.getItem(OPTIMIZATION_CACHE_STORAGE_KEY)
        || sessionStorage.getItem("linex.optimizationCache.v1");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.cache && typeof parsed.cache === "object") {
          optimizationCacheRef.current = parsed.cache;
        }
        if (parsed?.latestByCatalog && typeof parsed.latestByCatalog === "object") {
          optimizationLatestByCatalogRef.current = parsed.latestByCatalog;
        }
      }
    } catch {
      // ignore browser cache read errors
    }
  }

  const updateOptimizationCache = useCallback((optimizationData: any, persist = false) => {
    const optimizationKey = String(optimizationData?.optimization_id || "");
    if (!optimizationKey) return;
    optimizationCacheRef.current[optimizationKey] = optimizationData;
    const catalogKey = String(optimizationData?.catalog_version || "");
    if (catalogKey) {
      optimizationLatestByCatalogRef.current[catalogKey] = optimizationKey;
    }
    if (persist) {
      try {
        const payload = JSON.stringify({
          cache: optimizationCacheRef.current,
          latestByCatalog: optimizationLatestByCatalogRef.current,
        });
        localStorage.setItem(OPTIMIZATION_CACHE_STORAGE_KEY, payload);
        sessionStorage.setItem("linex.optimizationCache.v1", payload);
      } catch {
        // best-effort browser cache only
      }
    }
  }, []);
  // Load test user IDs on mount
  useEffect(() => {
    fetchTestUsers();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(min-width: 768px)");
    const syncViewport = () => setIsDesktopViewport(media.matches);
    syncViewport();
    media.addEventListener("change", syncViewport);
    return () => media.removeEventListener("change", syncViewport);
  }, []);

  useEffect(() => {
    if (isDesktopViewport) return;
    setIsResizingSplit(false);
    setSplitRatio(50);
  }, [isDesktopViewport]);

  useEffect(() => {
    if (!isResizingSplit || !isDesktopViewport) return;

    const onMouseMove = (event: MouseEvent) => {
      const container = splitContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) return;
      const pct = ((event.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.min(75, Math.max(25, pct));
      setSplitRatio(clamped);
    };

    const onMouseUp = () => setIsResizingSplit(false);

    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isDesktopViewport, isResizingSplit]);

  const startSplitResize = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isDesktopViewport) return;
    event.preventDefault();
    setIsResizingSplit(true);
  };

  const fetchTestUsers = async () => {
    setTestUsersLoading(true);
    try {
      const res = await fetch(`${CLOUD_FUNCTION_URL}/list_test_users`);
      if (res.ok) {
        const data = await res.json();
        setTestUserIds(data.user_ids || []);
        if (data.user_ids?.length > 0) {
          setSelectedUserId(data.user_ids[0]);
        }
      }
    } catch {
      // Silently fail — test users may not be available
    } finally {
      setTestUsersLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const analyzeTestUser = async () => {
    if (!selectedUserId) return;
    const controller = new AbortController();
    profilerAbortRef.current = controller;
    setLoading(true);
    setLoadingStep("Profiling with Gemini...");
    setError("");
    setResults(null);
    try {
      const res = await fetch(`${CLOUD_FUNCTION_URL}/analyze_test_user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: selectedUserId }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to analyze test user");
      }
      setLoadingStep("Matching credit cards...");
      const data = await res.json();
      setResults(data);
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        setError(err.message || "An error occurred");
      }
    } finally {
      setLoading(false);
      setLoadingStep("");
      profilerAbortRef.current = null;
    }
  };

  const processFile = async () => {
    if (!file) return;
    const controller = new AbortController();
    profilerAbortRef.current = controller;

    setLoading(true);
    setError("");

    try {
      const text = await file.text();
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
      const transactions = parsed.data;

      const res = await fetch(`${CLOUD_FUNCTION_URL}/analyze_transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactions, customer_id: customerId }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error("Failed to analyze transactions");
      const data = await res.json();
      setResults(data);
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        setError(err.message || "An error occurred");
      }
    } finally {
      setLoading(false);
      profilerAbortRef.current = null;
    }
  };

  const stopProfilerProcess = () => {
    if (profilerAbortRef.current) {
      profilerAbortRef.current.abort();
      profilerAbortRef.current = null;
    }
    setLoading(false);
    setLoadingStep("");
    setResults(null);
    setError("");
  };

  const putFileToSignedUrlWithProgress = (
    uploadUrl: string,
    file: File,
    requiredHeaders: Record<string, string>,
    onProgress: (pct: number) => void,
    timeoutMs = 540000,
  ) => {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      learnXhrRef.current = xhr;
      xhr.open("PUT", uploadUrl, true);
      Object.entries(requiredHeaders || {}).forEach(([k, v]) => xhr.setRequestHeader(k, v));
      xhr.timeout = timeoutMs;
      xhr.upload.onprogress = (evt) => {
        if (!evt.lengthComputable) return;
        const pct = Math.max(0, Math.min(100, Math.round((evt.loaded / evt.total) * 100)));
        onProgress(pct);
      };
      xhr.ontimeout = () => {
        learnXhrRef.current = null;
        reject(new Error("Upload transfer timed out after 9 minutes."));
      };
      xhr.onerror = () => {
        learnXhrRef.current = null;
        reject(new Error("Network error during upload transfer"));
      };
      xhr.onload = () => {
        learnXhrRef.current = null;
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Upload transfer failed (HTTP ${xhr.status})`));
        }
      };
      xhr.send(file);
    });
  };

  const startBackendElapsedStatus = (label: string, details: string[] = []) => {
    const started = Date.now();
    let tickCount = 0;
    const tick = () => {
      const secs = Math.max(0, Math.floor((Date.now() - started) / 1000));
      const duration = secs < 60
        ? `${secs}s`
        : `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s`;
      let text = label;
      if (details.length > 0) {
        if (tickCount === 0) {
          text = label;
        } else {
          text = details[(tickCount - 1) % details.length];
        }
      }
      setLearnStatus(`${text} ${duration}`);
    };
    tick();
    const timer = setInterval(() => {
      tickCount += 1;
      tick();
    }, 2200);
    return () => clearInterval(timer);
  };

  const sleepWithAbort = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });

  const postLearnProfilesWithRetry = async (body: any, controller: AbortController) => {
    const maxAttempts = 6;
    let res: Response | null = null;
    let lastNetworkError: any = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        res = await fetch(`${CLOUD_FUNCTION_URL}/learn_profiles`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err: any) {
        if (err?.name === "AbortError") throw err;
        lastNetworkError = err;
        if (attempt === maxAttempts) {
          throw err;
        }
        setLearnStatus(`Learning... temporary network issue, retrying (${attempt}/${maxAttempts - 1})`);
        await sleepWithAbort(2000 * attempt, controller.signal);
        continue;
      }
      if (res.ok) return res;
      if (![502, 503, 504].includes(res.status) || attempt === maxAttempts) {
        return res;
      }
      setLearnStatus(`Connecting to learning service... retry ${attempt}/${maxAttempts - 1}`);
      await sleepWithAbort(2000 * attempt, controller.signal);
    }
    if (lastNetworkError) throw lastNetworkError;
    return res as Response;
  };

  // ---- Profile Generator handlers ----
  const learnProfiles = async () => {
    learnStopRequestedRef.current = false;
    setLearnInProgress(true);
    setGenLoading(true);
    setGenError("");
    setLearnStatus("Starting...");
    let stopElapsedStatus: (() => void) | null = null;
    activeLearnStartedAtRef.current = new Date().toISOString();
    try {
      let body: any = { source: learnSource, k: learnK };
      let currentUploadName = "";

      if (learnSource === "uploaded") {
        setLearnStatus("Preparing upload...");
        if (!learnUploadFile) {
          throw new Error("Upload a transaction CSV file to learn profiles");
        }
        currentUploadName = learnUploadName.trim();
        activeLearnUploadNameRef.current = currentUploadName;
        if (!currentUploadName) {
          throw new Error("Enter a name for this upload");
        }

        const uploadInitUrl = `${CLOUD_FUNCTION_URL}/create_portfolio_upload_url`;
        const uploadUrlRes = await fetch(uploadInitUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            upload_name: currentUploadName,
            file_name: learnUploadFile.name,
            content_type: learnUploadFile.type || "text/csv",
            size_bytes: learnUploadFile.size,
          }),
        });
        if (uploadUrlRes.ok) {
          const uploadMeta = await uploadUrlRes.json();
          const datasetId = String(uploadMeta.dataset_id || "");
          const uploadUrl = String(uploadMeta.upload_url || "");
          const requiredHeaders = uploadMeta.required_headers || {};
          if (!datasetId || !uploadUrl) {
            throw new Error("Upload initialization response missing dataset_id/upload_url");
          }

          setLearnStatus("Uploading... 0%");
          await putFileToSignedUrlWithProgress(
            uploadUrl,
            learnUploadFile,
            requiredHeaders,
            (pct) => setLearnStatus(`Uploading... ${pct}%`),
            540000,
          );
          setLearnUploadSubmitted(true);
          body = {
            source: "uploaded",
            k: learnK,
            upload_dataset_id: datasetId,
            upload_name: currentUploadName,
          };
        } else {
          const errData = await uploadUrlRes.json().catch(() => ({}));
          const detail = String(errData?.error || "").trim();
          const canFallbackToDirectCsv =
            /bucket does not exist|billing account.*disabled|storage/i.test(detail);
          if (!canFallbackToDirectCsv) {
            throw new Error(detail || `Failed to prepare upload (${uploadUrlRes.status}) at ${uploadInitUrl}`);
          }

          // Storage upload path unavailable (e.g., missing bucket/billing); send CSV directly.
          setLearnStatus("Storage unavailable. Sending CSV directly...");
          const csvText = await learnUploadFile.text();
          body = {
            source: "uploaded",
            k: learnK,
            upload_name: currentUploadName,
            csv_text: csvText,
          };
        }
      } else {
        setLearnStatus("Learning...");
      }

      let data: any;
      if (learnSource === "uploaded") {
        setPendingUploadedPortfolioName(currentUploadName);
        setLearnSource("uploaded-pending");
        setLearnStatus("Upload complete. Connecting to learning service...");
        stopElapsedStatus = startBackendElapsedStatus("Learning...");
        const controller = new AbortController();
        learnFetchAbortRef.current = controller;
        const timeoutId = setTimeout(() => controller.abort(), 540000);
        let res: Response;
        try {
          res = await postLearnProfilesWithRetry(body, controller);
        } finally {
          clearTimeout(timeoutId);
          learnFetchAbortRef.current = null;
        }
        if (!res.ok) {
          const raw = await res.text().catch(() => "");
          const looksLikeHtmlError = /<!doctype html|<html/i.test(raw);
          let errData: any = {};
          if (!looksLikeHtmlError) {
            try { errData = raw ? JSON.parse(raw) : {}; } catch { /* ignore */ }
          }
          const detail = looksLikeHtmlError ? "" : String(errData?.error || raw || "").trim();
          const msg = detail
            ? `Learning failed (${res.status}): ${detail}`
            : `Learning failed (${res.status}): Service temporarily unavailable. Please retry.`;
          throw new Error(msg);
        }
        data = await res.json();
      } else {
        stopElapsedStatus = startBackendElapsedStatus("Learning...");
        const controller = new AbortController();
        learnFetchAbortRef.current = controller;
        const timeoutId = setTimeout(() => controller.abort(), 540000);
        let res: Response;
        try {
          res = await postLearnProfilesWithRetry(body, controller);
        } finally {
          clearTimeout(timeoutId);
          learnFetchAbortRef.current = null;
        }
        if (!res.ok) {
          const raw = await res.text().catch(() => "");
          const looksLikeHtmlError = /<!doctype html|<html/i.test(raw);
          let errData: any = {};
          if (!looksLikeHtmlError) {
            try { errData = raw ? JSON.parse(raw) : {}; } catch { /* ignore */ }
          }
          const detail = looksLikeHtmlError ? "" : String(errData?.error || raw || "").trim();
          const msg = detail
            ? `Learning failed (${res.status}): ${detail}`
            : `Learning failed (${res.status}): Service temporarily unavailable. Please retry.`;
          throw new Error(msg);
        }
        data = await res.json();
      }
      setCatalog(data);
      if (data?.upload_dataset_id) {
        setPendingUploadedPortfolioName("");
        setLearnSource(`uploaded-dataset:${data.upload_dataset_id}`);
      }
      if (stopElapsedStatus) {
        stopElapsedStatus();
        stopElapsedStatus = null;
      }
      setLearnStatus("Learn complete.");
      setSelectedCatalogVersion(data.version);
      setGeneratorTab("optimize");
      fetchCatalogList();
      fetchUploadedDatasets();
    } catch (err: any) {
      if (learnStopRequestedRef.current) {
        setGenError("");
      } else if (err?.name === "AbortError") {
        setGenError("Learning request timed out after 9 minutes. Try a smaller file.");
      } else {
        setGenError(err.message || "Learning failed");
      }
    } finally {
      if (stopElapsedStatus) stopElapsedStatus();
      learnXhrRef.current = null;
      learnFetchAbortRef.current = null;
      activeLearnUploadNameRef.current = "";
      activeLearnStartedAtRef.current = "";
      learnStopRequestedRef.current = false;
      setGenLoading(false);
      setLearnStatus("");
      setLearnUploadSubmitted(false);
      setLearnInProgress(false);
    }
  };

  const cleanupStoppedLearnData = async () => {
    const uploadName = activeLearnUploadNameRef.current.trim();
    const startedAt = activeLearnStartedAtRef.current;
    if (!uploadName || !startedAt) return;

    try {
      const res = await fetch(`${CLOUD_FUNCTION_URL}/list_portfolio_datasets`);
      if (!res.ok) return;
      const data = await res.json();
      const datasets = data.datasets || [];
      const startedMs = Date.parse(startedAt);
      const candidates = datasets.filter((d: any) => {
        const sameName = String(d.upload_name || "").trim() === uploadName;
        const createdMs = Date.parse(String(d.created_at || ""));
        return sameName && Number.isFinite(createdMs) && createdMs >= (startedMs - 10000);
      });
      for (const d of candidates) {
        await fetch(`${CLOUD_FUNCTION_URL}/delete_portfolio_dataset/${d.dataset_id}`, { method: "DELETE" });
      }
      await fetchUploadedDatasets();
      await fetchCatalogList();
    } catch {
      // best-effort cleanup only
    }
  };

  const stopLearnProcess = async () => {
    learnStopRequestedRef.current = true;
    if (learnXhrRef.current) {
      learnXhrRef.current.abort();
      learnXhrRef.current = null;
    }
    if (learnFetchAbortRef.current) {
      learnFetchAbortRef.current.abort();
      learnFetchAbortRef.current = null;
    }
    await cleanupStoppedLearnData();
    setGenLoading(false);
    setLearnStatus("");
    setLearnUploadSubmitted(false);
    setPendingUploadedPortfolioName("");
    setLearnSource("uploaded");
    setLearnInProgress(false);
  };

  const deleteSelectedPortfolio = async () => {
    if (learnInProgress || optimizeInProgress) return;
    if (!learnSource.startsWith("uploaded-dataset:")) return;
    const datasetId = learnSource.split(":", 2)[1] || "";
    if (!datasetId) return;

    const ok = window.confirm("Delete this portfolio and all associated learned catalogs/optimizations?");
    if (!ok) return;

    setGenLoading(true);
    setGenError("");
    try {
      const res = await fetch(`${CLOUD_FUNCTION_URL}/delete_portfolio_dataset/${datasetId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to delete portfolio dataset");
      }

      const listRes = await fetch(`${CLOUD_FUNCTION_URL}/list_portfolio_datasets`);
      if (listRes.ok) {
        const data = await listRes.json();
        const datasets = data.datasets || [];
        setUploadedDatasets(datasets);
        if (datasets.length > 0) {
          setLearnSource(`uploaded-dataset:${datasets[0].dataset_id}`);
        } else {
          setLearnSource("uploaded");
        }
      } else {
        setLearnSource("uploaded");
      }

      fetchCatalogList();
    } catch (err: any) {
      setGenError(err.message || "Failed to delete portfolio dataset");
    } finally {
      setGenLoading(false);
    }
  };

  const fetchCatalogList = async () => {
    try {
      const res = await fetch(`${CLOUD_FUNCTION_URL}/list_profile_catalogs`);
      if (res.ok) {
        const data = await res.json();
        const catalogs = data.catalogs || [];
        setCatalogList(catalogs);
        if (catalogs.length === 0) {
          setSelectedCatalogVersion("");
          setCatalog(null);
          return;
        }

        const hasSelected = Boolean(
          selectedCatalogVersion && catalogs.some((c: any) => c.version === selectedCatalogVersion)
        );
        if (!hasSelected) {
          const nextVersion = catalogs[0].version;
          setSelectedCatalogVersion(nextVersion);
          setCatalog(null);
          loadCatalog(nextVersion);
        }
      }
    } catch { /* silent */ }
  };

  const fetchUploadedDatasets = async () => {
    try {
      const res = await fetch(DATASETS_URL);
      if (res.ok) {
        const data = await res.json();
        setUploadedDatasets(data.datasets || []);
      } else {
        const errData = await res.json().catch(() => ({}));
        setGenError(errData.error || `Failed to load uploaded datasets from ${DATASETS_URL}`);
      }
    } catch {
      setGenError(`Failed to reach ${DATASETS_URL}. Check backend availability and CORS/network errors in the browser console.`);
    }
  };

  const loadCatalog = async (version?: string) => {
    setGenLoading(true);
    try {
      const url = version
        ? `${CLOUD_FUNCTION_URL}/profile_catalog/${version}`
        : `${CLOUD_FUNCTION_URL}/profile_catalog`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setCatalog(data);
        setSelectedCatalogVersion(data.version);
      }
    } catch { /* silent */ }
    finally { setGenLoading(false); }
  };

  // Load catalog list when switching to generator view
  useEffect(() => {
    if (activeView === "generator" || activeView === "welcome") {
      fetchCatalogList();
      fetchUploadedDatasets();
    }
  }, [activeView]);

  // Default to Upload source when no uploaded datasets are available
  useEffect(() => {
    if (!learnUploadFile && uploadedDatasets.length === 0 && learnSource !== "uploaded" && learnSource !== "uploaded-pending") {
      setLearnSource("uploaded");
    }
  }, [learnUploadFile, uploadedDatasets, learnSource]);

  // When datasets exist, default to the latest one unless a valid saved dataset is already selected
  useEffect(() => {
    if (uploadedDatasets.length === 0) return;
    const firstDatasetId = String(uploadedDatasets[0]?.dataset_id || "");
    if (!firstDatasetId) return;

    if (learnSource === "uploaded" && !learnSourceAutoInitialized && !learnUploadFile) {
      setLearnSource(`uploaded-dataset:${firstDatasetId}`);
      setLearnSourceAutoInitialized(true);
      return;
    }

    if (learnSource.startsWith("uploaded-dataset:")) {
      const selectedId = learnSource.split(":", 2)[1] || "";
      const exists = uploadedDatasets.some((d: any) => d.dataset_id === selectedId);
      if (!exists) {
        setLearnSource(`uploaded-dataset:${firstDatasetId}`);
      }
    }
  }, [uploadedDatasets, learnSource, learnSourceAutoInitialized, learnUploadFile]);

  // Catalog + optimize bootstrap when switching tabs.
  useEffect(() => {
    if (activeView === "welcome") {
      // Home loads all data for the active workflow template
      loadCatalog(selectedCatalogVersion || undefined);
      fetchSavedOptimizations(selectedCatalogVersion || undefined);
      fetchIncentiveSets();
    } else if (activeView === "workflow") {
      fetchWorkflows();
    } else if (activeView === "generator") {
      if (generatorTab === "optimize") fetchSavedOptimizations(selectedCatalogVersion || undefined);
      fetchIncentiveSets();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, generatorTab]);

  // Fetch data when a custom workflow is activated
  const prevActiveWorkflowRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeWorkflow && activeView === "welcome" && activeWorkflow.id !== prevActiveWorkflowRef.current) {
      prevActiveWorkflowRef.current = activeWorkflow.id;
      // Ensure incentive sets are loaded for workflows that need them
      if (incentiveSets.length === 0) fetchIncentiveSets();
      if (!selectedIncentiveSetDetail) loadIncentiveSetDetail(selectedIncentiveSetVersion || undefined);
    } else if (!activeWorkflow) {
      prevActiveWorkflowRef.current = null;
    }
  }, [activeWorkflow, activeView]);

  // Optimize polling logic
  useEffect(() => {
    if (!optimizationId || !optimizationPolling) return;

    const poll = async () => {
      try {
          const res = await fetch(`${CLOUD_FUNCTION_URL}/optimize_status/${optimizationId}`);
        if (res.ok) {
          const data = await res.json();
          if (optimizationStopRequestedRef.current) return;
          updateOptimizationCache(data, data?.status !== "running");
          setOptimizationState(data);

          // Update optimization progress in agent chat
          const step = data.current_step || "";
          const pct = data.progress ?? 0;
          if (step && step !== agentOptLastStep.current && !agentOptDoneRef.current) {
            agentOptLastStep.current = step;
            // Translate raw backend steps into friendly messages
            let friendly = step;
            const evalMatch = step.match(/^Evaluating (\S+)\s+\((\d+)(?:\/(\d+))?\)(?:\s*-\s*iter\s+(\d+)\/(\d+))?/);
            const doneMatch = step.match(/^(Converged|No meaningful improvement|Reached max iterations) for (\S+)/);
            if (evalMatch) {
              const [, profId, , total, iter, maxIter] = evalMatch;
              const label = profId + (total ? ` (${total} total)` : "");
              friendly = iter ? `Optimizing ${label} — iteration ${iter}/${maxIter}` : `Optimizing ${label}`;
            } else if (doneMatch) {
              const [, reason] = doneMatch;
              // Extract profile index from the previous in-progress line
              friendly = reason === "Converged" ? "converged, best bundle found"
                : reason === "No meaningful improvement" ? "best bundle found"
                : "complete";
            } else if (step === "Initializing...") {
              friendly = "Initializing";
            }
            // Expanding dots: cycle through ., .., ...
            const dotCount = (pct % 3) + 1;
            const dots = ".".repeat(dotCount);
            setAgentChatMessages((msgs) => {
              const idx = msgs.findIndex((m) => m.id === "opt-progress");
              const allLines = idx >= 0 ? msgs[idx].text.split("\n") : [];
              const doneLines = allLines.filter((l: string) => l.startsWith("✓"));
              const isProfileDone = Boolean(doneMatch);
              let stageLines: string[];
              if (isProfileDone) {
                // Find the last in-progress line and mark it done
                const lastInProgress = allLines.find((l: string) => !l.startsWith("✓") && l.startsWith("Optimizing"));
                const profileLabel = lastInProgress?.match(/^(Optimizing \S+)/)?.[1] || "Profile";
                stageLines = [...doneLines, `✓ ${profileLabel} — ${friendly}`];
              } else {
                stageLines = [...doneLines, `${friendly}${dots}`];
              }
              const progressText = "Starting optimization...\n" + stageLines.join("\n");
              if (idx >= 0) {
                const copy = [...msgs];
                copy[idx] = { ...copy[idx], text: progressText };
                return copy;
              }
              return [...msgs, { id: "opt-progress", role: "agent" as const, text: progressText, submittedAt: formatChatTimestamp(new Date()) }];
            });
          }

          if ((data.status === "completed" || data.status === "failed" || data.status === "cancelled") && !agentOptDoneRef.current) {
            agentOptDoneRef.current = true;
            setOptimizationPolling(false);
            setOptimizeInProgress(false);
            agentOptLastStep.current = "";
            if (data.status === "completed") {
              const totalLift = (data.results || []).reduce((s: number, r: any) => s + (r.lift || 0), 0);
              const profileCount = (data.results || []).length;
              setAgentChatMessages((prev) => {
                const prog = prev.find((m) => m.id === "opt-progress");
                const stageLines = prog ? prog.text.split("\n").filter((l: string) => l.startsWith("✓")).join("\n") : "";
                // Replace the opt-progress message in-place with the final result
                const idx = prev.findIndex((m) => m.id === "opt-progress");
                const finalText = "Starting optimization...\n" + (stageLines ? stageLines + "\n" : "") + `✓ Optimal Incentive Program generated (${profileCount} profiles)\nTotal portfolio lift: +$${Math.round(totalLift).toLocaleString("en-US")}`;
                if (idx >= 0) {
                  const copy = [...prev];
                  copy[idx] = { ...copy[idx], id: `${Date.now()}-opt-done`, text: finalText, submittedAt: formatChatTimestamp(new Date()) };
                  return copy;
                }
                // opt-progress already removed (e.g. by stop) — don't duplicate
                return prev;
              });
            } else {
              setAgentChatMessages((prev) => {
                const idx = prev.findIndex((m) => m.id === "opt-progress");
                const failText = `Optimization ${data.status}. ${data.error || ""}`.trim();
                if (idx >= 0) {
                  const copy = [...prev];
                  copy[idx] = { ...copy[idx], id: `${Date.now()}-opt-done`, text: failText, submittedAt: formatChatTimestamp(new Date()) };
                  return copy;
                }
                return prev;
              });
            }
            // Auto-save on completion (skip if user stopped)
            if (data.status === "completed" && !optimizationStopRequestedRef.current) {
              fetch(`${CLOUD_FUNCTION_URL}/save_optimize/${optimizationId}`, { method: "POST" })
                .then(() => fetchSavedOptimizations(selectedCatalogVersion || undefined))
                .catch(() => { });
            }
          } else if (data.status === "running") {
            setOptimizeInProgress(true);
          }
        }
      } catch {
        // silently fail on poll
      }
    };

    poll(); // Initial poll
    const interval = setInterval(poll, 800);
    return () => clearInterval(interval);
  }, [optimizationId, optimizationPolling, selectedCatalogVersion, updateOptimizationCache]);

  const startOptimization = async () => {
    if (!selectedCatalogVersion) return;

    optimizationStopRequestedRef.current = false;
    setOptimizationStopPhase("idle");
    const controller = new AbortController();
    optimizationStartAbortRef.current = controller;
    setGenLoading(true);
    setOptimizationStarting(true);
    setOptimizeInProgress(true);
    setGenError("");
    setOptimizationState(null);
    setOptimizationId(null);
    setShowOptimizationProgress(true);

    try {
      const res = await fetch(`${CLOUD_FUNCTION_URL}/start_optimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          catalog_version: selectedCatalogVersion,
          incentive_set_version: selectedIncentiveSetVersion || undefined,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to start optimization");
      }
      const data = await res.json();
      const startedOptimizationId = String(data?.optimization_id || data?.experiment_id || "");
      if (!startedOptimizationId) {
        throw new Error("Failed to start optimization: missing optimization_id");
      }
      if (optimizationStopRequestedRef.current) {
        setOptimizationStopPhase("cancelling");
        await fetch(`${CLOUD_FUNCTION_URL}/cancel_optimize/${startedOptimizationId}`, { method: "POST" }).catch(() => { });
        setOptimizationStopPhase("cleaning");
        await fetch(`${CLOUD_FUNCTION_URL}/delete_optimize/${startedOptimizationId}`, { method: "DELETE" }).catch(() => { });
        setOptimizationPolling(false);
        setOptimizationState(null);
        setOptimizationId(null);
        setSelectedSavedOptimizationId(null);
        setShowOptimizationProgress(false);
        setOptimizationStopPhase("idle");
        setOptimizeInProgress(false);
        return;
      }
      setOptimizationId(startedOptimizationId);
      setSelectedSavedOptimizationId(startedOptimizationId);
      setOptimizationPolling(true);
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        setGenError(err.message || "Failed to start optimization");
      }
      setOptimizationStopPhase("idle");
      setOptimizeInProgress(false);
    } finally {
      optimizationStartAbortRef.current = null;
      setOptimizationStarting(false);
      setGenLoading(false);
    }
  };

  const stopOptimization = async () => {
    optimizationStopRequestedRef.current = true;
    setOptimizationStopPhase("cancelling");
    setShowOptimizationProgress(true);
    setOptimizeInProgress(true);
    if (optimizationStartAbortRef.current) {
      optimizationStartAbortRef.current.abort();
      optimizationStartAbortRef.current = null;
    }
    if (!optimizationId) {
      setOptimizationStarting(false);
      setGenLoading(false);
      setShowOptimizationProgress(false);
      setOptimizationStopPhase("idle");
      setOptimizeInProgress(false);
      return;
    }
    try {
      await fetch(`${CLOUD_FUNCTION_URL}/cancel_optimize/${optimizationId}`, { method: "POST" });
      setOptimizationStopPhase("cleaning");
      await fetch(`${CLOUD_FUNCTION_URL}/delete_optimize/${optimizationId}`, { method: "DELETE" });
    } catch {
      // silently fail
    } finally {
      setOptimizationPolling(false);
      setOptimizationState(null);
      setOptimizationId(null);
      setSelectedSavedOptimizationId(null);
      fetchSavedOptimizations(selectedCatalogVersion || undefined);
      setOptimizationStarting(false);
      setGenLoading(false);
      setOptimizationStopPhase("idle");
      setOptimizeInProgress(false);
    }
  };

  const saveOptimization = async () => {
    if (!optimizationId) return;
    try {
      const res = await fetch(`${CLOUD_FUNCTION_URL}/save_optimize/${optimizationId}`, { method: "POST" });
      if (res.ok) {
        setGenError("");
      }
    } catch {
      setGenError("Failed to save optimization");
    }
  };

  const deleteOptimization = async () => {
    if (learnInProgress || optimizeInProgress) return;
    if (!optimizationId) return;
    try {
      await fetch(`${CLOUD_FUNCTION_URL}/delete_optimize/${optimizationId}`, { method: "DELETE" });
      setOptimizationState(null);
      setOptimizationId(null);
      setSelectedSavedOptimizationId(null);
      fetchSavedOptimizations(selectedCatalogVersion || undefined);
    } catch {
      setGenError("Failed to delete optimization");
    }
  };

  const fetchSavedOptimizations = async (catalogVersion?: string) => {
    const fetchSeq = ++savedOptimizationsFetchSeqRef.current;
    try {
      const url = catalogVersion
        ? `${CLOUD_FUNCTION_URL}/list_optimizations?catalog_version=${catalogVersion}`
        : `${CLOUD_FUNCTION_URL}/list_optimizations`;
      const res = await fetch(url);
      if (res.ok) {
        if (fetchSeq !== savedOptimizationsFetchSeqRef.current) return;
        const data = await res.json();
        const exps = data.optimizations || [];
        setSavedOptimizations(exps);
        // Auto-load the latest terminal optimization only.
        // Avoid auto-opening stale "running" entries on initial page entry.
        if (exps.length > 0) {
          const preferred = exps.find((exp: any) =>
            ["completed", "cancelled", "failed"].includes(String(exp.status || "").toLowerCase())
          );
          if (preferred?.optimization_id) {
            const preferredId = String(preferred.optimization_id);
            const cached = optimizationCacheRef.current[preferredId];
            if (cached) {
              setSelectedSavedOptimizationId(preferredId);
              setOptimizationState(cached);
              setOptimizationId(preferredId);
              setOptimizeInProgress(cached?.status === "running");
            }
            if (!(preferredId === selectedSavedOptimizationId && optimizationState)) {
              loadSavedOptimization(preferredId, { refresh: !cached });
            }
          } else {
            setSelectedSavedOptimizationId(exps[0].optimization_id || null);
            setOptimizationState(null);
            setOptimizationId(null);
            setOptimizationPolling(false);
            setOptimizeInProgress(false);
            setShowOptimizationProgress(false);
          }
        } else {
          setSelectedSavedOptimizationId(null);
          setOptimizationState(null);
          setOptimizationId(null);
          setOptimizationPolling(false);
          setOptimizeInProgress(false);
          setShowOptimizationProgress(false);
        }
      }
    } catch { /* silent */ }
  };

  const fetchIncentiveSets = async () => {
    try {
      const res = await fetch(`${CLOUD_FUNCTION_URL}/list_incentive_sets`);
      if (res.ok) {
        const data = await res.json();
        const sets = data.incentive_sets || [];
        setIncentiveSets(sets);
        // Auto-select the default, or the first one
        const defaultSet = sets.find((s: any) => s.is_default);
        if (defaultSet) {
          setSelectedIncentiveSetVersion(defaultSet.version);
        } else if (sets.length > 0 && !selectedIncentiveSetVersion) {
          setSelectedIncentiveSetVersion(sets[0].version);
        }
      }
    } catch { /* silent */ }
  };

  const fetchWorkflows = async () => {
    try {
      const res = await fetch(`${CLOUD_FUNCTION_URL}/list_workflows`);
      if (res.ok) {
        const data = await res.json();
        setWorkflows(data.workflows || []);
      }
    } catch { /* silent */ }
  };

  const loadIncentiveSetDetail = async (version?: string) => {
    setIncentiveSetDetailLoading(true);
    try {
      const url = version
        ? `${CLOUD_FUNCTION_URL}/incentive_set/${version}`
        : `${CLOUD_FUNCTION_URL}/incentive_set`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setSelectedIncentiveSetDetail(data);
      }
    } catch { /* silent */ }
    finally { setIncentiveSetDetailLoading(false); }
  };

  useEffect(() => {
    if (activeView === "welcome" || (activeView === "generator" && generatorTab === "optimize")) {
      loadIncentiveSetDetail(selectedIncentiveSetVersion || undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, generatorTab, selectedIncentiveSetVersion]);

  const loadSavedOptimization = async (expId: string, options?: { refresh?: boolean }) => {
    const shouldRefresh = options?.refresh !== false;
    optimizationStopRequestedRef.current = false;
    setSelectedSavedOptimizationId(expId);
    // Only clear progress when switching to a different optimization
    if (expId !== optimizationId) {
      setShowOptimizationProgress(false);
    }
    const cached = optimizationCacheRef.current[expId];
    if (cached) {
      setOptimizationState(cached);
      setOptimizationId(expId);
      setOptimizeInProgress(cached?.status === "running");
    }
    if (!shouldRefresh && cached?.status !== "running") {
      return;
    }
    const loadSeq = ++loadOptimizationFetchSeqRef.current;
    try {
      const res = await fetch(`${CLOUD_FUNCTION_URL}/load_optimize/${expId}`);
      if (res.ok) {
        const data = await res.json();
        if (optimizationStopRequestedRef.current || loadSeq !== loadOptimizationFetchSeqRef.current) return;
        updateOptimizationCache(data, true);
        setOptimizationState(data);
        setOptimizationId(expId);
        setOptimizeInProgress(data?.status === "running");
      }
    } catch { /* silent */ }
  };

  useEffect(() => {
    if (activeView === "welcome") {
      // Home view: restore cache regardless of generatorTab
      if (!selectedCatalogVersion) return;
    } else if (activeView === "generator") {
      if (generatorTab !== "optimize" || !selectedCatalogVersion) return;
    } else {
      return;
    }
    if (optimizeInProgress && optimizationId) return;
    const cachedOptimizationId = optimizationLatestByCatalogRef.current[selectedCatalogVersion];
    if (!cachedOptimizationId) return;
    const cachedState = optimizationCacheRef.current[cachedOptimizationId];
    if (!cachedState) return;
    if (optimizationState && optimizationState.catalog_version === selectedCatalogVersion) return;
    setSelectedSavedOptimizationId(cachedOptimizationId);
    setOptimizationState(cachedState);
    setOptimizationId(cachedOptimizationId);
    setOptimizeInProgress(cachedState?.status === "running");
  }, [activeView, generatorTab, optimizeInProgress, optimizationId, optimizationState, selectedCatalogVersion]);

  useEffect(() => {
    if ((activeView === "generator" || activeView === "welcome") && selectedCatalogVersion) {
      fetchSavedOptimizations(selectedCatalogVersion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, selectedCatalogVersion]);

  const deleteCatalog = async (version: string) => {
    if (learnInProgress || optimizeInProgress) return;
    if (!confirm(`Delete catalog ${version}? This cannot be undone.`)) return;
    try {
      const res = await fetch(`${CLOUD_FUNCTION_URL}/delete_catalog/${version}`, { method: "DELETE" });
      if (res.ok) {
        const newList = catalogList.filter((c: any) => c.version !== version);
        setCatalogList(newList);
        if (selectedCatalogVersion === version) {
          const next = newList.length > 0 ? newList[0].version : "";
          setSelectedCatalogVersion(next);
          if (next) loadCatalog(next); else setCatalog(null);
        }
      }
    } catch {
      setGenError("Failed to delete catalog");
    }
  };

  const hasLoginState = false;
  const currentUserName = "Sharpe";
  const welcomeBackLine = hasLoginState && currentUserName ? `Welcome back ${currentUserName}.` : "Welcome.";
  const welcomePromptLine = `${welcomeBackLine} What shall we work on today?`;

  useEffect(() => {
    setTypedWelcomeLine("");
    let index = 0;
    const timer = window.setInterval(() => {
      index += 1;
      setTypedWelcomeLine(welcomePromptLine.slice(0, index));
      if (index >= welcomePromptLine.length) {
        window.clearInterval(timer);
      }
    }, 35);
    return () => window.clearInterval(timer);
  }, [welcomePromptLine]);

  const formatChatTimestamp = (date: Date) => {
    const stamp = date.toLocaleString("en-US", {
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return stamp.replace(", ", ", ").replace(" AM", "AM").replace(" PM", "PM");
  };
  const GREETING_RE = /^(h(i|ello|ey|owdy|ola)|yo|sup|what'?s\s*up|good\s*(morning|afternoon|evening|day)|gm|gn|thanks?(\s*you)?|ty|bye|cya|see\s*ya|cheers|greetings|ok|okay|k|cool|nice|lol|lmao|haha|wow|yep|yea(h)?|nope|no|yes)[!?.\s]*$/i;
  const GIBBERISH_RE = /^[^a-zA-Z]*$|^(.)\1{4,}$|^[a-z]{1,2}$/i;
  const isGibberish = (s: string) => GIBBERISH_RE.test(s) || (s.length <= 6 && !/[aeiou]/i.test(s)) || /^[^a-zA-Z0-9]*$/.test(s);
  const CANNED: Record<string, string[]> = {
    greeting: ["Hey! Ask me anything about your portfolio or spending data.", "Hello! How can I help with your portfolio today?", "Hi there! Ready to analyze some data."],
    gibberish: ["I didn't quite catch that. Try asking about your portfolio or spending patterns.", "Could you rephrase that? I'm here to help with financial insights."],
  };
  const pickCanned = (kind: "greeting" | "gibberish") => CANNED[kind][Math.floor(Math.random() * CANNED[kind].length)];

  // ── Custom grid column helpers ──────────────────────────────────
  const GRID_FIELDS: Record<string, string> = {
    original_portfolio_ltv: "Original LTV before optimization",
    new_gross_portfolio_ltv: "LTV after incentives, before cost",
    portfolio_cost: "Cost of assigned incentives",
    lift: "Revenue lift from incentives",
    new_net_portfolio_ltv: "Final LTV (net of cost)",
  };

  /** Build full optimization context sent to backend so the LLM can give specific, data-grounded answers */
  const buildGridContext = (overrides?: { incentiveSetDetail?: any }) => {
    const ctx: Record<string, any> = {
      fields: GRID_FIELDS,
      custom_columns: gridCustomColumns.map((c) => ({ label: c.label, formula: c.exprSource, format: c.format })),
      has_results: Boolean(optimizationState?.results?.length),
    };

    // Clustering / catalog context
    if (catalog) {
      ctx.catalog = {
        version: catalog.version,
        source: catalog.source,
        k: catalog.k,
        total_learning_population: catalog.total_learning_population,
        profiles: (catalog.profiles || []).map((p: any) => ({
          profile_id: p.profile_id,
          label: p.label,
          description: p.description,
          portfolio_ltv: p.portfolio_ltv,
          population_count: p.population_count,
          population_share: p.population_share,
        })),
      };
    }

    // Incentive set context (use override if provided, e.g. freshly fetched before state update)
    const incDetail = overrides?.incentiveSetDetail || selectedIncentiveSetDetail;
    if (incDetail) {
      ctx.incentive_set = {
        name: incDetail.name || incDetail.version,
        version: incDetail.version,
        incentives: (incDetail.incentives || []).map((inc: any) => ({
          name: inc.name,
          estimated_annual_cost_per_user: inc.estimated_annual_cost_per_user,
          redemption_rate: inc.redemption_rate,
          effective_cost: Math.round((inc.estimated_annual_cost_per_user || 0) * (inc.redemption_rate || 1)),
        })),
      };
    }

    // Optimization run context
    if (optimizationState) {
      ctx.optimization = {
        status: optimizationState.status,
        max_iterations: optimizationState.max_iterations || 50,
        convergence_window: optimizationState.convergence_window || 6,
        patience: optimizationState.patience || 3,
        started_at: optimizationState.started_at,
        completed_at: optimizationState.completed_at,
        results: (optimizationState.results || []).map((r: any) => ({
          profile_id: r.profile_id,
          selected_incentives: r.selected_incentives,
          original_portfolio_ltv: r.original_portfolio_ltv,
          new_gross_portfolio_ltv: r.new_gross_portfolio_ltv,
          portfolio_cost: r.portfolio_cost,
          lift: r.lift,
          new_net_portfolio_ltv: r.new_net_portfolio_ltv,
        })),
      };
    }

    // Available profiles (catalogs) — generated from clustering
    ctx.available_profiles = catalogList.map((c: any) => ({
      version: c.version,
      source: c.source,
      k: c.k,
    }));
    // Uploaded portfolios (datasets) — raw transaction data uploaded by the user
    ctx.uploaded_portfolios = (uploadedDatasets || []).map((d: any) => ({
      dataset_id: d.dataset_id,
      name: d.upload_name,
      created_at: d.created_at,
    }));
    // Saved optimization programs for listing
    ctx.saved_programs = (savedOptimizations || []).map((exp: any) => ({
      optimization_id: exp.optimization_id,
      status: exp.status,
      profile_count: exp.result_count || 0,
      total_lift: exp.total_lift ?? null,
      started_at: exp.started_at,
      completed_at: exp.completed_at,
      catalog_version: exp.catalog_version,
      incentive_set_version: exp.incentive_set_version,
    }));
    // Available incentive sets
    ctx.available_incentive_sets = (incentiveSets || []).map((s: any) => ({
      version: s.version,
      name: s.name || s.version,
      is_default: s.is_default || false,
      incentive_count: s.incentive_count || 0,
    }));
    // Available workflows (built-in + user-created)
    ctx.available_workflows = [
      { workflow_id: "builtin-optimize-portfolio", name: "Optimize portfolio", description: "Learn behavioral profiles from transaction data using clustering, then derive optimal incentive program through simulation.", type: "built-in" },
      ...(workflows || []).map((w: any) => ({
        workflow_id: w.workflow_id,
        name: w.name,
        description: w.description,
        detail: w.detail || "",
        type: "custom",
      })),
    ];
    ctx.pending_delete_catalog = pendingDeleteCatalogRef.current;
    ctx.pending_delete_incentive_set = pendingDeleteIncentiveSetRef.current;
    ctx.pending_delete_workflow = pendingDeleteWorkflowRef.current;
    ctx.is_busy = Boolean(learnInProgress || optimizeInProgress);
    if (learnInProgress) ctx.busy_reason = "profile_creation";
    else if (optimizeInProgress) ctx.busy_reason = "optimization";
    ctx.selected_catalog_version = selectedCatalogVersion || null;
    ctx.selected_incentive_set_version = selectedIncentiveSetVersion || null;
    ctx.has_optimization_result = Boolean(optimizationState?.status === "completed");

    return ctx;
  };

  /** Try to compile a formula string from the backend into a safe row evaluator */
  const compileFormula = (formula: string): ((r: any) => number) | null => {
    // Only allow field names, numbers, operators, parens, whitespace
    const allowedFields = Object.keys(GRID_FIELDS);
    let expr = formula;
    // Replace field names with r.<field>
    for (const f of allowedFields.sort((a, b) => b.length - a.length)) {
      expr = expr.replace(new RegExp(`\\b${f}\\b`, "g"), `r.${f}`);
    }
    const sanitized = expr.replace(/r\.\w+/g, "0").replace(/[0-9.+\-*/() \t]/g, "");
    if (sanitized.length > 0) return null;
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function("r", `"use strict"; const v = ${expr}; return typeof v === 'number' && isFinite(v) ? v : 0;`) as (r: any) => number;
      fn({ original_portfolio_ltv: 1, new_gross_portfolio_ltv: 2, portfolio_cost: 1, lift: 0.5, new_net_portfolio_ltv: 1.5 });
      return fn;
    } catch {
      return null;
    }
  };

  /** Execute structured actions returned by the backend */
  const executeAgentActions = async (actions: any[]) => {
    for (const action of actions) {
      if (action.type === "add_column") {
        const fn = compileFormula(action.formula || "");
        if (!fn) continue;
        const newCol = {
          id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          label: (action.label || "").toUpperCase(),
          expr: fn,
          exprSource: action.formula,
          format: (["dollar", "percent", "ratio", "number"].includes(action.format) ? action.format : "number") as "dollar" | "percent" | "ratio" | "number",
          totalsExpr: (action.totals === "avg" ? "avg" : "sum") as "sum" | "avg",
        };
        setGridCustomColumns((prev) => {
          const idx = prev.findIndex((c) => c.label.toLowerCase() === newCol.label.toLowerCase());
          if (idx >= 0) { const updated = [...prev]; updated[idx] = newCol; return updated; }
          return [...prev, newCol];
        });
      } else if (action.type === "remove_column") {
        const target = (action.label || "").toLowerCase();
        setGridCustomColumns((prev) => prev.filter((c) => c.label.toLowerCase() !== target));

      } else if (action.type === "create_profile") {
        // Create a new profile catalog via learn_profiles
        const k = Number(action.k);
        const source = action.source || "uploaded";
        if (!k || k < 2) continue;
        if (learnInProgress || optimizeInProgress) {
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: "Cannot create a profile while another operation is in progress.", submittedAt: formatChatTimestamp(new Date()) }]);
          continue;
        }
        // Find the dataset to use
        const datasetId = action.dataset_id || (uploadedDatasets.length > 0 ? uploadedDatasets[0].dataset_id : null);
        if (source.startsWith("uploaded") && !datasetId) {
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: "No uploaded dataset found. Please upload a portfolio CSV first.", submittedAt: formatChatTimestamp(new Date()) }]);
          continue;
        }
        // Trigger learn
        setLearnK(k);
        if (datasetId) setLearnSource(`uploaded-dataset:${datasetId}`);
        // Call learn_profiles directly
        try {
          setAgentChatLoading(true);
          setLearnInProgress(true);
          const learnAbort = new AbortController();
          agentLearnAbortRef.current = learnAbort;
          const body: any = { k, source: datasetId ? `uploaded-dataset:${datasetId}` : source };
          const res = await fetch(`${CLOUD_FUNCTION_URL}/learn_profiles`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: learnAbort.signal,
          });
          if (res.ok) {
            const data = await res.json();
            await fetchCatalogList();
            if (data.version) {
              setSelectedCatalogVersion(data.version);
              loadCatalog(data.version);
            }
            setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: `Profile created successfully (version: ${data.version || "unknown"}, K=${k}, ${(data.profiles || []).length} profiles).`, submittedAt: formatChatTimestamp(new Date()) }]);
          } else {
            const errData = await res.json().catch(() => ({}));
            setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: `Failed to create profile: ${errData.error || res.statusText}`, submittedAt: formatChatTimestamp(new Date()) }]);
          }
        } catch (e: any) {
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: `Error creating profile: ${e.message || "unknown error"}`, submittedAt: formatChatTimestamp(new Date()) }]);
        } finally {
          agentLearnAbortRef.current = null;
          setAgentChatLoading(false);
          setLearnInProgress(false);
        }

      } else if (action.type === "request_delete_profile") {
        // Stage a catalog version for deletion — wait for user confirmation
        const version = action.version || "";
        if (version) setPendingDeleteCatalog(version);

      } else if (action.type === "confirm_delete_profile") {
        // User confirmed deletion — delete catalog and associated optimizations
        const version = pendingDeleteCatalogRef.current || action.version || "";
        if (!version) continue;
        if (learnInProgress || optimizeInProgress) {
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: "Cannot delete while another operation is in progress.", submittedAt: formatChatTimestamp(new Date()) }]);
          continue;
        }
        const deleteProgressId = `${Date.now()}-del-progress`;
        try {
          setAgentChatLoading(true);
          setAgentChatMessages((prev) => [...prev, { id: deleteProgressId, role: "agent" as const, text: `Deleting profile ${version.slice(0, 12)}...`, submittedAt: formatChatTimestamp(new Date()) }]);
          // First delete all optimizations associated with this catalog
          const listRes = await fetch(`${CLOUD_FUNCTION_URL}/list_optimizations?catalog_version=${version}`);
          if (listRes.ok) {
            const listData = await listRes.json();
            const optimizations = listData.optimizations || [];
            for (const opt of optimizations) {
              await fetch(`${CLOUD_FUNCTION_URL}/delete_optimize/${opt.optimization_id}`, { method: "DELETE" });
            }
          }
          // Then delete the catalog itself
          const res = await fetch(`${CLOUD_FUNCTION_URL}/delete_catalog/${version}`, { method: "DELETE" });
          if (res.ok) {
            // Refresh catalog list from server
            await fetchCatalogList();
            if (selectedCatalogVersion === version) {
              setSelectedCatalogVersion("");
              setCatalog(null);
              setOptimizationState(null);
              setOptimizationId(null);
            }
            setAgentChatMessages((prev) => {
              const idx = prev.findIndex((m) => m.id === deleteProgressId);
              const doneMsg = { id: `${Date.now()}-sys`, role: "agent" as const, text: `Done. Profile and associated programs deleted.`, submittedAt: formatChatTimestamp(new Date()) };
              if (idx >= 0) { const copy = [...prev]; copy[idx] = { ...prev[idx], ...doneMsg }; return copy; }
              return [...prev, doneMsg];
            });
          } else {
            setAgentChatMessages((prev) => {
              const idx = prev.findIndex((m) => m.id === deleteProgressId);
              const failMsg = { id: `${Date.now()}-sys`, role: "agent" as const, text: `Failed to delete profile.`, submittedAt: formatChatTimestamp(new Date()) };
              if (idx >= 0) { const copy = [...prev]; copy[idx] = { ...prev[idx], ...failMsg }; return copy; }
              return [...prev, failMsg];
            });
          }
        } catch {
          setAgentChatMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === deleteProgressId);
            const errMsg = { id: `${Date.now()}-sys`, role: "agent" as const, text: `Error deleting profile.`, submittedAt: formatChatTimestamp(new Date()) };
            if (idx >= 0) { const copy = [...prev]; copy[idx] = { ...prev[idx], ...errMsg }; return copy; }
            return [...prev, errMsg];
          });
        } finally {
          setPendingDeleteCatalog(null);
          setAgentChatLoading(false);
        }

      } else if (action.type === "cancel_delete_profile") {
        setPendingDeleteCatalog(null);

      } else if (action.type === "fork_profile") {
        const version = action.version || "";
        if (!version) continue;
        try {
          const res = await fetch(`${CLOUD_FUNCTION_URL}/fork_catalog`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ source_version: version }),
          });
          if (res.ok) {
            const data = await res.json();
            await fetchCatalogList();
            if (data.version) {
              setSelectedCatalogVersion(data.version);
              loadCatalog(data.version);
            }
            setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: `Profile duplicated. New version: ${data.version || "unknown"}.`, submittedAt: formatChatTimestamp(new Date()) }]);
          } else {
            const errData = await res.json().catch(() => ({}));
            setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: `Failed to duplicate profile: ${errData.error || res.statusText}`, submittedAt: formatChatTimestamp(new Date()) }]);
          }
        } catch (e: any) {
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: `Error duplicating profile: ${e.message || "unknown error"}`, submittedAt: formatChatTimestamp(new Date()) }]);
        }

      } else if (action.type === "list_programs") {
        // Show a numbered list of saved optimization programs
        const programs = savedOptimizations || [];
        let listText: string;
        if (programs.length === 0) {
          listText = "No programs found for the current context.";
        } else {
          const lines = programs.map((exp: any, i: number) => {
            const totalLift = exp.total_lift ?? (Array.isArray(exp.results)
              ? exp.results.reduce((s: number, r: any) => s + (r.lift || 0), 0)
              : null);
            const profileCount = exp.result_count || (Array.isArray(exp.results) ? exp.results.length : 0);
            const date = exp.completed_at || exp.started_at || "";
            const dateStr = date ? new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) + " " + new Date(date).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "—";
            const status = (exp.status || "unknown").toLowerCase();
            const liftStr = totalLift != null ? `+$${Math.round(totalLift).toLocaleString("en-US")}` : "—";
            return `${i + 1}. ${dateStr} · ${profileCount} profiles · lift: ${liftStr} · ${status}`;
          });
          listText = lines.join("\n");
        }
        // Replace the last agent message (LLM reply) with the list
        setAgentChatMessages((prev) => {
          const copy = [...prev];
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i].role === "agent") {
              const header = copy[i].text;
              copy[i] = { ...copy[i], text: header + "\n\n" + listText };
              return copy;
            }
          }
          return [...copy, { id: `${Date.now()}-sys`, role: "agent" as const, text: listText, submittedAt: formatChatTimestamp(new Date()) }];
        });

      } else if (action.type === "delete_program") {
        const optId = action.optimization_id || "";
        if (!optId) continue;
        try {
          setAgentChatLoading(true);
          const delProgressId = `${Date.now()}-delprog`;
          setAgentChatMessages((prev) => [...prev, { id: delProgressId, role: "agent" as const, text: "Deleting program...", submittedAt: formatChatTimestamp(new Date()) }]);
          await fetch(`${CLOUD_FUNCTION_URL}/delete_optimize/${optId}`, { method: "DELETE" });
          // Clear from UI if it was the active optimization
          if (optimizationId === optId) {
            setOptimizationState(null);
            setOptimizationId(null);
            setSelectedSavedOptimizationId(null);
          }
          delete optimizationCacheRef.current[optId];
          await fetchSavedOptimizations(selectedCatalogVersion || undefined);
          setAgentChatMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === delProgressId);
            const doneMsg = { id: `${Date.now()}-sys`, role: "agent" as const, text: "Done. Program deleted.", submittedAt: formatChatTimestamp(new Date()) };
            if (idx >= 0) { const copy = [...prev]; copy[idx] = { ...prev[idx], ...doneMsg }; return copy; }
            return [...prev, doneMsg];
          });
        } catch (e: any) {
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: `Failed to delete program: ${e.message || "unknown error"}`, submittedAt: formatChatTimestamp(new Date()) }]);
        } finally {
          setAgentChatLoading(false);
        }

      } else if (action.type === "run_optimization") {
        // Start an Optimal Incentive Program optimization run
        if (!selectedCatalogVersion) {
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: "No profile selected. Please select a profile first.", submittedAt: formatChatTimestamp(new Date()) }]);
          continue;
        }
        if (optimizeInProgress || learnInProgress) {
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: "Another operation is already in progress. Please wait for it to complete.", submittedAt: formatChatTimestamp(new Date()) }]);
          continue;
        }
        // Use specified catalog/incentive set or fall back to currently selected
        const catVersion = action.catalog_version || selectedCatalogVersion;
        const incVersion = action.incentive_set_version || selectedIncentiveSetVersion || undefined;
        try {
          setAgentChatLoading(true);
          setOptimizeInProgress(true);
          setOptimizationState(null);
          setOptimizationId(null);
          setShowOptimizationProgress(true);
          setGenError("");
          optimizationStopRequestedRef.current = false;
          const res = await fetch(`${CLOUD_FUNCTION_URL}/start_optimize`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ catalog_version: catVersion, incentive_set_version: incVersion }),
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || "Failed to start optimization");
          }
          const data = await res.json();
          const optId = String(data?.optimization_id || data?.experiment_id || "");
          if (!optId) throw new Error("Missing optimization_id");
          setOptimizationId(optId);
          setSelectedSavedOptimizationId(optId);
          setOptimizationPolling(true);
          // Reset stage tracker and convert the last agent reply into the progress message
          agentOptLastStep.current = "";
          agentOptDoneRef.current = false;
          setAgentChatMessages((prev) => {
            const copy = [...prev];
            // Find the last agent message (the LLM's "Starting optimization." reply) and repurpose it
            for (let i = copy.length - 1; i >= 0; i--) {
              if (copy[i].role === "agent") {
                copy[i] = { ...copy[i], id: "opt-progress", text: "Starting optimization..." };
                return copy;
              }
            }
            return [...copy, { id: "opt-progress", role: "agent" as const, text: "Starting optimization...", submittedAt: formatChatTimestamp(new Date()) }];
          });
        } catch (e: any) {
          setOptimizeInProgress(false);
          setShowOptimizationProgress(false);
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: `Failed to start optimization: ${e.message || "unknown error"}`, submittedAt: formatChatTimestamp(new Date()) }]);
        } finally {
          setAgentChatLoading(false);
        }

      } else if (action.type === "list_incentive_sets") {
        // Show a numbered list of incentive sets
        const sets = incentiveSets || [];
        let listText: string;
        if (sets.length === 0) {
          listText = "No incentive sets found.";
        } else {
          const lines = sets.map((s: any, i: number) => {
            const defaultTag = s.is_default ? " (default)" : "";
            const count = s.incentive_count || 0;
            return `${i + 1}. ${s.name || s.version} · ${count} incentives${defaultTag}`;
          });
          listText = lines.join("\n");
        }
        setAgentChatMessages((prev) => {
          const copy = [...prev];
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i].role === "agent") {
              copy[i] = { ...copy[i], text: copy[i].text + "\n\n" + listText };
              return copy;
            }
          }
          return [...copy, { id: `${Date.now()}-sys`, role: "agent" as const, text: listText, submittedAt: formatChatTimestamp(new Date()) }];
        });

      } else if (action.type === "create_incentive_set") {
        // Create a new incentive set via the API
        const name = action.name || "";
        const description = action.description || "";
        const incentives = action.incentives || [];
        const setAsDefault = action.set_as_default || false;
        if (!incentives.length) {
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: "Cannot create an incentive set with no incentives.", submittedAt: formatChatTimestamp(new Date()) }]);
          continue;
        }
        try {
          setAgentChatLoading(true);
          const res = await fetch(`${CLOUD_FUNCTION_URL}/create_incentive_set`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, description, incentives, set_as_default: setAsDefault }),
          });
          if (res.ok) {
            const data = await res.json();
            await fetchIncentiveSets();
            if (data.version) {
              setSelectedIncentiveSetVersion(data.version);
              loadIncentiveSetDetail(data.version);
            }
            setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: `Incentive set "${name || data.version}" created with ${incentives.length} incentives.`, submittedAt: formatChatTimestamp(new Date()) }]);
          } else {
            const errData = await res.json().catch(() => ({}));
            setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: `Failed to create incentive set: ${errData.error || res.statusText}`, submittedAt: formatChatTimestamp(new Date()) }]);
          }
        } catch (e: any) {
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: `Error creating incentive set: ${e.message || "unknown error"}`, submittedAt: formatChatTimestamp(new Date()) }]);
        } finally {
          setAgentChatLoading(false);
        }

      } else if (action.type === "update_incentive_set") {
        // Update an incentive set (blocked if used in optimization programs)
        const version = action.version || "";
        if (!version) continue;
        try {
          setAgentChatLoading(true);
          const body: any = {};
          if (action.name !== undefined) body.name = action.name;
          if (action.description !== undefined) body.description = action.description;
          if (action.incentives !== undefined) body.incentives = action.incentives;
          const res = await fetch(`${CLOUD_FUNCTION_URL}/update_incentive_set/${version}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (res.ok) {
            await fetchIncentiveSets();
            if (selectedIncentiveSetVersion === version) {
              loadIncentiveSetDetail(version);
            }
            setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: `Incentive set updated.`, submittedAt: formatChatTimestamp(new Date()) }]);
          } else {
            const errData = await res.json().catch(() => ({}));
            const errMsg = errData.error || res.statusText;
            if (res.status === 409) {
              setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: `Cannot update: this incentive set has been used to generate ${errData.optimization_count || "one or more"} incentive program(s). Create a new incentive set instead.`, submittedAt: formatChatTimestamp(new Date()) }]);
            } else {
              setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: `Failed to update incentive set: ${errMsg}`, submittedAt: formatChatTimestamp(new Date()) }]);
            }
          }
        } catch (e: any) {
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: `Error updating incentive set: ${e.message || "unknown error"}`, submittedAt: formatChatTimestamp(new Date()) }]);
        } finally {
          setAgentChatLoading(false);
        }

      } else if (action.type === "request_delete_incentive_set") {
        // Stage an incentive set for deletion — check usage and warn about cascade
        const version = action.version || "";
        if (!version) continue;
        // Check how many programs use this incentive set
        try {
          const usageRes = await fetch(`${CLOUD_FUNCTION_URL}/check_incentive_set_usage/${version}`);
          if (usageRes.ok) {
            const usageData = await usageRes.json();
            const count = usageData.optimization_count || 0;
            if (count > 0) {
              // Store count for the confirmation message
              setPendingDeleteIncentiveSet(version);
              const setName = incentiveSets.find((s: any) => s.version === version)?.name || version.slice(0, 12);
              setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: `⚠ Are you sure you want to delete incentive set "${setName}"? This will also permanently delete ${count} incentive program(s) that were generated from it. Reply yes to confirm or no to cancel.`, submittedAt: formatChatTimestamp(new Date()) }]);
              continue;
            }
          }
        } catch { /* fall through to default behavior */ }
        setPendingDeleteIncentiveSet(version);

      } else if (action.type === "confirm_delete_incentive_set") {
        // User confirmed deletion — delete incentive set + cascade-delete programs
        const version = pendingDeleteIncentiveSetRef.current || action.version || "";
        if (!version) continue;
        try {
          setAgentChatLoading(true);
          const delProgressId = `${Date.now()}-del-is`;
          setAgentChatMessages((prev) => [...prev, { id: delProgressId, role: "agent" as const, text: `Deleting incentive set ${version.slice(0, 12)} and associated programs...`, submittedAt: formatChatTimestamp(new Date()) }]);
          const res = await fetch(`${CLOUD_FUNCTION_URL}/delete_incentive_set/${version}`, { method: "DELETE" });
          if (res.ok) {
            const data = await res.json().catch(() => ({}));
            const deletedPrograms = data.deleted_optimizations || 0;
            await fetchIncentiveSets();
            if (selectedIncentiveSetVersion === version) {
              setSelectedIncentiveSetVersion("");
              setSelectedIncentiveSetDetail(null);
            }
            const doneText = deletedPrograms > 0
              ? `Done. Incentive set deleted along with ${deletedPrograms} incentive program(s).`
              : "Done. Incentive set deleted.";
            setAgentChatMessages((prev) => {
              const idx = prev.findIndex((m) => m.id === delProgressId);
              const doneMsg = { id: `${Date.now()}-sys`, role: "agent" as const, text: doneText, submittedAt: formatChatTimestamp(new Date()) };
              if (idx >= 0) { const copy = [...prev]; copy[idx] = { ...prev[idx], ...doneMsg }; return copy; }
              return [...prev, doneMsg];
            });
          } else {
            setAgentChatMessages((prev) => {
              const idx = prev.findIndex((m) => m.id === delProgressId);
              const failMsg = { id: `${Date.now()}-sys`, role: "agent" as const, text: "Failed to delete incentive set.", submittedAt: formatChatTimestamp(new Date()) };
              if (idx >= 0) { const copy = [...prev]; copy[idx] = { ...prev[idx], ...failMsg }; return copy; }
              return [...prev, failMsg];
            });
          }
        } catch {
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: "Error deleting incentive set.", submittedAt: formatChatTimestamp(new Date()) }]);
        } finally {
          setPendingDeleteIncentiveSet(null);
          setAgentChatLoading(false);
        }

      } else if (action.type === "cancel_delete_incentive_set") {
        setPendingDeleteIncentiveSet(null);

      } else if (action.type === "set_default_incentive_set") {
        // Set an incentive set as the default
        const version = action.version || "";
        if (!version) continue;
        try {
          setAgentChatLoading(true);
          const res = await fetch(`${CLOUD_FUNCTION_URL}/set_default_incentive_set/${version}`, { method: "POST" });
          if (res.ok) {
            await fetchIncentiveSets();
            setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: `Incentive set ${version.slice(0, 12)} set as default.`, submittedAt: formatChatTimestamp(new Date()) }]);
          } else {
            const errData = await res.json().catch(() => ({}));
            setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: `Failed to set default: ${errData.error || res.statusText}`, submittedAt: formatChatTimestamp(new Date()) }]);
          }
        } catch (e: any) {
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: `Error setting default: ${e.message || "unknown error"}`, submittedAt: formatChatTimestamp(new Date()) }]);
        } finally {
          setAgentChatLoading(false);
        }

      // ---- Workflow CRUD actions ----
      } else if (action.type === "list_workflows") {
        try {
          setAgentChatLoading(true);
          const res = await fetch(`${CLOUD_FUNCTION_URL}/list_workflows`);
          const userWfs = res.ok ? (await res.json()).workflows || [] : [];
          setWorkflows(userWfs);
          // Merge built-in workflow(s) with user-created ones
          const allWfs = [
            { name: "Optimize portfolio", description: "Learn behavioral profiles from transaction data using clustering, then derive optimal incentive program through simulation.", type: "built-in" },
            ...userWfs.map((w: any) => ({ ...w, type: "custom" })),
          ];
          const lines = allWfs.map((w: any, i: number) => {
            const tag = w.type === "built-in" ? "built-in" : "custom";
            const date = w.created_at ? new Date(w.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
            return `${i + 1}. ${w.name} — ${w.description || "(no description)"} [${tag}]${date ? ` · ${date}` : ""}`;
          });
          const listText = lines.join("\n");
          setAgentChatMessages((prev) => {
            const copy = [...prev];
            for (let i = copy.length - 1; i >= 0; i--) {
              if (copy[i].role === "agent") {
                copy[i] = { ...copy[i], text: copy[i].text + "\n\n" + listText };
                return copy;
              }
            }
            return [...copy, { id: `${Date.now()}-sys`, role: "agent" as const, text: listText, submittedAt: formatChatTimestamp(new Date()) }];
          });
        } catch { /* silent */ } finally {
          setAgentChatLoading(false);
        }

      } else if (action.type === "create_workflow") {
        const name = action.name || "";
        const description = action.description || "";
        const detail = action.detail || "";
        if (!name) continue;
        try {
          setAgentChatLoading(true);
          const res = await fetch(`${CLOUD_FUNCTION_URL}/create_workflow`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, description, detail }),
          });
          if (res.ok) {
            const wf = await res.json();
            await fetchWorkflows();
            setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: `Workflow "${wf.name}" created.`, submittedAt: formatChatTimestamp(new Date()) }]);
          } else {
            const errData = await res.json().catch(() => ({}));
            setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: `Failed to create workflow: ${errData.error || res.statusText}`, submittedAt: formatChatTimestamp(new Date()) }]);
          }
        } catch (e: any) {
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: `Error creating workflow: ${e.message || "unknown error"}`, submittedAt: formatChatTimestamp(new Date()) }]);
        } finally {
          setAgentChatLoading(false);
        }

      } else if (action.type === "update_workflow") {
        const wfId = action.workflow_id || "";
        if (!wfId) continue;
        if (wfId.startsWith("builtin-")) {
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: "Built-in workflows cannot be modified.", submittedAt: formatChatTimestamp(new Date()) }]);
          continue;
        }
        try {
          setAgentChatLoading(true);
          const body: any = {};
          if (action.name) body.name = action.name;
          if (action.description !== undefined) body.description = action.description;
          if (action.detail !== undefined) body.detail = action.detail;
          const res = await fetch(`${CLOUD_FUNCTION_URL}/update_workflow/${wfId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (res.ok) {
            await fetchWorkflows();
            setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: `Workflow updated.`, submittedAt: formatChatTimestamp(new Date()) }]);
          } else {
            const errData = await res.json().catch(() => ({}));
            setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: `Failed to update workflow: ${errData.error || res.statusText}`, submittedAt: formatChatTimestamp(new Date()) }]);
          }
        } catch (e: any) {
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: `Error updating workflow: ${e.message || "unknown error"}`, submittedAt: formatChatTimestamp(new Date()) }]);
        } finally {
          setAgentChatLoading(false);
        }

      } else if (action.type === "request_delete_workflow") {
        const wfId = action.workflow_id || "";
        if (!wfId) continue;
        if (wfId.startsWith("builtin-")) {
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: "Built-in workflows cannot be deleted.", submittedAt: formatChatTimestamp(new Date()) }]);
          continue;
        }
        setPendingDeleteWorkflow(wfId);

      } else if (action.type === "confirm_delete_workflow") {
        const wfId = pendingDeleteWorkflowRef.current || action.workflow_id || "";
        if (!wfId) continue;
        try {
          setAgentChatLoading(true);
          const res = await fetch(`${CLOUD_FUNCTION_URL}/delete_workflow/${wfId}`, { method: "DELETE" });
          if (res.ok) {
            await fetchWorkflows();
            setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: "Workflow deleted.", submittedAt: formatChatTimestamp(new Date()) }]);
          } else {
            setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: "Failed to delete workflow.", submittedAt: formatChatTimestamp(new Date()) }]);
          }
        } catch {
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent" as const, text: "Error deleting workflow.", submittedAt: formatChatTimestamp(new Date()) }]);
        } finally {
          setPendingDeleteWorkflow(null);
          setAgentChatLoading(false);
        }

      } else if (action.type === "cancel_delete_workflow") {
        setPendingDeleteWorkflow(null);
      }
    }
  };

  const formatCustomColValue = (val: number, format: "dollar" | "percent" | "ratio" | "number") => {
    if (!isFinite(val)) return "—";
    switch (format) {
      case "dollar": return `$${Math.round(val).toLocaleString("en-US")}`;
      case "percent": return `${(val * 100).toFixed(1)}%`;
      case "ratio": return val.toFixed(2);
      default: return val.toLocaleString("en-US", { maximumFractionDigits: 2 });
    }
  };

  const submitAgentChat = async () => {
    const next = agentChatDraft.trim();
    const inWorkflowFlow = Boolean(pendingCreateWorkflowRef.current || pendingWorkflowActionRef.current || pendingEditWorkflowRef.current);
    if (agentChatLoading) return;
    if (!next && !inWorkflowFlow) return;
    const now = new Date();
    const ts = formatChatTimestamp(now);
    const userMsg = { id: `${Date.now()}-u`, role: "user" as const, text: next, submittedAt: ts };
    setAgentChatMessages((prev) => [...prev, userMsg]);
    setAgentChatDraft("");

    // Handle pending delete confirmation directly on the frontend (no LLM round-trip needed)
    const YES_RE = /^(y|yes|yep|yeah|yea|confirm|sure|ok|okay|do it|go ahead)$/i;
    const NO_RE = /^(n|no|nope|nah|cancel|never\s*mind|abort)$/i;
    if (pendingDeleteCatalogRef.current) {
      const lower = next.toLowerCase();
      if (YES_RE.test(lower)) {
        await executeAgentActions([{ type: "confirm_delete_profile" }]);
        return;
      } else if (NO_RE.test(lower)) {
        await executeAgentActions([{ type: "cancel_delete_profile" }]);
        const cancelReply = { id: `${Date.now()}-a`, role: "agent" as const, text: "Deletion cancelled.", submittedAt: formatChatTimestamp(new Date()) };
        setAgentChatMessages((prev) => [...prev, cancelReply]);
        return;
      }
      // If not a clear yes/no, fall through to backend
    }
    if (pendingDeleteIncentiveSetRef.current) {
      const lower = next.toLowerCase();
      if (YES_RE.test(lower)) {
        await executeAgentActions([{ type: "confirm_delete_incentive_set" }]);
        return;
      } else if (NO_RE.test(lower)) {
        await executeAgentActions([{ type: "cancel_delete_incentive_set" }]);
        const cancelReply = { id: `${Date.now()}-a`, role: "agent" as const, text: "Deletion cancelled.", submittedAt: formatChatTimestamp(new Date()) };
        setAgentChatMessages((prev) => [...prev, cancelReply]);
        return;
      }
    }
    if (pendingDeleteWorkflowRef.current) {
      const lower = next.toLowerCase();
      if (YES_RE.test(lower)) {
        await executeAgentActions([{ type: "confirm_delete_workflow" }]);
        return;
      } else if (NO_RE.test(lower)) {
        await executeAgentActions([{ type: "cancel_delete_workflow" }]);
        const cancelReply = { id: `${Date.now()}-a`, role: "agent" as const, text: "Deletion cancelled.", submittedAt: formatChatTimestamp(new Date()) };
        setAgentChatMessages((prev) => [...prev, cancelReply]);
        return;
      }
    }

    // --- Workflow CRUD: intercept locally (LLM cannot reliably distinguish workflow vs profile) ---
    const WORKFLOW_CREATE_RE = /^(create|add|new|make)\s+(a\s+)?(new\s+)?(custom\s+)?workflow$/i;
    const WORKFLOW_CREATE_NAMED_RE = /^(create|add|new|make)\s+(a\s+)?(new\s+)?(custom\s+)?workflow\s+(?:called|named|:)?\s*(.+)$/i;
    const WORKFLOW_LIST_RE = /^(list|show|my)\s+workflows?$/i;
    const lower = next.toLowerCase().trim();

    // Handle pending create-workflow conversation
    if (pendingCreateWorkflowRef.current) {
      const pending = pendingCreateWorkflowRef.current;
      if (pending.step === "awaiting_name") {
        const name = next.trim();
        if (!name) {
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent" as const, text: "Please provide a name for the workflow.", submittedAt: formatChatTimestamp(new Date()) }]);
          return;
        }
        setPendingCreateWorkflow({ step: "awaiting_description", name });
        setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent" as const, text: `Workflow name: "${name}". Provide a description (or press Enter to skip).`, submittedAt: formatChatTimestamp(new Date()) }]);
        return;
      }
      if (pending.step === "awaiting_description") {
        const desc = (!next.trim() || /^(skip|none|no|-|n\/a)$/i.test(next.trim())) ? "" : next.trim();
        setPendingCreateWorkflow({ step: "awaiting_detail", name: pending.name, description: desc });
        setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent" as const, text: `Provide detail for the workflow — this is the context the Agent uses to compose the UI when the card is clicked (or press Enter to skip).`, submittedAt: formatChatTimestamp(new Date()) }]);
        return;
      }
      if (pending.step === "awaiting_detail") {
        const detail = (!next.trim() || /^(skip|none|no|-|n\/a)$/i.test(next.trim())) ? "" : next.trim();
        setPendingCreateWorkflow(null);
        await executeAgentActions([{ type: "create_workflow", name: pending.name, description: pending.description, detail }]);
        return;
      }
    }

    // Handle pending workflow action selection (user picks a number)
    if (pendingWorkflowActionRef.current) {
      const pending = pendingWorkflowActionRef.current;
      const num = parseInt(next.trim(), 10);
      if (num >= 1 && num <= pending.candidates.length) {
        const selected = pending.candidates[num - 1];
        setPendingWorkflowAction(null);
        if (pending.action === "edit") {
          // Start the edit flow — ask what to change
          setPendingCreateWorkflow({ step: "awaiting_name" });
          // Repurpose create flow but pre-fill with existing data for context
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent" as const, text: `Editing "${selected.name}". Enter new name (or press Enter to keep current):`, submittedAt: formatChatTimestamp(new Date()) }]);
          // Store the workflow_id so we can update instead of create
          pendingWorkflowActionRef.current = { action: "edit", candidates: [selected] };
          return;
        } else if (pending.action === "delete") {
          setPendingDeleteWorkflow(selected.workflow_id);
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent" as const, text: `Delete workflow "${selected.name}"? Type "yes" to confirm or "no" to cancel.`, submittedAt: formatChatTimestamp(new Date()) }]);
          return;
        }
      } else if (/^(cancel|back|never\s*mind|abort)$/i.test(next.trim())) {
        setPendingWorkflowAction(null);
        setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent" as const, text: "Cancelled.", submittedAt: formatChatTimestamp(new Date()) }]);
        return;
      }
      // If we're in "edit" mode with a single candidate, user is providing the new name
      if (pending.action === "edit" && pending.candidates.length === 1) {
        const selected = pending.candidates[0];
        const newName = (!next.trim() || /^(skip|none|no|-|n\/a)$/i.test(next.trim())) ? undefined : next.trim();
        // Now ask for new description
        setPendingWorkflowAction(null);
        const editId = `${Date.now()}-edit`;
        // Do multi-field update: ask description next
        setAgentChatMessages((prev) => [...prev, { id: editId, role: "agent" as const, text: `Enter new description (or press Enter to keep current):`, submittedAt: formatChatTimestamp(new Date()) }]);
        // Store state for the next two steps
        setPendingEditWorkflow({ workflow_id: selected.workflow_id, name: newName, step: "awaiting_description" });
        return;
      }
      setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent" as const, text: `Please enter a number between 1 and ${pending.candidates.length}, or "cancel".`, submittedAt: formatChatTimestamp(new Date()) }]);
      return;
    }

    // Handle multi-step edit workflow (name → description → detail → save)
    if (pendingEditWorkflowRef.current) {
      const pe = pendingEditWorkflowRef.current;
      const skip = (!next.trim() || /^(skip|none|no|-|n\/a)$/i.test(next.trim()));
      if (pe.step === "awaiting_description") {
        const newDesc = skip ? undefined : next.trim();
        setPendingEditWorkflow({ ...pe, description: newDesc, step: "awaiting_detail" });
        setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent" as const, text: `Enter new detail (or press Enter to keep current):`, submittedAt: formatChatTimestamp(new Date()) }]);
        return;
      }
      if (pe.step === "awaiting_detail") {
        const newDetail = skip ? undefined : next.trim();
        setPendingEditWorkflow(null);
        const body: any = {};
        if (pe.name !== undefined) body.name = pe.name;
        if (pe.description !== undefined) body.description = pe.description;
        if (newDetail !== undefined) body.detail = newDetail;
        await executeAgentActions([{ type: "update_workflow", workflow_id: pe.workflow_id, ...body }]);
        return;
      }
    }

    // Detect "create workflow" commands
    const namedMatch = next.match(WORKFLOW_CREATE_NAMED_RE);
    if (namedMatch) {
      const name = namedMatch[5].trim();
      setPendingCreateWorkflow({ step: "awaiting_description", name });
      setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent" as const, text: `Workflow name: "${name}". Provide a description (or press Enter to skip).`, submittedAt: formatChatTimestamp(new Date()) }]);
      return;
    }
    if (WORKFLOW_CREATE_RE.test(lower)) {
      setPendingCreateWorkflow({ step: "awaiting_name" });
      setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent" as const, text: "What would you like to name the new workflow?", submittedAt: formatChatTimestamp(new Date()) }]);
      return;
    }

    // Detect "edit workflow" / "edit workflow N" / "edit N" (after workflow list) — list or directly select
    const WORKFLOW_EDIT_RE = /^(edit|update|modify|rename)\s+(a\s+)?(custom\s+)?workflow(\s+(\d+))?$/i;
    const WORKFLOW_EDIT_N_RE = /^(edit|update|modify|rename)\s+(\d+)$/i;
    const editMatch = next.match(WORKFLOW_EDIT_RE) || next.match(WORKFLOW_EDIT_N_RE);
    if (editMatch) {
      const customWfs = workflows.filter((w: any) => w.workflow_id && !w.workflow_id.startsWith("builtin-"));
      if (customWfs.length === 0) {
        setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent" as const, text: "No custom workflows to edit. Create one first.", submittedAt: formatChatTimestamp(new Date()) }]);
        return;
      }
      // Check if a number was provided (e.g. "edit 2" or "edit workflow 2")
      const numStr = editMatch[5] || editMatch[2];
      const num = numStr ? parseInt(numStr, 10) : NaN;
      if (num >= 1 && num <= customWfs.length) {
        // Direct selection — start edit flow for that workflow
        const selected = customWfs[num - 1];
        setPendingWorkflowAction({ action: "edit", candidates: [selected] });
        setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent" as const, text: `Editing "${selected.name}". Enter new name (or press Enter to keep current):`, submittedAt: formatChatTimestamp(new Date()) }]);
        return;
      }
      // No number or out of range — show list
      setPendingWorkflowAction({ action: "edit", candidates: customWfs });
      const lines = customWfs.map((w: any, i: number) => `${i + 1}. ${w.name}${w.description ? ` — ${w.description}` : ""}`);
      setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent" as const, text: `Which workflow to edit?\n\n${lines.join("\n")}`, submittedAt: formatChatTimestamp(new Date()) }]);
      return;
    }

    // Detect "delete workflow" / "delete workflow N" / "delete N" (after workflow list)
    const WORKFLOW_DELETE_RE = /^(delete|remove)\s+(a\s+)?(custom\s+)?workflow(\s+(\d+))?$/i;
    const WORKFLOW_DELETE_N_RE = /^(delete|remove)\s+(\d+)$/i;
    const deleteMatch = next.match(WORKFLOW_DELETE_RE) || next.match(WORKFLOW_DELETE_N_RE);
    if (deleteMatch) {
      const customWfs = workflows.filter((w: any) => w.workflow_id && !w.workflow_id.startsWith("builtin-"));
      if (customWfs.length === 0) {
        setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent" as const, text: "No custom workflows to delete.", submittedAt: formatChatTimestamp(new Date()) }]);
        return;
      }
      const numStr = deleteMatch[5] || deleteMatch[2];
      const num = numStr ? parseInt(numStr, 10) : NaN;
      if (num >= 1 && num <= customWfs.length) {
        const selected = customWfs[num - 1];
        setPendingDeleteWorkflow(selected.workflow_id);
        setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent" as const, text: `Delete workflow "${selected.name}"? Type "yes" to confirm or "no" to cancel.`, submittedAt: formatChatTimestamp(new Date()) }]);
        return;
      }
      setPendingWorkflowAction({ action: "delete", candidates: customWfs });
      const lines = customWfs.map((w: any, i: number) => `${i + 1}. ${w.name}${w.description ? ` — ${w.description}` : ""}`);
      setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent" as const, text: `Which workflow to delete?\n\n${lines.join("\n")}`, submittedAt: formatChatTimestamp(new Date()) }]);
      return;
    }

    // Detect "list workflows"
    if (WORKFLOW_LIST_RE.test(lower)) {
      // Add header first, then the action handler appends the list to it
      setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent" as const, text: "Available workflows:", submittedAt: formatChatTimestamp(new Date()) }]);
      await executeAgentActions([{ type: "list_workflows" }]);
      return;
    }

    // Non-actionable: handle locally (skip when agent just asked something — user may be replying with short input like "8", "y", etc.)
    const lastMsg = agentChatMessages[agentChatMessages.length - 1];
    const agentJustAsked = lastMsg?.role === "agent";
    if (!agentJustAsked && !pendingDeleteCatalogRef.current && !pendingDeleteIncentiveSetRef.current && !pendingDeleteWorkflowRef.current && (GREETING_RE.test(next) || isGibberish(next))) {
      const kind = GREETING_RE.test(next) ? "greeting" : "gibberish";
      const reply = { id: `${Date.now()}-a`, role: "agent" as const, text: pickCanned(kind), submittedAt: formatChatTimestamp(new Date()) };
      setAgentChatMessages((prev) => [...prev, reply]);
      return;
    }

    // Ensure incentive set detail is loaded so the LLM has full incentive data for analysis
    let freshIncentiveSetDetail: any = null;
    if (!selectedIncentiveSetDetail && (selectedIncentiveSetVersion || incentiveSets.length > 0)) {
      const versionToLoad = selectedIncentiveSetVersion || incentiveSets.find((s: any) => s.is_default)?.version || incentiveSets[0]?.version;
      if (versionToLoad) {
        try {
          const url = `${CLOUD_FUNCTION_URL}/incentive_set/${versionToLoad}`;
          const detailRes = await fetch(url);
          if (detailRes.ok) {
            freshIncentiveSetDetail = await detailRes.json();
            setSelectedIncentiveSetDetail(freshIncentiveSetDetail);
          }
        } catch { /* proceed without detail */ }
      }
    }

    // Route to backend with grid context
    setAgentChatLoading(true);
    try {
      const body: Record<string, any> = { message: next };
      // Always include grid context so the LLM can manage profiles, manipulate the grid, etc.
      body.grid_context = buildGridContext(freshIncentiveSetDetail ? { incentiveSetDetail: freshIncentiveSetDetail } : undefined);
      // Send recent conversation history for follow-up context (last 20 messages)
      const recentHistory = agentChatMessages.slice(-20).map((m) => ({ role: m.role === "user" ? "user" : "agent", text: m.text }));
      if (recentHistory.length > 0) body.history = recentHistory;
      const res = await fetch(`${CLOUD_FUNCTION_URL}/agent_chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      // Show the LLM's answer first
      const reply = { id: `${Date.now()}-a`, role: "agent" as const, text: data.answer ?? data.error ?? "Something went wrong.", submittedAt: formatChatTimestamp(new Date()) };
      setAgentChatMessages((prev) => [...prev, reply]);
      // Execute any structured actions returned by the backend (awaited so loading stays visible)
      if (Array.isArray(data.actions) && data.actions.length > 0) {
        await executeAgentActions(data.actions);
      }
    } catch {
      setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent" as const, text: "Connection error. Please try again.", submittedAt: formatChatTimestamp(new Date()) }]);
    } finally {
      setAgentChatLoading(false);
    }
  };
  const handleAgentChatKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    submitAgentChat();
  };
  const handleAgentChatSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    submitAgentChat();
  };

  const agentStoppingRef = useRef(false);
  const handleAgentStop = async () => {
    if (agentStoppingRef.current) return;
    agentStoppingRef.current = true;
    if (optimizeInProgress) {
      // Immediately guard against any further poll updates
      agentOptDoneRef.current = true;
      optimizationStopRequestedRef.current = true;
      agentOptLastStep.current = "";
      // Stop polling and clear all optimization state
      setOptimizationPolling(false);
      setOptimizeInProgress(false);
      const optId = optimizationId;
      setOptimizationState(null);
      setOptimizationId(null);
      setSelectedSavedOptimizationId(null);
      setShowOptimizationProgress(false);
      setOptimizationStopPhase("idle");
      setGenLoading(false);
      setOptimizationStarting(false);
      // Clear cache for this optimization
      if (optId) {
        delete optimizationCacheRef.current[optId];
      }
      // Cancel and delete on server, then refresh list
      if (optId) {
        (async () => {
          try {
            await fetch(`${CLOUD_FUNCTION_URL}/cancel_optimize/${optId}`, { method: "POST" }).catch(() => {});
            await fetch(`${CLOUD_FUNCTION_URL}/delete_optimize/${optId}`, { method: "DELETE" }).catch(() => {});
          } finally {
            // Clear cache again in case polling re-added it
            delete optimizationCacheRef.current[optId];
            await fetchSavedOptimizations(selectedCatalogVersion || undefined);
          }
        })();
      }
      // Replace progress message (or any leftover) with cancellation notice
      const stoppedId = `${Date.now()}-stopped`;
      setAgentChatMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === "opt-progress");
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = { ...copy[idx], id: stoppedId, text: "Optimization stopped.", submittedAt: formatChatTimestamp(new Date()) };
          return copy;
        }
        // If opt-progress already renamed, just append
        return [...prev, { id: stoppedId, role: "agent" as const, text: "Optimization stopped.", submittedAt: formatChatTimestamp(new Date()) }];
      });
    } else if (learnInProgress) {
      // Abort profile creation fetch
      if (agentLearnAbortRef.current) {
        agentLearnAbortRef.current.abort();
        agentLearnAbortRef.current = null;
      }
      setLearnInProgress(false);
      setAgentChatLoading(false);
      setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-stopped`, role: "agent" as const, text: "Profile creation stopped.", submittedAt: formatChatTimestamp(new Date()) }]);
    }
    agentStoppingRef.current = false;
  };

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    const el = agentChatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [agentChatMessages, agentChatLoading]);

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: C.bg, fontFamily: "'IBM Plex Mono', 'SF Mono', Menlo, monospace", color: C.text }}>
      <NavRail
        view={activeView}
        setView={(v) => {
          if (v !== "welcome") setActiveWorkflow(null);
          setActiveView(v);
        }}
      />

      {/* Canvas — full remaining width */}
      <div className="flex-1 overflow-hidden" style={{ background: "#070a09" }}>
        <div
          ref={splitContainerRef}
          className="relative flex h-full overflow-hidden bg-[#070a09]"
        >
          <section
            className="min-h-0 overflow-auto"
            style={{ width: isDesktopViewport ? `${splitRatio}%` : "100%" }}
          >
            {/* Home shows the active workflow template (default: Profile Generator) */}

            {activeView === "workflow" && (
              <WorkflowCanvas
                workflows={workflows}
                onTemplate={(t) => {
                  if (t.cat === "User Profiler") {
                    setActiveView("profiler");
                    setProfilerTab("test");
                  } else if (t.cat === "Profile Generator") {
                    setActiveWorkflow(null);
                    setActiveView("welcome");
                    setGeneratorTab("optimize");
                  } else if (t.cat === "Custom") {
                    // Find the full workflow object to get the detail field
                    const wf = workflows.find((w) => w.workflow_id === t.id);
                    setActiveWorkflow({
                      id: t.id,
                      name: t.text,
                      description: t.desc,
                      detail: wf?.detail || t.desc || t.text,
                    });
                    setActiveView("welcome");
                  }
                }}
              />
            )}

            {activeView === "dataroom" && <DataroomCanvas datasets={uploadedDatasets} />}

            {activeView === "profiler" && (
              <div className="p-3 md:p-4">
                <div className="mx-auto max-w-6xl space-y-6">
                  {error && (
                    <div className="rounded-md bg-red-50 p-4 text-red-700 border border-red-200">
                      {error}
                    </div>
                  )}

                  <div className="space-y-6">

                <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-sm flex flex-col min-h-[260px]">
                  {/* Tabs Header */}
                  <div className="flex border-b border-[#E5E7EB] px-2 pt-2">
                    <button
                      onClick={() => setProfilerTab("test")}
                      className={cn(
                        "px-6 py-3 text-sm border-b-2 -mb-px transition-colors flex items-center gap-2",
                        profilerTab === "test"
                          ? "border-black text-black font-bold"
                          : "font-medium border-transparent text-slate-500 hover:text-slate-700"
                      )}
                    >
                      <Users className="h-4 w-4" />
                      Test Users
                    </button>
                    <button
                      onClick={() => setProfilerTab("upload")}
                      className={cn(
                        "px-6 py-3 text-sm border-b-2 -mb-px transition-colors flex items-center gap-2",
                        profilerTab === "upload"
                          ? "border-black text-black font-bold"
                          : "font-medium border-transparent text-slate-500 hover:text-slate-700"
                      )}
                    >
                      <Upload className="h-4 w-4" />
                      Upload CSV
                    </button>
                  </div>

                  {/* Tab Content */}
                  <div className="p-6 flex-1 flex flex-col">
                    {/* Test Users Tab */}
                    {profilerTab === "test" && (
                      <div className="flex-1 flex flex-col">
                        {testUsersLoading ? (
                          <div className="flex items-center gap-2 text-slate-500">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Loading test users...
                          </div>
                        ) : testUserIds.length === 0 ? (
                          <p className="text-sm text-red-500">No test users found. Check data/test-users/ directory.</p>
                        ) : (
                          <>
                            <div>
                              <select
                                value={selectedUserId}
                                onChange={(e) => setSelectedUserId(e.target.value)}
                                className="rounded-md border px-3 py-2 text-sm bg-white min-w-[200px]"
                              >
                                {testUserIds.map((id) => (
                                  <option key={id} value={id}>
                                    User {id}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="mt-auto flex items-center gap-4 pt-4">
                              <button
                                onClick={loading ? stopProfilerProcess : analyzeTestUser}
                                disabled={!selectedUserId}
                                aria-label="Submit"
                                title={loading ? "Stop" : "Submit"}
                                className="rounded-full bg-black w-8 h-8 text-white hover:opacity-80 disabled:opacity-50 flex items-center justify-center shrink-0"
                              >
                                {loading
                                  ? <Square className="h-3.5 w-3.5" />
                                  : <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
                                }
                              </button>
                              {loading && <InlineAnalyzingIndicator />}
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* Upload CSV Tab */}
                    {profilerTab === "upload" && (
                      <div className="flex-1 flex flex-col">
                        <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:gap-6">
                          <label className="flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-slate-300 py-4 hover:border-blue-500 hover:bg-slate-50 transition-colors w-full sm:w-1/2 shrink-0">
                            <div className="text-center">
                              <Upload className="mx-auto h-5 w-5 text-slate-400 mb-1" />
                              <span className="text-sm text-slate-600">
                                Click or drag CSV here
                              </span>
                            </div>
                            <input
                              type="file"
                              accept=".csv"
                              className="hidden"
                              onChange={handleFileUpload}
                            />
                          </label>

                          {file && (
                            <div className="flex-1 text-sm font-semibold text-slate-700 break-all sm:truncate">
                              {file.name}
                            </div>
                          )}
                        </div>

                        <div className="mt-auto flex items-center gap-4 pt-4">
                          <button
                            onClick={loading ? stopProfilerProcess : () => processFile()}
                            disabled={!file}
                            aria-label="Submit"
                            title={loading ? "Stop" : "Submit"}
                            className="rounded-full bg-black w-8 h-8 text-white hover:opacity-80 disabled:opacity-50 flex items-center justify-center shrink-0"
                          >
                            {loading
                              ? <Square className="h-3.5 w-3.5" />
                              : <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
                            }
                          </button>
                          {loading && <InlineAnalyzingIndicator />}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Results Dashboard */}
                {results && (
                  <div className="space-y-8">
                    {/* TOON Results Output */}
                    <div className="overflow-hidden px-2">
                      <pre className="text-sm text-slate-900 overflow-x-auto whitespace-pre-wrap">
                        {formatToon(results.profile, results.card_recommendations)}
                      </pre>
                    </div>

                    {/* Duplicate Profile Assignment UI */}
                    {results.assignment && (
                      <div className="px-2 pt-4 border-t border-slate-200">
                        <ProfileAssignmentView assignment={results.assignment} />
                      </div>
                    )}
                  </div>
                )}
                  </div>
                </div>
              </div>
            )}

            {(activeView === "welcome" || activeView === "generator") && (
              <div style={{ padding: "28px 24px 18px" }}>
                <div className="mx-auto max-w-6xl space-y-6">
                  {activeView === "generator" && genError && (
                    <div className="rounded-md bg-red-50 p-4 text-red-700 border border-red-200">
                      {genError}
                    </div>
                  )}
              {activeView === "generator" &&
              <ProfileGeneratorView
                genLoading={genLoading}
                genError={genError}
                learnStatus={learnStatus}
                learnInProgress={learnInProgress}
                generatorTab={generatorTab}
                setGeneratorTab={setGeneratorTab}
                learnSource={learnSource}
                setLearnSource={setLearnSource}
                learnUploadName={learnUploadName}
                setLearnUploadName={setLearnUploadName}
                learnUploadFile={learnUploadFile}
                setLearnUploadFile={setLearnUploadFile}
                learnUploadSubmitted={learnUploadSubmitted}
                setLearnUploadSubmitted={setLearnUploadSubmitted}
                pendingUploadedPortfolioName={pendingUploadedPortfolioName}
                setPendingUploadedPortfolioName={setPendingUploadedPortfolioName}
                uploadedDatasets={uploadedDatasets}
                deleteSelectedPortfolio={deleteSelectedPortfolio}
                learnK={learnK}
                setLearnK={setLearnK}
                learnProfiles={learnProfiles}
                stopLearnProcess={stopLearnProcess}
                catalog={catalog}
                catalogList={catalogList}
                selectedCatalogVersion={selectedCatalogVersion}
                setSelectedCatalogVersion={setSelectedCatalogVersion}
                loadCatalog={loadCatalog}
                startOptimization={startOptimization}
                stopOptimization={stopOptimization}
                deleteOptimization={deleteOptimization}
                deleteCatalog={deleteCatalog}
                optimizationState={optimizationState}
                optimizationStarting={optimizationStarting}
                optimizeInProgress={optimizeInProgress}
                optimizationStopPhase={optimizationStopPhase}
                showOptimizationProgress={showOptimizationProgress}
                savedOptimizations={savedOptimizations}
                selectedSavedOptimizationId={selectedSavedOptimizationId}
                loadSavedOptimization={loadSavedOptimization}
                fetchSavedOptimizations={fetchSavedOptimizations}
                incentiveSets={incentiveSets}
                selectedIncentiveSetVersion={selectedIncentiveSetVersion}
                setSelectedIncentiveSetVersion={setSelectedIncentiveSetVersion}
                selectedIncentiveSetDetail={selectedIncentiveSetDetail}
                incentiveSetDetailLoading={incentiveSetDetailLoading}
                gridCustomColumns={gridCustomColumns}
                formatCustomColValue={formatCustomColValue}
              />
              }

              {/* Custom Workflow Screen */}
              {activeView === "welcome" && activeWorkflow && (
                <div className="space-y-4">
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <h3 className="text-xs font-bold tracking-wider" style={{ color: "#00aaff" }}>{activeWorkflow.name}</h3>
                      <p className="text-[10px] mt-1" style={{ color: C.muted }}>{activeWorkflow.description}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveWorkflow(null)}
                      className="text-[10px] tracking-wider hover:underline underline-offset-2"
                      style={{ color: C.accentDim }}
                    >
                      Back
                    </button>
                  </div>

                  {/* Incentive Set Picker */}
                  <div className="flex flex-col gap-4 max-w-[66%]">
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] tracking-wider font-semibold" style={{ color: C.muted }}>Incentive Set</label>
                      <Dropdown
                        value={selectedIncentiveSetVersion || ""}
                        options={incentiveSets.map((s: any) => ({
                          value: s.version,
                          label: `${s.name || s.version} (${s.incentive_count} incentives)${s.is_default ? " *" : ""}`,
                        }))}
                        onChange={(val) => {
                          setSelectedIncentiveSetVersion(val);
                          loadIncentiveSetDetail(val);
                        }}
                        className="w-full"
                      />
                    </div>
                  </div>

                  {/* Incentive Items */}
                  {incentiveSetDetailLoading && (
                    <div className="flex items-center gap-2 py-4">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: C.muted }} />
                      <span className="text-xs" style={{ color: C.muted }}>Loading incentives…</span>
                    </div>
                  )}
                  {!incentiveSetDetailLoading && selectedIncentiveSetDetail && (
                    <div className="rounded-xl border overflow-hidden" style={{ borderColor: C.border, background: C.surface }}>
                      <div className="px-4 py-2.5 border-b text-[10px] tracking-wider font-semibold" style={{ borderColor: C.border, color: C.muted }}>
                        {selectedIncentiveSetDetail.name || selectedIncentiveSetDetail.version} — {(selectedIncentiveSetDetail.incentives || []).length} incentives
                      </div>
                      {(selectedIncentiveSetDetail.incentives || []).length === 0 ? (
                        <p className="text-xs px-4 py-3" style={{ color: C.muted }}>No incentives in this set.</p>
                      ) : (
                        <div className="px-4 py-3 flex flex-wrap gap-1.5">
                          {(selectedIncentiveSetDetail.incentives || []).map((inc: any, idx: number) => (
                            <span
                              key={idx}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border"
                              style={{ borderColor: C.border, background: "white", color: "black" }}
                            >
                              {inc.name}
                              <span style={{ color: C.muted }}>
                                ${Math.round((inc.estimated_annual_cost_per_user || 0) * (inc.redemption_rate || 1))}
                              </span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Most Recent Optimal Incentive Program */}
              {(activeView === "generator" || !activeWorkflow) && (
              <div className="space-y-4">
                  <h3 className="text-xs font-bold tracking-wider" style={{ color: "#00aaff" }}>Optimize Portfolio</h3>

                  {/* Context dropdowns */}
                  <div className="flex flex-col gap-4 max-w-[66%]">
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] tracking-wider font-semibold" style={{ color: C.muted }}>Portfolio</label>
                      <div className="flex items-center gap-2">
                        <Dropdown
                          value={learnSource}
                          options={uploadedDatasets.map((d: any) => ({
                            value: `uploaded-dataset:${d.dataset_id}`,
                            label: `${d.upload_name || d.dataset_id} (${d.row_count || 0} rows)`,
                          }))}
                          onChange={(val) => {
                            setLearnSource(val);
                            const newDatasetId = val.startsWith("uploaded-dataset:") ? val.replace("uploaded-dataset:", "") : "";
                            const newDataset = uploadedDatasets.find((d: any) => d.dataset_id === newDatasetId);
                            const newName = newDataset?.upload_name || newDatasetId;
                            const newRowCount = Number(newDataset?.row_count ?? 0);
                            const hasCatalogs = newRowCount > 0 && catalogList.some((c: any) => String(c.source || "").toLowerCase().includes(newName.toLowerCase()));
                            if (hasCatalogs && selectedCatalogVersion) {
                              fetchSavedOptimizations(selectedCatalogVersion);
                            } else {
                              setOptimizationState(null);
                              setSelectedSavedOptimizationId("");
                            }
                          }}
                          className="w-full"
                        />
                        <span className="text-[10px] tracking-wider shrink-0 invisible">Show</span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] tracking-wider font-semibold" style={{ color: C.muted }}>Profile</label>
                      {(() => {
                        const selectedDatasetId = learnSource.startsWith("uploaded-dataset:") ? learnSource.replace("uploaded-dataset:", "") : "";
                        const selectedDataset = uploadedDatasets.find((d: any) => d.dataset_id === selectedDatasetId);
                        const portfolioName = selectedDataset?.upload_name || selectedDatasetId;
                        const portfolioRowCount = Number(selectedDataset?.row_count ?? 0);
                        const filtered = portfolioRowCount === 0 ? [] : catalogList.filter((c: any) => {
                          if (!portfolioName) return true;
                          const src = String(c.source || "").toLowerCase();
                          return src.includes(portfolioName.toLowerCase());
                        });
                        return filtered.length > 0 ? (
                          <>
                            <div className="flex items-center gap-2">
                              <Dropdown
                                value={selectedCatalogVersion}
                                options={filtered.map((c: any) => ({
                                  value: c.version,
                                  label: `${c.version} (${c.profile_count} profiles)`,
                                }))}
                                onChange={(val) => {
                                  setSelectedCatalogVersion(val);
                                  loadCatalog(val);
                                  fetchSavedOptimizations(val);
                                  setShowRecentCatalogDetail(false);
                                }}
                                mono
                                className="w-full"
                              />
                              <button
                                type="button"
                                onClick={() => setShowRecentCatalogDetail(v => !v)}
                                className="text-[10px] tracking-wider hover:underline underline-offset-2 shrink-0"
                                style={{ color: C.accentDim }}
                              >
                                {showRecentCatalogDetail ? "Hide" : "Show"}
                              </button>
                            </div>
                            {showRecentCatalogDetail && catalog && (
                              <div className="mt-2 rounded-lg border overflow-x-clip" style={{ borderColor: C.border, background: C.surface }}>
                                <div className="px-3 py-2 border-b text-[10px] tracking-wider font-semibold sticky top-0 z-10" style={{ borderColor: C.border, color: C.muted, background: C.surface }}>
                                  Version: <span className="font-mono">{catalog.version}</span> · Source: {catalog.source} · K={catalog.k}
                                  {catalog.total_learning_population > 0 && ` · ${catalog.total_learning_population.toLocaleString()} users`}
                                </div>
                                <table className="w-full text-xs">
                                  <thead className="sticky top-7 z-10" style={{ background: C.surface }}>
                                    <tr style={{ borderBottom: `1px solid ${C.border}`, color: C.muted }}>
                                      <th className="py-2 px-3 text-left font-medium w-8"></th>
                                      <th className="py-2 pr-4 text-left font-medium">Profile ID</th>
                                      <th className="py-2 pr-4 text-left font-medium">Description</th>
                                      <th className="py-2 pr-4 text-right font-medium">Portfolio LTV</th>
                                      <th className="py-2 pr-4 text-right font-medium">Population</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {catalog.profiles.map((p: any) => (
                                      <tr key={p.profile_id} style={{ borderBottom: `1px solid ${C.border}` }}>
                                        <td className="py-2 px-3" style={{ color: C.muted }}>
                                          <ChevronRight className="h-3 w-3" />
                                        </td>
                                        <td className="py-2 pr-4">
                                          <div className="flex items-center gap-2">
                                            <span className={cn(
                                              "inline-flex items-center justify-center rounded-full text-white text-[10px] font-bold w-6 h-6 shrink-0",
                                              p.description?.toLowerCase().includes("return-heavy") ? "bg-amber-600" : "bg-[#3bb266]"
                                            )}>
                                              {p.profile_id}
                                            </span>
                                            {p.label && <span className="text-[10px] font-semibold" style={{ color: C.muted }}>{p.label}</span>}
                                          </div>
                                        </td>
                                        <td className="py-2 pr-4" style={{ color: C.textSec }}>{p.description}</td>
                                        <td className="py-2 pr-4 text-right font-mono" style={{ color: C.textSec }}>
                                          {p.portfolio_ltv != null ? `${p.portfolio_ltv < 0 ? '-' : ''}$${Math.abs(p.portfolio_ltv).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '—'}
                                        </td>
                                        <td className="py-2 pr-4 text-right font-mono" style={{ color: C.muted }}>
                                          {p.population_count > 0 ? p.population_count.toLocaleString() : ''}
                                          <span className="ml-1">({(p.population_share * 100).toFixed(1)}%)</span>
                                        </td>
                                      </tr>
                                    ))}
                                    <tr style={{ background: C.surfaceLt }}>
                                      <td className="py-3 px-3" colSpan={3}>
                                        <span className="text-[9px] tracking-wider font-bold" style={{ color: C.muted }}>Total Portfolio LTV</span>
                                      </td>
                                      <td className="py-3 pr-4 text-right font-mono font-bold" style={{ color: C.text, borderTop: `1px solid ${C.border}` }}>
                                        {(() => {
                                          const total = catalog.profiles.reduce((s: number, p: any) => s + (p.portfolio_ltv || 0), 0);
                                          return `${total < 0 ? '-' : ''}$${Math.abs(total).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
                                        })()}
                                      </td>
                                      <td style={{ borderTop: `1px solid ${C.border}` }}></td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-xs px-3 py-1.5" style={{ color: C.muted }}>No profiles for this portfolio</span>
                        );
                      })()}
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] tracking-wider font-semibold" style={{ color: C.muted }}>Incentive Set</label>
                      <div className="flex items-center gap-2">
                        <Dropdown
                          value={selectedIncentiveSetVersion || optimizationState?.incentive_set_version || ""}
                          options={incentiveSets.map((s: any) => ({
                            value: s.version,
                            label: `${s.name || s.version} (${s.incentive_count} incentives)${s.is_default ? " *" : ""}`,
                          }))}
                          onChange={(val) => {
                            setSelectedIncentiveSetVersion(val);
                            setOptimizationState(null);
                            setSelectedSavedOptimizationId("");
                            setShowRecentIncentiveDetail(false);
                          }}
                          className="w-full"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const next = !showRecentIncentiveDetail;
                            setShowRecentIncentiveDetail(next);
                            if (next && !selectedIncentiveSetDetail) {
                              loadIncentiveSetDetail(selectedIncentiveSetVersion || optimizationState?.incentive_set_version || undefined);
                            }
                          }}
                          className="text-[10px] tracking-wider hover:underline underline-offset-2 shrink-0"
                          style={{ color: C.accentDim }}
                        >
                          {showRecentIncentiveDetail ? "Hide" : "Show"}
                        </button>
                      </div>
                      {showRecentIncentiveDetail && selectedIncentiveSetDetail && (
                        <div className="mt-2 rounded-lg border overflow-hidden" style={{ borderColor: C.border, background: C.surface }}>
                          <div className="px-3 py-2 border-b text-[10px] tracking-wider font-semibold" style={{ borderColor: C.border, color: C.muted }}>
                            {selectedIncentiveSetDetail.name || selectedIncentiveSetDetail.version} ({(selectedIncentiveSetDetail.incentives || []).length} incentives)
                          </div>
                          <div className="px-3 py-2">
                            {(selectedIncentiveSetDetail.incentives || []).length === 0 ? (
                              <p className="text-xs" style={{ color: C.muted }}>No incentives loaded.</p>
                            ) : (
                              <div className="flex flex-wrap gap-1.5">
                                {(selectedIncentiveSetDetail.incentives || []).map((inc: any, idx: number) => (
                                  <span key={idx} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border" style={{ borderColor: C.border, background: "white", color: "black" }}>
                                    {inc.name}
                                    <span style={{ color: C.muted }}>
                                      ${Math.round((inc.estimated_annual_cost_per_user || 0) * (inc.redemption_rate || 1))}
                                    </span>
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Results table */}
                  {optimizationState?.results && optimizationState.results.length > 0 && (
                  <div className="rounded-xl border px-6 pb-6 pt-3 space-y-4" style={{ borderColor: C.border, background: C.surface }}>
                    <h4 className="text-xs font-bold tracking-wider sticky top-0 z-10 pb-2" style={{ color: "#00aaff", background: C.surface }}>Optimal Incentive Program</h4>
                    <div className="overflow-x-clip">
                      <table className="w-full text-sm">
                        <thead className="sticky top-6 z-10" style={{ background: C.surface }}>
                          <tr style={{ borderBottom: `1px solid ${C.border}`, color: C.muted }}>
                            <th className="py-2 pr-4 font-medium text-left">Profile ID</th>
                            <th className="py-2 pr-4 font-medium text-left">Assigned Incentive(s)</th>
                            <th className="py-2 pr-4 font-medium text-right">Orig LTV</th>
                            <th className="py-2 pr-4 font-medium text-right">Gross LTV</th>
                            <th className="py-2 pr-4 font-medium text-right">Cost</th>
                            <th className="py-2 pr-4 font-medium text-right">Lift</th>
                            <th className="py-2 pr-4 font-bold text-right">Final LTV</th>
                            {gridCustomColumns.map((col) => (
                              <th key={col.id} className="py-2 pr-4 font-medium text-right" style={{ color: "#00aaff" }}>{col.label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {optimizationState.results.map((r: any) => (
                            <tr key={r.profile_id} style={{ borderBottom: `1px solid ${C.border}` }}>
                              <td className="py-3 pr-4 font-semibold" style={{ color: C.text }}>{r.profile_id}</td>
                              <td className="py-3 pr-4">
                                <div className="flex flex-wrap gap-1">
                                  {(r.selected_incentives || []).map((inc: string, idx: number) => (
                                    <span key={idx} className="inline-flex px-2 py-0.5 rounded text-xs font-semibold bg-white text-black">
                                      {inc}
                                    </span>
                                  ))}
                                  {(!r.selected_incentives || r.selected_incentives.length === 0) && (
                                    <span className="text-xs" style={{ color: C.muted }}>None</span>
                                  )}
                                </div>
                              </td>
                              <td className="py-3 pr-4 text-right font-mono" style={{ color: C.muted }}>
                                {`$${Math.round(r.original_portfolio_ltv).toLocaleString('en-US')}`}
                              </td>
                              <td className="py-3 pr-4 text-right font-mono" style={{ color: C.textSec }}>
                                {`$${Math.round(r.new_gross_portfolio_ltv).toLocaleString('en-US')}`}
                              </td>
                              <td className="py-3 pr-4 text-right font-mono" style={{ color: C.textSec }}>
                                {`${r.portfolio_cost > 0 ? '-' : ''}$${Math.round(Math.abs(r.portfolio_cost)).toLocaleString('en-US')}`}
                              </td>
                              <td className="py-3 pr-4 text-right font-mono" style={{ color: C.textSec }}>
                                {`+$${Math.round(r.lift).toLocaleString('en-US')}`}
                              </td>
                              <td className="py-3 pr-4 text-right font-mono font-bold" style={{ color: C.text }}>
                                {`$${Math.round(r.new_net_portfolio_ltv).toLocaleString('en-US')}`}
                              </td>
                              {gridCustomColumns.map((col) => (
                                <td key={col.id} className="py-3 pr-4 text-right font-mono" style={{ color: "#00aaff" }}>
                                  {formatCustomColValue(col.expr(r), col.format)}
                                </td>
                              ))}
                            </tr>
                          ))}
                          <tr style={{ background: C.surfaceLt }}>
                            <td className="py-4 pr-4" colSpan={2}>
                              <span className="text-[10px] tracking-wider font-bold" style={{ color: C.muted }}>Maximized Total Portfolio</span>
                            </td>
                            <td className="py-4 pr-4 text-right font-mono font-bold" style={{ color: C.text, borderTop: `1px solid ${C.border}` }}>
                              {`$${Math.round(optimizationState.results.reduce((s: number, r: any) => s + (r.original_portfolio_ltv || 0), 0)).toLocaleString('en-US')}`}
                            </td>
                            <td className="py-4 pr-4 text-right font-mono" style={{ color: C.textSec, borderTop: `1px solid ${C.border}` }}>
                              {`$${Math.round(optimizationState.results.reduce((s: number, r: any) => s + (r.new_gross_portfolio_ltv || 0), 0)).toLocaleString('en-US')}`}
                            </td>
                            <td className="py-4 pr-4 text-right font-mono" style={{ color: C.textSec, borderTop: `1px solid ${C.border}` }}>
                              {`-$${Math.round(optimizationState.results.reduce((s: number, r: any) => s + (r.portfolio_cost || 0), 0)).toLocaleString('en-US')}`}
                            </td>
                            <td className="py-4 pr-4 text-right font-mono font-bold" style={{ color: C.textSec, borderTop: `1px solid ${C.border}` }}>
                              {`+$${Math.round(optimizationState.results.reduce((s: number, r: any) => s + (r.lift || 0), 0)).toLocaleString('en-US')}`}
                            </td>
                            <td className="py-4 pr-4 text-right font-mono font-bold" style={{ color: C.text, borderTop: `1px solid ${C.border}` }}>
                              {`$${Math.round(optimizationState.results.reduce((s: number, r: any) => s + (r.new_net_portfolio_ltv || 0), 0)).toLocaleString('en-US')}`}
                            </td>
                            {gridCustomColumns.map((col) => {
                              const results = optimizationState.results as any[];
                              const vals = results.map((r: any) => col.expr(r));
                              const agg = col.totalsExpr === "avg"
                                ? vals.reduce((s, v) => s + v, 0) / (vals.length || 1)
                                : vals.reduce((s, v) => s + v, 0);
                              return (
                                <td key={col.id} className="py-4 pr-4 text-right font-mono font-bold" style={{ color: "#00aaff", borderTop: `1px solid ${C.border}` }}>
                                  {formatCustomColValue(agg, col.format)}
                                </td>
                              );
                            })}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div className="text-xs px-1" style={{ color: C.muted }}>
                      Convergence-based optimization: each profile iterates until rolling outcomes statistically stabilize (low variance + near-zero trend), with max-iteration and patience guards. Only net-positive incentives retained (marginal LTV &gt; effective cost).
                    </div>
                  </div>
                  )}
              </div>
              )}
                </div>
              </div>
            )}

          </section>

          {isDesktopViewport && (
            <>
              <aside className="min-h-0 flex-1 overflow-hidden bg-[#111820] p-3 md:p-4">
                  <div className="flex h-full min-h-0 flex-col">
                    <div className="flex min-h-0 flex-1 flex-col bg-transparent">
                      <div ref={agentChatScrollRef} className="min-h-0 flex-1 overflow-auto px-4 py-1 flex flex-col [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        <div className="flex-1" />
                        {agentChatMessages.length === 0 ? (
                          <div className="mb-0.5 flex items-center gap-2.5">
                            <img src="/linex-icon.svg" alt="Agent" className="h-[14px] w-[14px] shrink-0" />
                            <h2 className="text-sm leading-tight text-[#3bb266]">
                              {typedWelcomeLine}
                            </h2>
                          </div>

                        ) : (
                          <div className="space-y-3">
                            {agentChatMessages.map((message) => (
                              <div key={message.id} className={`flex max-w-[85%] flex-col ${message.role === "user" ? "ml-auto items-end" : "mr-auto items-start"}`}>
                                <div className={`w-fit rounded-md px-3 py-2 ${message.role === "user" ? "border border-[#5f6670] bg-[#0d1218] text-right" : "text-left"}`}>
                                  {message.id === "opt-progress" && (
                                    <div className="mb-1.5 flex items-center gap-2">
                                      <svg width="14" height="14" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <defs>
                                          <clipPath id="optProgressClip">
                                            <rect x="0" y="0" width="44" height="0">
                                              <animate attributeName="height" values="0;44;44;0" keyTimes="0;0.4;0.8;1" dur="2s" repeatCount="indefinite" />
                                            </rect>
                                          </clipPath>
                                        </defs>
                                        <g clipPath="url(#optProgressClip)">
                                          <path d="M11.2383 44H0L2.93359 40H14.1729L11.2383 44ZM17.1074 36H5.86816L8.80273 32H20.042L17.1074 36ZM22.9756 28H11.7363L14.6709 24H25.9102L22.9756 28ZM28.8447 20H17.6055L20.54 16H31.7793L28.8447 20ZM34.7139 12H23.4746L26.4092 8H37.6484L34.7139 12ZM40.583 4H29.3438L32.2783 0H43.5176L40.583 4Z" fill="#3bb266"/>
                                          <path d="M42.3877 44H30.9336L28.1143 40H39.5693L42.3877 44ZM36.75 36H25.2949L22.4756 32H33.9307L36.75 36ZM31.1113 28H22.9756L25.9102 24H28.292L31.1113 28ZM17.6055 20H14.0176L11.1982 16H20.54L17.6055 20ZM19.835 12H8.37988L5.56055 8H17.0156L19.835 12ZM14.1963 4H2.74121L0.264648 0.486328H11.7197L14.1963 4Z" fill="#3bb266"/>
                                        </g>
                                      </svg>
                                    </div>
                                  )}
                                  <p className={`text-sm break-words whitespace-pre-wrap ${message.role === "user" ? "text-[#3bb266]" : "text-[#9ca3af]"}`}>{message.text}</p>
                                </div>
                                {message.id !== "opt-progress" && <p className="mt-1 whitespace-nowrap text-[10px] text-[#6f7782]">{message.submittedAt}</p>}
                              </div>
                            ))}
                            {agentChatLoading && (
                              <div className="mr-auto flex max-w-[85%] flex-col items-start">
                                <div className="w-fit rounded-md px-3 py-2 flex items-center">
                                  <svg width="16" height="16" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <defs>
                                      <clipPath id="agentDrawClip">
                                        <rect x="0" y="0" width="44" height="0">
                                          <animate attributeName="height" values="0;44;44;0" keyTimes="0;0.4;0.8;1" dur="2s" repeatCount="indefinite" />
                                        </rect>
                                      </clipPath>
                                    </defs>
                                    <g clipPath="url(#agentDrawClip)">
                                      <path d="M11.2383 44H0L2.93359 40H14.1729L11.2383 44ZM17.1074 36H5.86816L8.80273 32H20.042L17.1074 36ZM22.9756 28H11.7363L14.6709 24H25.9102L22.9756 28ZM28.8447 20H17.6055L20.54 16H31.7793L28.8447 20ZM34.7139 12H23.4746L26.4092 8H37.6484L34.7139 12ZM40.583 4H29.3438L32.2783 0H43.5176L40.583 4Z" fill="#3bb266"/>
                                      <path d="M42.3877 44H30.9336L28.1143 40H39.5693L42.3877 44ZM36.75 36H25.2949L22.4756 32H33.9307L36.75 36ZM31.1113 28H22.9756L25.9102 24H28.292L31.1113 28ZM17.6055 20H14.0176L11.1982 16H20.54L17.6055 20ZM19.835 12H8.37988L5.56055 8H17.0156L19.835 12ZM14.1963 4H2.74121L0.264648 0.486328H11.7197L14.1963 4Z" fill="#3bb266"/>
                                    </g>
                                  </svg>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="shrink-0 px-4 py-3">
                        <form className="relative" onSubmit={handleAgentChatSubmit}>
                          <span className="pointer-events-none absolute left-3 top-2 text-sm leading-[1.3] text-[#45d58d]">
                            {">"}
                          </span>
                        <textarea
                          autoFocus
                          value={agentChatDraft}
                          onChange={(e) => setAgentChatDraft(e.target.value)}
                          onKeyDown={handleAgentChatKeyDown}
                          placeholder="Ask Agent..."
                          className="terminal-block-caret min-h-[88px] w-full resize-none border-0 border-t border-[#167516] bg-transparent pl-[calc(0.75rem+2ch)] pr-20 py-2 text-sm leading-[1.3] text-[#3bb266] placeholder:text-[#3bb266]/80 focus:outline-none"
                        />
                          {(optimizeInProgress || learnInProgress) ? (
                            <button
                              type="button"
                              aria-label="Stop"
                              title="Stop"
                              onClick={handleAgentStop}
                              className="absolute bottom-4 right-3 rounded-full bg-[#66ff99] w-8 h-8 text-black hover:opacity-80 flex items-center justify-center"
                            >
                              <Square className="h-3.5 w-3.5 fill-current" strokeWidth={0} />
                            </button>
                          ) : (
                            <button
                              type="submit"
                              aria-label="Submit"
                              title="Submit"
                              disabled={(!agentChatDraft.trim() && !pendingCreateWorkflow && !pendingWorkflowAction && !pendingEditWorkflow) || agentChatLoading}
                              className="absolute bottom-4 right-3 rounded-full bg-[#66ff99] w-8 h-8 text-black hover:opacity-80 disabled:opacity-30 flex items-center justify-center"
                            >
                              <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
                            </button>
                          )}
                        </form>
                      </div>
                    </div>
                  </div>
                </aside>

                <div
                  onMouseDown={startSplitResize}
                  className="group/divider absolute top-0 bottom-0 z-30 hidden w-8 -translate-x-1/2 cursor-col-resize items-center justify-center md:flex"
                  style={{ left: `${splitRatio}%` }}
                  role="separator"
                  aria-label="Resize panes"
                  aria-orientation="vertical"
                  title="Drag to resize panes"
                >
                  <div className={cn(
                    "pointer-events-none absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-[#66ff99] transition-opacity duration-150",
                    isResizingSplit ? "opacity-100" : "opacity-0 group-hover/divider:opacity-100",
                  )} />
                </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ========================================================
// Profile Generator View
// ========================================================
function ProfileGeneratorView({
  genLoading, genError, learnStatus, learnInProgress, generatorTab, setGeneratorTab,
  learnSource, setLearnSource, learnUploadName, setLearnUploadName, learnUploadFile, setLearnUploadFile, learnUploadSubmitted, setLearnUploadSubmitted, pendingUploadedPortfolioName, setPendingUploadedPortfolioName, uploadedDatasets, deleteSelectedPortfolio, learnK, setLearnK, learnProfiles, stopLearnProcess,
  catalog, catalogList, selectedCatalogVersion, setSelectedCatalogVersion, loadCatalog,
  startOptimization, stopOptimization, deleteOptimization, deleteCatalog,
  optimizationState, optimizationStarting, optimizeInProgress, optimizationStopPhase, showOptimizationProgress,
  savedOptimizations, selectedSavedOptimizationId, loadSavedOptimization, fetchSavedOptimizations,
  incentiveSets, selectedIncentiveSetVersion, setSelectedIncentiveSetVersion, selectedIncentiveSetDetail, incentiveSetDetailLoading,
  gridCustomColumns, formatCustomColValue,
}: any) {
  const [showIncentiveSetIncentives, setShowIncentiveSetIncentives] = useState(false);
  const [showDecisionSteps, setShowDecisionSteps] = useState(false);
  const [optimizeInitElapsedSec, setOptimizeInitElapsedSec] = useState(0);
  const isLearnActive = Boolean(learnInProgress);
  const isOptimizeActive = Boolean(optimizeInProgress);
  const showOptimizeStatusMessage = showOptimizationProgress && (isOptimizeActive || optimizationState || optimizationStopPhase !== "idle");
  const isGeneratorLocked = isLearnActive || isOptimizeActive;
  const selectedSetMeta = incentiveSets.find((s: any) => s.version === selectedIncentiveSetVersion);
  const detailMatchesSelection = selectedIncentiveSetDetail
    && (!selectedIncentiveSetVersion || selectedIncentiveSetDetail.version === selectedIncentiveSetVersion);
  const incentiveSetTitle = selectedIncentiveSetDetail?.name
    || selectedSetMeta?.name
    || selectedIncentiveSetVersion
    || "Incentive Set";
  const incentivesForDisplay = detailMatchesSelection
    ? (selectedIncentiveSetDetail?.incentives || [])
    : [];
  useEffect(() => {
    if (!isOptimizeActive || optimizationState) {
      setOptimizeInitElapsedSec(0);
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setOptimizeInitElapsedSec(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, [isOptimizeActive, optimizationState]);
  const onTrainFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    const selected = e.target.files[0];
    setLearnUploadFile(selected);
    if (!learnUploadName.trim()) {
      const stripped = selected.name.replace(/\.[^/.]+$/, "");
      setLearnUploadName(stripped);
    }
  };
  const tabs: { key: string; label: string }[] = [
    { key: "learn", label: "Learn" },
    { key: "optimize", label: "Optimize" },
  ];
  const renderLearnStatus = (status: string) => {
    const compact = status.replace(/\s+elapsed$/, "").trim();
    const match = compact.match(/^(.*\s)(\d+%|\d+m \d{2}s|\d+s)$/);
    if (!match) return <span>{compact}</span>;
    return (
      <>
        <span>{match[1]}</span>
        <span className="text-[#7a8680]">{match[2]}</span>
      </>
    );
  };
  const renderOptimizationStatus = (state: any) => {
    if (!state || state.status !== "running") {
      return (
        <>
          <span>{state?.current_step || state?.status || "Working"} </span>
          <span className="text-[#7a8680]">{state?.progress ?? 0}%</span>
        </>
      );
    }

    const profileId = String(state.active_profile_id || "").trim();
    const iter = Number(state.active_profile_iteration || 0);
    const iterMax = Number(state.max_iterations || 50);
    const windowSize = Number(state.convergence_window || 6);
    const patience = Number(state.patience || 3);
    const stable = Math.max(0, Math.min(Number(state.active_profile_no_improve || 0), patience));
    const minIterations = Math.min(Math.max(windowSize, patience + 3), iterMax);
    const match = String(state.current_step || "").match(/\((\d+)\/(\d+)\)/);
    const profilePos = match ? ` (${match[1]}/${match[2]})` : "";

    const phaseText = iter >= minIterations
      ? `Convergence check · Window ${windowSize} · Stable ${stable}/${patience}`
      : `Warm-up for convergence · ${iter}/${minIterations}`;

    return (
      <>
        <span>
          {`Optimizing ${profileId || "profile"}${profilePos} · Iteration ${iter}/${iterMax} · ${phaseText} `}
        </span>
        <span className="text-[#7a8680]">{state.progress}%</span>
      </>
    );
  };
  const formatProgramName = (program: any) => {
    const stamp = program?.completed_at || program?.started_at;
    if (!stamp) return "";
    const when = new Date(stamp).toLocaleString();
    const status = String(program?.status || "").trim();
    const count = Number(program?.result_count ?? 0);
    const countText = Number.isFinite(count) ? `${count} profiles` : "0 profiles";
    if (!status) return when;
    return `${when} — ${status} (${countText})`;
  };
  const programOptions = useMemo(() => {
    const base = (savedOptimizations || []).map((exp: any) => ({
      optimization_id: String(exp.optimization_id || ""),
      label: formatProgramName(exp),
    })).filter((exp: any) => Boolean(exp.optimization_id));

    const selectedId = String(selectedSavedOptimizationId || "");
    if (!selectedId || base.some((exp: any) => exp.optimization_id === selectedId)) {
      return base;
    }

    const stateId = String(optimizationState?.optimization_id || "");
    const hasStateForSelected = stateId && stateId === selectedId;
    const placeholderLabel = hasStateForSelected
      ? formatProgramName({
        started_at: optimizationState?.started_at,
        completed_at: optimizationState?.completed_at,
        status: optimizationState?.status,
        result_count: Array.isArray(optimizationState?.results) ? optimizationState.results.length : 0,
      })
      : "";

    return [{ optimization_id: selectedId, label: placeholderLabel }, ...base];
  }, [savedOptimizations, selectedSavedOptimizationId, optimizationState]);
  const getStepBadgeClass = (status: "pending" | "running" | "done" | "skipped" | "blocked") => {
    if (status === "running") return "bg-[#5b9bff]/10 text-[#5b9bff] border-[#5b9bff]/30";
    if (status === "done") return "bg-[#66ff99]/10 text-[#66ff99] border-[#66ff99]/30";
    if (status === "skipped") return "bg-[#141a18] text-[#7a8680] border-[#2e3432]";
    if (status === "blocked") return "bg-[#ffb347]/10 text-[#ffb347] border-[#ffb347]/30";
    return "bg-[#141a18] text-[#7a8680] border-[#2e3432]";
  };
  const renderOptimizationDecisionSteps = (state: any) => {
    const status = String(state?.status || "");
    const isRunning = status === "running";
    const isFinished = status === "completed" || status === "cancelled";
    const isFailed = status === "failed";
    const hasAnyData = Boolean(state);
    const hasPilotData = Array.isArray(state?.available_incentives)
      && state.available_incentives.some((inc: any) => Number(inc?.uptake_observed_trials || 0) > 0);
    const steps: { name: string; detail: string; status: "pending" | "running" | "done" | "skipped" | "blocked" }[] = [
      {
        name: "1. Start Optimization",
        detail: hasAnyData ? "Optimization run has started and context is loaded" : "Waiting for you to start optimization",
        status: hasAnyData ? "done" : "pending",
      },
      {
        name: "2. Evaluate Current Profile",
        detail: isRunning
          ? (state?.current_step || "Evaluating profile behavior and baseline value")
          : (isFinished ? "Per-profile optimization rounds finished" : isFailed ? "Optimization stopped due to an error" : "Waiting to start"),
        status: isRunning ? "running" : (isFinished ? "done" : isFailed ? "blocked" : "pending"),
      },
      {
        name: "3. Apply Uptake Assumptions",
        detail: isRunning
          ? "Queued after profile evaluation in each iteration"
          : (hasPilotData ? "Using pilot-updated priors" : "Using default priors from redemption rates"),
        status: isRunning ? "pending" : (hasAnyData ? "done" : "pending"),
      },
      {
        name: "4. Update Confidence (Bayesian)",
        detail: isRunning
          ? "Queued after uptake assumptions are applied"
          : (hasPilotData ? "Posterior updated with observed trials/successes" : "No pilot observations yet; posterior equals prior"),
        status: isRunning ? "pending" : (hasAnyData ? "done" : "pending"),
      },
      {
        name: "5. Apply Conservative Screening",
        detail: isRunning
          ? "Queued after confidence update"
          : "Lower-confidence uptake bound applied before incentive acceptance",
        status: isRunning ? "pending" : (hasAnyData ? "done" : "pending"),
      },
      {
        name: "6. Guardrails",
        detail: "Budget caps / exposure caps / kill-switch not configured",
        status: "skipped",
      },
      {
        name: "7. Finalize Selection",
        detail: isFinished ? "Final incentives selected and results persisted" : "Awaiting optimization completion",
        status: isFinished ? "done" : "pending",
      },
    ];
    if (!showDecisionSteps) return null;
    return (
      <div className="rounded-lg border border-[#2e3432] bg-[#0c0f0f] p-4 space-y-2">
        {steps.map((step) => (
          <div key={step.name} className="rounded-md border border-[#2e3432] bg-[#0c0f0f] px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-[#edf3ef]">{step.name}</span>
              <span className={cn("text-[11px] font-semibold tracking-wider rounded border px-2 py-0.5", getStepBadgeClass(step.status))}>
                {step.status}
              </span>
            </div>
            <p className="mt-1 text-xs text-[#7a8680]">{step.detail}</p>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {genError && (
        <div className="rounded-md bg-[#ff5d73]/10 p-4 text-[#ff5d73] border border-[#ff5d73]/30 text-sm">
          {genError}
        </div>
      )}

      <div className="rounded-lg border border-[#2e3432] bg-[#0c0f0f]">
        {/* Tab Bar */}
        <div className="flex border-b border-[#2e3432] px-2 pt-2 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setGeneratorTab(t.key)}
              disabled={isGeneratorLocked}
              className={cn(
                "px-5 py-3 text-sm border-b-2 -mb-px transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed",
                generatorTab === t.key
                  ? "border-[#66ff99] text-[#66ff99] font-bold"
                  : "font-medium border-transparent text-[#7a8680] hover:text-[#b4c0b8]"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {/* Learn Panel */}
          {generatorTab === "learn" && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-[#00aaff] mb-1">Learn Profiles</h3>
                <p className="text-sm text-[#7a8680]">Learn behavioral profiles from transaction data using K-Means clustering.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-[#b4c0b8] mb-2">Portfolio</label>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={learnSource}
                      disabled={isGeneratorLocked}
                      onChange={(e) => {
                        const next = e.target.value;
                        setLearnSource(next);
                        if (next !== "uploaded-pending") {
                          setPendingUploadedPortfolioName("");
                        }
                        if (next === "uploaded") {
                          setLearnUploadSubmitted(false);
                          setLearnUploadName("");
                        }
                      }}
                      className="rounded-md border border-[#2e3432] px-3 py-2 text-sm bg-[#141a18] text-[#edf3ef] w-full"
                    >
                      {uploadedDatasets.map((d: any) => (
                        <option key={d.dataset_id} value={`uploaded-dataset:${d.dataset_id}`}>
                          {d.upload_name || d.dataset_id} ({d.row_count || 0} rows)
                        </option>
                      ))}
                      {pendingUploadedPortfolioName && (
                        <option value="uploaded-pending">
                          {pendingUploadedPortfolioName}
                        </option>
                      )}
                      <option value="uploaded">Upload new portfolio</option>
                    </select>
                    {learnSource.startsWith("uploaded-dataset:") && (
                      <button
                        onClick={deleteSelectedPortfolio}
                        disabled={isGeneratorLocked}
                        className="rounded-md border border-[#ff5d73]/30 p-2 text-[#ff5d73] hover:bg-[#ff5d73]/10 hover:text-[#ff5d73] transition-colors"
                        title="Delete selected portfolio and associated data"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  <div className="mt-4">
                    <label className="block text-sm font-medium text-[#b4c0b8] mb-2">
                      Number of Profiles (K): <span className="font-bold text-[#66ff99]">{learnK}</span>
                    </label>
                    <input
                      type="range"
                      min={3}
                      max={15}
                      list="learn-k-ticks"
                      value={learnK}
                      disabled={isGeneratorLocked}
                      onChange={(e) => setLearnK(parseInt(e.target.value))}
                      className="w-full accent-[#66ff99]"
                    />
                    <datalist id="learn-k-ticks">
                      {Array.from({ length: 13 }, (_, i) => i + 3).map((k) => (
                        <option key={k} value={k} />
                      ))}
                    </datalist>
                    <div className="flex justify-between text-xs text-[#7a8680] mt-1">
                      <span>3</span>
                      <span>15</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  {learnSource === "uploaded" && !learnUploadSubmitted && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-[#b4c0b8] mb-2">Portfolio Name</label>
                        <input
                          type="text"
                          value={learnUploadName}
                          disabled={isGeneratorLocked}
                          onChange={(e) => setLearnUploadName(e.target.value)}
                          className="rounded-md border border-[#2e3432] px-3 py-2 text-sm bg-[#141a18] text-[#edf3ef] w-full"
                          placeholder="e.g., Q1 2026 Retail Transactions"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-[#b4c0b8] mb-2">Transaction File</label>
                        <label className="flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-[#3d4542] py-4 hover:border-[#66ff99] hover:bg-[#141a18] transition-colors">
                          <div className="text-center px-3">
                            <Upload className="mx-auto h-5 w-5 text-[#7a8680] mb-1" />
                            <span className="text-sm text-[#b4c0b8]">Click or drag CSV here</span>
                          </div>
                          <input
                            type="file"
                            accept=".csv,text/csv"
                            className="hidden"
                            disabled={isGeneratorLocked}
                            onChange={onTrainFileChange}
                          />
                        </label>
                        {learnUploadFile && (
                          <p className="mt-2 text-xs text-[#7a8680] truncate">{learnUploadFile.name}</p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-4">
                <button
                  onClick={isLearnActive ? stopLearnProcess : learnProfiles}
                  disabled={!isLearnActive && isOptimizeActive}
                  aria-label="Submit"
                  title={isLearnActive ? "Stop" : "Submit"}
                  className="rounded-full bg-[#66ff99] w-8 h-8 text-black hover:opacity-80 disabled:opacity-50 flex items-center justify-center"
                >
                  {isLearnActive
                    ? <Square className="h-3.5 w-3.5" />
                    : <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
                  }
                </button>
                {isLearnActive && (
                  <span className="text-sm text-[#b4c0b8] flex items-center gap-2">
                    <img src="/linex-animated.svg" alt="Linex" className="h-5 w-5 shrink-0" />
                    <span>{renderLearnStatus(learnStatus || "Working...")}</span>
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Optimize Panel */}
          {generatorTab === "optimize" && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-[#00aaff]">Portfolio Optimization</h3>
              {catalogList.length > 0 && (
                <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                  <label className="text-sm text-slate-500 shrink-0 sm:w-20 text-left">Profile ID</label>
                  <select
                    value={selectedCatalogVersion}
                    disabled={isGeneratorLocked}
                    onChange={(e) => { setSelectedCatalogVersion(e.target.value); fetchSavedOptimizations(e.target.value); }}
                    className="rounded-md border px-3 py-2 text-sm bg-white w-full sm:max-w-[640px]"
                  >
                    {catalogList.map((c: any) => (
                      <option key={c.version} value={c.version}>
                        {c.version} ({c.profile_count} profiles)
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => selectedCatalogVersion && deleteCatalog(selectedCatalogVersion)}
                    disabled={isGeneratorLocked}
                    className="rounded-md border border-red-200 p-2 text-red-500 hover:bg-red-50 hover:text-red-600 transition-colors"
                    title="Delete this catalog"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}

              {incentiveSets.length > 0 && (
                <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                  <label className="text-sm text-slate-500 shrink-0 sm:w-20 text-left">Incentile</label>
                  <select
                    value={selectedIncentiveSetVersion}
                    disabled={isGeneratorLocked}
                    onChange={(e) => setSelectedIncentiveSetVersion(e.target.value)}
                    className="rounded-md border px-3 py-2 text-sm bg-white w-full sm:max-w-[640px]"
                  >
                    {incentiveSets.map((s: any) => (
                      <option key={s.version} value={s.version}>
                        {s.name || s.version} ({s.incentive_count} incentives){s.is_default ? " *" : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowIncentiveSetIncentives(!showIncentiveSetIncentives)}
                    className="px-1 text-xs text-slate-500 hover:text-slate-700 hover:underline underline-offset-2"
                  >
                    {showIncentiveSetIncentives ? "Hide" : "Show"}
                  </button>
                </div>
              )}

              {showIncentiveSetIncentives && (
                <div className="rounded-lg border border-slate-200 bg-white">
                  <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                    <span className="text-xs font-semibold text-slate-500 tracking-wider">
                      {incentiveSetTitle} ({incentivesForDisplay.length})
                    </span>
                    {incentiveSetDetailLoading && (
                      <span className="text-xs text-slate-400">Loading...</span>
                    )}
                  </div>
                  <div className="px-4 py-3">
                    {incentivesForDisplay.length === 0 ? (
                      <p className="text-xs text-slate-500">No incentives loaded for this set.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {incentivesForDisplay.map((inc: any, idx: number) => (
                          <span key={idx} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-slate-200 text-[11px] text-black font-medium">
                            {inc.name}
                            <span className="text-slate-300">
                              ${Math.round((inc.estimated_annual_cost_per_user || 0) * (inc.redemption_rate || 1))}
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {(programOptions.length > 0 || selectedSavedOptimizationId) && (
                <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-3">
                  <label className="text-sm text-slate-500 shrink-0 sm:w-20 text-left">Program</label>
                  <select
                    value={selectedSavedOptimizationId || ""}
                    disabled={isGeneratorLocked}
                    onChange={(e) => {
                      if (e.target.value) loadSavedOptimization(e.target.value);
                    }}
                    className="rounded-md border px-3 py-2 text-sm bg-white w-full sm:max-w-[640px]"
                  >
                    {programOptions.map((program: any) => (
                      <option key={program.optimization_id} value={program.optimization_id}>
                        {program.label}
                      </option>
                    ))}
                  </select>
                  {(optimizationState?.status === "completed" || optimizationState?.status === "cancelled") && (
                    <button
                      onClick={deleteOptimization}
                      disabled={isGeneratorLocked}
                      className="rounded-md border border-red-200 bg-white p-2 text-red-600 hover:bg-red-50"
                      title="Delete program"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}

              <div className="space-y-6 border-t border-slate-200 pt-6">

                  {!selectedCatalogVersion && (
                    <div className="text-sm text-slate-500">
                      No profile selected yet.
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-3">
                    {isOptimizeActive ? (
                      <button
                        onClick={stopOptimization}
                        aria-label="Stop"
                        title="Stop"
                        className="rounded-full bg-black w-8 h-8 text-white hover:opacity-80 flex items-center justify-center"
                      >
                        <Square className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <button
                        onClick={startOptimization}
                        disabled={genLoading || isLearnActive || !selectedCatalogVersion}
                        aria-label="Submit"
                        title="Submit"
                        className="rounded-full bg-black w-8 h-8 text-white hover:opacity-80 disabled:opacity-50 flex items-center justify-center"
                      >
                        {genLoading
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
                        }
                      </button>
                    )}
                    {showOptimizeStatusMessage && (
                      <button
                        type="button"
                        onClick={() => setShowDecisionSteps(!showDecisionSteps)}
                        className="px-1 text-xs text-slate-500 hover:text-slate-700 hover:underline underline-offset-2 shrink-0"
                      >
                        {showDecisionSteps ? "Hide" : "Detail"}
                      </button>
                    )}
                    {showOptimizeStatusMessage && (
                      <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto max-w-full sm:max-w-[520px] flex items-center gap-2">
                        <img src="/linex-animated.svg" alt="Linex" className="h-5 w-5 shrink-0" />
                        <div className="min-w-0 text-sm text-slate-700 truncate">
                          {optimizationStopPhase === "cancelling" ? (
                            <span>Cancelling optimization...</span>
                          ) : optimizationStopPhase === "cleaning" ? (
                            <span>Cleaning up optimization...</span>
                          ) : optimizationState ? (
                            renderOptimizationStatus(optimizationState)
                          ) : (
                            <>
                              <span>Initializing optimization... </span>
                              <span className="text-slate-400">
                                {optimizeInitElapsedSec < 60
                                  ? `${optimizeInitElapsedSec}s`
                                  : `${Math.floor(optimizeInitElapsedSec / 60)}m ${String(optimizeInitElapsedSec % 60).padStart(2, "0")}s`}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {(optimizationState || showOptimizationProgress || isOptimizeActive) && (
                    <div>
                      {renderOptimizationDecisionSteps(optimizationState)}
                    </div>
                  )}

                  {optimizationState?.status === "failed" && (
                    <div className="rounded-md bg-red-50 p-4 text-red-700 text-sm">
                      Error: {optimizationState.error}
                    </div>
                  )}

                  {optimizationState?.results && optimizationState.results.length > 0 && (
                    <div className="rounded-xl border border-slate-200 bg-white px-6 pb-6 pt-3 shadow-sm space-y-6">
                      <div className="space-y-6">
                          {/* Results table — most important, shown first */}
                          <div>
                            <div className="flex items-center justify-between mb-4 sticky top-0 z-10 bg-white pb-2">
                              <h4 className="mt-0 font-semibold text-[#00aaff]">Optimal Incentive Program</h4>
                            </div>
                            <div className="overflow-x-clip">
                              <table className="w-full text-sm">
                                <thead className="sticky top-8 z-10 bg-white">
                                  <tr className="border-b border-slate-200 text-left text-slate-500">
                                    <th className="py-2 pr-4 font-medium">Profile ID</th>
                                    <th className="py-2 pr-4 font-medium">Assigned Incentive(s)</th>
                                    <th className="py-2 pr-4 font-medium text-right">Orig LTV</th>
                                    <th className="py-2 pr-4 font-medium text-right">Gross LTV</th>
                                    <th className="py-2 pr-4 font-medium text-right">Cost</th>
                                    <th className="py-2 pr-4 font-medium text-right">Lift</th>
                                    <th className="py-2 pr-4 font-bold text-right">Final LTV</th>
                                    {(gridCustomColumns || []).map((col: any) => (
                                      <th key={col.id} className="py-2 pr-4 font-medium text-right text-[#00aaff]">{col.label}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {optimizationState.results.map((r: any) => (
                                    <tr key={r.profile_id} className="border-b border-slate-100">
                                      <td className="py-3 pr-4 font-semibold text-slate-900">{r.profile_id}</td>
                                      <td className="py-3 pr-4 text-slate-700">
                                        <div className="flex flex-wrap gap-1">
                                          {(r.selected_incentives || []).map((inc: string, idx: number) => (
                                            <span key={idx} className="inline-flex bg-white text-black px-2 py-0.5 rounded text-xs font-semibold">
                                              {inc}
                                            </span>
                                          ))}
                                        </div>
                                      </td>
                                      <td className="py-3 pr-4 text-right font-mono text-slate-500">
                                        {`$${Math.round(r.original_portfolio_ltv).toLocaleString('en-US')}`}
                                      </td>
                                      <td className="py-3 pr-4 text-right font-mono text-slate-700">
                                        {`$${Math.round(r.new_gross_portfolio_ltv).toLocaleString('en-US')}`}
                                      </td>
                                      <td className="py-3 pr-4 text-right font-mono text-slate-700">
                                        {`-$${Math.round(r.portfolio_cost).toLocaleString('en-US')}`}
                                      </td>
                                      <td className="py-3 pr-4 text-right font-mono text-slate-700">
                                        {`+$${Math.round(r.lift).toLocaleString('en-US')}`}
                                      </td>
                                      <td className="py-3 pr-4 text-right font-mono text-slate-900 font-bold">
                                        {`$${Math.round(r.new_net_portfolio_ltv).toLocaleString('en-US')}`}
                                      </td>
                                      {(gridCustomColumns || []).map((col: any) => (
                                        <td key={col.id} className="py-3 pr-4 text-right font-mono text-[#00aaff]">
                                          {formatCustomColValue(col.expr(r), col.format)}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                  <tr className="bg-slate-50/50">
                                    <td className="py-4 pr-4" colSpan={2}>
                                      <span className="text-[10px] tracking-wider text-slate-400 font-bold">Maximized Total Portfolio</span>
                                    </td>
                                    <td className="py-4 pr-4 text-right font-mono text-slate-900 font-bold border-t border-slate-200">
                                      {(() => {
                                        const totalOrig = optimizationState.results.reduce((sum: number, r: any) => sum + (r.original_portfolio_ltv || 0), 0);
                                        return `$${Math.round(totalOrig).toLocaleString('en-US')}`;
                                      })()}
                                    </td>
                                    <td className="py-4 pr-4 text-right font-mono text-slate-700 border-t border-slate-200">
                                      {(() => {
                                        const totalGross = optimizationState.results.reduce((sum: number, r: any) => sum + (r.new_gross_portfolio_ltv || 0), 0);
                                        return `$${Math.round(totalGross).toLocaleString('en-US')}`;
                                      })()}
                                    </td>
                                    <td className="py-4 pr-4 text-right font-mono text-slate-700 border-t border-slate-200">
                                      {(() => {
                                        const totalCost = optimizationState.results.reduce((sum: number, r: any) => sum + (r.portfolio_cost || 0), 0);
                                        return `-$${Math.round(totalCost).toLocaleString('en-US')}`;
                                      })()}
                                    </td>
                                    <td className="py-4 pr-4 text-right font-mono text-slate-700 font-bold border-t border-slate-200">
                                      {(() => {
                                        const totalLift = optimizationState.results.reduce((sum: number, r: any) => sum + (r.lift || 0), 0);
                                        return `+$${Math.round(totalLift).toLocaleString('en-US')}`;
                                      })()}
                                    </td>
                                    <td className="py-4 pr-4 text-right font-mono text-slate-900 font-bold border-t border-slate-200">
                                      {(() => {
                                        const totalNet = optimizationState.results.reduce((sum: number, r: any) => sum + (r.new_net_portfolio_ltv || 0), 0);
                                        return `$${Math.round(totalNet).toLocaleString('en-US')}`;
                                      })()}
                                    </td>
                                    {(gridCustomColumns || []).map((col: any) => {
                                      const results = optimizationState.results as any[];
                                      const vals = results.map((r: any) => col.expr(r));
                                      const agg = col.totalsExpr === "avg"
                                        ? vals.reduce((s: number, v: number) => s + v, 0) / (vals.length || 1)
                                        : vals.reduce((s: number, v: number) => s + v, 0);
                                      return (
                                        <td key={col.id} className="py-4 pr-4 text-right font-mono font-bold text-[#00aaff] border-t border-slate-200">
                                          {formatCustomColValue(agg, col.format)}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          </div>

                          {/* Methodology note — compact */}
                          <div className="text-xs text-slate-400 px-1">
                            Convergence-based optimization: each profile iterates until rolling outcomes statistically stabilize (low variance + near-zero trend), with max-iteration and patience guards. Only net-positive incentives retained (marginal LTV &gt; effective cost).
                          </div>
                      </div>
                    </div>
                  )}
                </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
// ========================================================
// Helpers
// ========================================================
const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884d8", "#82ca9d"];
const PROFILE_COLORS = [
  "#1e293b", "#334155", "#475569", "#64748b", "#94a3b8",
  "#0ea5e9", "#14b8a6", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#22c55e", "#a855f7", "#f97316", "#06b6d4",
];

function MetricCard({ title, value }: { title: string; value: string | number }) {
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-slate-500 mb-1 leading-none">{title}</p>
      <p className="text-2xl font-bold tracking-tight text-slate-900">{value}</p>
    </div>
  );
}

function formatToon(profile: any, rec: any) {
  let profileToon = "linex_profile:\n profile:\n";
  if (profile.raw_toon) {
    profileToon = profile.raw_toon;
  } else if (profile.attributes) {
    for (const [key, attr] of Object.entries(profile.attributes)) {
      const a = attr as any;
      profileToon += `  ${key}: ${a.value} [${a.confidence}]\n`;
    }
  }

  let recToon = " card_recommendation:\n";
  if (rec.raw_toon) {
    recToon = rec.raw_toon.replace("linex_profile:\n", "");
  } else if (rec.recommendations) {
    const fields = "card_id,card_name,issuer,fit_score,match,estimated_annual_value,description";
    recToon += `  recommendations[${rec.recommendations.length}]{${fields}}:\n`;
    for (const r of rec.recommendations) {
      recToon += `   ${r.card_id},${r.card_name},${r.issuer},${r.fit_score},${r.why_it_matches},${r.estimated_annual_reward_value},${r.description}\n`;
    }
  }

  if (!profileToon.endsWith('\n')) profileToon += '\n';

  return profileToon + recToon;
}

const ALL_STATEMENTS = [
  "Brewing up something good...",
  "Let me dig into this...",
  "Hmm, let me see...",
  "One moment...",
  "Cooking up an answer...",
  "Poking around...",
  "Down the rabbit hole...",
  "Crunching the numbers...",
  "Dusting off the archives...",
  "Connecting the dots...",
  "Rummaging through my brain...",
  "Give me a sec...",
  "Chewing on this...",
  "Putting on my thinking cap...",
  "Let me work my magic...",
  "Diving in...",
  "Spinning up the gears...",
  "Cracking open the books...",
  "Hold my coffee...",
  "Summoning the answer...",
  "Untangling this...",
  "Sniffing out the details...",
  "Rolling up my sleeves...",
  "Consulting the oracle..."
];

function InlineAnalyzingIndicator() {
  const [stepIndex, setStepIndex] = useState(0);
  const [steps, setSteps] = useState<string[]>([]);

  useEffect(() => {
    // Shuffle and pick 10 random statements for this run
    const shuffled = [...ALL_STATEMENTS].sort(() => 0.5 - Math.random());
    setSteps(shuffled.slice(0, 10));
  }, []);

  useEffect(() => {
    if (steps.length === 0) return;
    const interval = setInterval(() => {
      setStepIndex((current) => (current + 1) % steps.length);
    }, 2200);
    return () => clearInterval(interval);
  }, [steps]);

  return (
    <div className="flex items-center gap-4 flex-1">
      <div className="relative flex items-center justify-center w-8 h-8 shrink-0">
        <div className="relative flex items-center justify-center w-full h-full">
          {/* Animated Linex Logo */}
          <img src="/linex-animated.svg" alt="Loading..." className="w-6 h-6" />
        </div>
      </div>
      <div className="h-5 overflow-hidden flex-1 relative">
        <div
          className="flex flex-col transition-transform duration-500 ease-in-out"
          style={{ transform: `translateY(-${stepIndex * 20}px)` }}
        >
          {steps.map((step, i) => (
            <div key={i} className="h-5 flex items-center text-sm font-medium text-slate-600">
              {step}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ========================================================
// Reusable Assignment View
// ========================================================
export function ProfileAssignmentView({ assignment }: { assignment: any }) {
  return (
    <div className="rounded-lg border border-slate-200 p-5 space-y-4">
      <div className="flex items-center gap-4">
        <span className="inline-flex items-center justify-center rounded-full bg-slate-900 text-white text-sm font-bold w-12 h-12">
          {assignment.profile_id}
        </span>
        <div>
          <div className="text-lg font-semibold text-slate-900">
            {assignment.profile_label || `Profile ${assignment.profile_id}`}
          </div>
          <div className="text-sm text-slate-500">
            Confidence: <span className="font-semibold text-slate-700">{(assignment.confidence * 100).toFixed(1)}%</span>
            {' · '}Customer: {assignment.customer_id}
          </div>
        </div>
      </div>

      {assignment.alternates && assignment.alternates.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-[#00aaff] mb-2 tracking-wide">Alternate Candidates</h4>
          <div className="flex flex-wrap gap-3">
            {assignment.alternates.map((alt: any, i: number) => (
              <div key={i} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
                <span className="font-semibold">{alt.profile_id}</span>
                <span className="text-slate-400 ml-2">d={alt.distance}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {assignment.feature_vector && (
        <div>
          <h4 className="text-xs font-semibold text-[#00aaff] mb-3 tracking-wide">Feature Vector (normalized)</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {BEHAVIORAL_AXES.map((ax) => {
              const primaryFeat = ax.features[0];
              const primaryVal = assignment.feature_vector[primaryFeat] ?? 0;
              const auxFeatures = ax.features.slice(1).filter((f: string) => f in assignment.feature_vector);
              return (
                <div key={ax.axis}>
                  <div className="flex items-center gap-2 text-xs mb-1">
                    <span className="w-40 truncate text-slate-800 font-bold">{ax.label}</span>
                    <div className="flex-1 bg-slate-200 rounded-full h-1.5 overflow-hidden">
                      <div className="bg-blue-600 h-full rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(primaryVal * 10, 100))}%` }} />
                    </div>
                    <span className="font-mono text-slate-700 w-10 text-right font-semibold">{primaryVal.toFixed(2)}</span>
                  </div>
                  {auxFeatures.length > 0 && (
                    <div className="space-y-0.5 pl-3">
                      {auxFeatures.map((feat: string) => {
                        const val = assignment.feature_vector[feat] ?? 0;
                        return (
                          <div key={feat} className="flex items-center gap-2 text-xs">
                            <span className="w-[148px] truncate text-slate-400">{feat}</span>
                            <div className="flex-1 bg-slate-100 rounded-full h-1 overflow-hidden">
                              <div className="bg-blue-300 h-full rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(val * 10, 100))}%` }} />
                            </div>
                            <span className="font-mono text-slate-400 w-10 text-right">{val.toFixed(2)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
