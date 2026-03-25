"use client";

import { useState, useEffect, useCallback, useMemo, Fragment, useRef } from "react";
import Papa from "papaparse";
import { Upload, FileText, Search, Activity, Loader2, Users, Boxes, ChevronDown, ChevronRight, Square, Trash2, ArrowUp, MoveHorizontal } from "lucide-react";
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
  const [expandedProfileId, setExpandedProfile] = useState<string | null>(null);

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
      setGeneratorTab("catalog");
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
    } else if (activeView === "generator") {
      if (generatorTab === "catalog") loadCatalog(selectedCatalogVersion || undefined);
      if (generatorTab === "optimize") fetchSavedOptimizations(selectedCatalogVersion || undefined);
      fetchIncentiveSets();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, generatorTab]);

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

          if (data.status === "completed" || data.status === "failed" || data.status === "cancelled") {
            setOptimizationPolling(false);
            setOptimizeInProgress(false);
            // Auto-save on completion or cancellation (with partial results)
            if (data.status === "completed" || data.status === "cancelled") {
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
    const interval = setInterval(poll, 2000);
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

  const submitAgentChat = async () => {
    const next = agentChatDraft.trim();
    if (!next || agentChatLoading) return;
    const now = new Date();
    const ts = formatChatTimestamp(now);
    const userMsg = { id: `${Date.now()}-u`, role: "user" as const, text: next, submittedAt: ts };
    setAgentChatMessages((prev) => [...prev, userMsg]);
    setAgentChatDraft("");

    // Non-actionable: handle locally
    if (GREETING_RE.test(next) || isGibberish(next)) {
      const kind = GREETING_RE.test(next) ? "greeting" : "gibberish";
      const reply = { id: `${Date.now()}-a`, role: "agent" as const, text: pickCanned(kind), submittedAt: formatChatTimestamp(new Date()) };
      setAgentChatMessages((prev) => [...prev, reply]);
      return;
    }

    // Actionable: route to backend
    setAgentChatLoading(true);
    try {
      const res = await fetch(`${CLOUD_FUNCTION_URL}/agent_chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: next }),
      });
      const data = await res.json();
      const reply = { id: `${Date.now()}-a`, role: "agent" as const, text: data.answer ?? data.error ?? "Something went wrong.", submittedAt: formatChatTimestamp(new Date()) };
      setAgentChatMessages((prev) => [...prev, reply]);
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

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: C.bg, fontFamily: "'IBM Plex Mono', 'SF Mono', Menlo, monospace", color: C.text }}>
      <NavRail
        view={activeView}
        setView={(v) => {
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
                onTemplate={(t) => {
                  if (t.cat === "User Profiler") {
                    setActiveView("profiler");
                    setProfilerTab("test");
                  } else if (t.cat === "Profile Generator") {
                    setActiveView("generator");
                    setGeneratorTab("catalog");
                  }
                }}
              />
            )}

            {activeView === "dataroom" && <DataroomCanvas />}

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
              <div className="p-3 md:p-4">
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
                expandedProfileId={expandedProfileId}
                setExpandedProfile={setExpandedProfile}
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
              />
              }

              {/* Most Recent Optimal Incentive Program */}
              <div className="mt-8 space-y-4">
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
                              <div className="mt-2 rounded-lg border overflow-x-auto" style={{ borderColor: C.border, background: C.surface }}>
                                <div className="px-3 py-2 border-b text-[10px] tracking-wider font-semibold" style={{ borderColor: C.border, color: C.muted }}>
                                  Version: <span className="font-mono">{catalog.version}</span> · Source: {catalog.source} · K={catalog.k}
                                  {catalog.total_learning_population > 0 && ` · ${catalog.total_learning_population.toLocaleString()} users`}
                                </div>
                                <table className="w-full text-xs">
                                  <thead>
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
                                              p.description?.toLowerCase().includes("return-heavy") ? "bg-amber-600" : "bg-[#2f9a67]"
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
                    <h4 className="text-xs font-bold tracking-wider" style={{ color: "#00aaff" }}>Optimal Incentive Program</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr style={{ borderBottom: `1px solid ${C.border}`, color: C.muted }}>
                            <th className="py-2 pr-4 font-medium text-left">Profile ID</th>
                            <th className="py-2 pr-4 font-medium text-left">Assigned Incentive(s)</th>
                            <th className="py-2 pr-4 font-medium text-right">Orig LTV</th>
                            <th className="py-2 pr-4 font-medium text-right">Gross LTV</th>
                            <th className="py-2 pr-4 font-medium text-right">Cost</th>
                            <th className="py-2 pr-4 font-medium text-right">Lift</th>
                            <th className="py-2 pr-4 font-bold text-right">Final LTV</th>
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
                </div>
              </div>
            )}

          </section>

          {isDesktopViewport && (
            <>
              <aside className="min-h-0 flex-1 overflow-hidden bg-[#111820] p-3 md:p-4">
                  <div className="flex h-full min-h-0 flex-col">
                    <div className="flex min-h-0 flex-1 flex-col bg-transparent">
                      <div className="min-h-0 flex-1 overflow-auto px-4 py-1 flex flex-col justify-end">
                        {agentChatMessages.length === 0 ? (
                          <div className="mb-0.5 flex items-center gap-2.5">
                            <img src="/linex-icon.svg" alt="Agent" className="h-[14px] w-[14px] shrink-0" />
                            <h2 className="text-sm leading-tight text-[#2f9a67]">
                              {typedWelcomeLine}
                            </h2>
                          </div>

                        ) : (
                          <div className="space-y-3">
                            {agentChatMessages.map((message) => (
                              <div key={message.id} className={`flex max-w-[85%] flex-col ${message.role === "user" ? "ml-auto items-end" : "mr-auto items-start"}`}>
                                <div className={`w-fit rounded-md border px-3 py-2 ${message.role === "user" ? "border-[#5f6670] bg-[#0d1218] text-right" : "border-[#2f9a67]/30 bg-[#0d1218] text-left"}`}>
                                  <p className={`text-sm break-words ${message.role === "user" ? "text-[#2f9a67]" : "text-[#9ca3af]"}`}>{message.text}</p>
                                </div>
                                <p className="mt-1 whitespace-nowrap text-[10px] text-[#6f7782]">{message.submittedAt}</p>
                              </div>
                            ))}
                            {agentChatLoading && (
                              <div className="mr-auto flex max-w-[85%] flex-col items-start">
                                <div className="w-fit rounded-md border border-[#2f9a67]/30 bg-[#0d1218] px-3 py-2">
                                  <p className="text-sm text-[#9ca3af] animate-pulse">Thinking...</p>
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
                          className="terminal-block-caret min-h-[88px] w-full resize-none border border-[#5f6670] bg-transparent pl-[calc(0.75rem+2ch)] pr-20 py-2 text-sm leading-[1.3] text-[#2f9a67] placeholder:text-[#2f9a67]/80 focus:outline-none"
                        />
                          <button
                            type="submit"
                            aria-label="Submit"
                            title="Submit"
                            disabled={!agentChatDraft.trim() || agentChatLoading}
                            className="absolute bottom-4 right-3 rounded-full bg-[#66ff99] w-8 h-8 text-black hover:opacity-80 disabled:opacity-30 flex items-center justify-center"
                          >
                            <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
                          </button>
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
  expandedProfileId, setExpandedProfile,
  startOptimization, stopOptimization, deleteOptimization, deleteCatalog,
  optimizationState, optimizationStarting, optimizeInProgress, optimizationStopPhase, showOptimizationProgress,
  savedOptimizations, selectedSavedOptimizationId, loadSavedOptimization, fetchSavedOptimizations,
  incentiveSets, selectedIncentiveSetVersion, setSelectedIncentiveSetVersion, selectedIncentiveSetDetail, incentiveSetDetailLoading,
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
    { key: "catalog", label: "Catalog" },
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

          {/* Catalog Panel */}
          {generatorTab === "catalog" && (
            <div className="space-y-6">
              <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-[#00aaff] mb-1">Profile</h3>
                  <p className="text-sm text-[#7a8680]">Behavioral profiles learned from data.</p>
                </div>
                {catalogList.length > 0 && (
                  <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                    <select
                      value={selectedCatalogVersion}
                      disabled={isGeneratorLocked}
                      onChange={(e) => { setSelectedCatalogVersion(e.target.value); loadCatalog(e.target.value); }}
                      className="rounded-md border border-[#2e3432] px-3 py-2 text-sm bg-[#141a18] text-[#edf3ef] w-full sm:w-auto"
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
                      className="rounded-md border border-[#ff5d73]/30 p-2 text-[#ff5d73] hover:bg-[#ff5d73]/10 hover:text-[#ff5d73] transition-colors"
                      title="Delete this catalog"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>

              {catalog ? (
                <div className="space-y-2">
                  <div className="text-xs text-[#7a8680] mb-3">
                    Version: <span className="font-mono">{catalog.version}</span> · Source: {catalog.source} · K={catalog.k}
                    {catalog.total_learning_population > 0 && ` · ${catalog.total_learning_population.toLocaleString()} users`}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[#2e3432] text-left text-[#7a8680]">
                          <th className="py-2 pr-2 w-8"></th>
                          <th className="py-2 pr-4 font-medium">Profile ID</th>
                          <th className="py-2 pr-4 font-medium">Description</th>
                          <th className="py-2 pr-4 font-medium text-right">Portfolio LTV</th>
                          <th className="py-2 pr-4 font-medium text-right">Population</th>
                        </tr>
                      </thead>
                      <tbody>
                        {catalog.profiles.map((p: any) => (
                          <Fragment key={p.profile_id}>
                            <tr
                              className="border-b border-[#2e3432] hover:bg-[#1a211e] cursor-pointer transition-colors"
                              onClick={() => setExpandedProfile(expandedProfileId === p.profile_id ? null : p.profile_id)}
                            >
                              <td className="py-2.5 pr-2 text-[#7a8680]">
                                {expandedProfileId === p.profile_id
                                  ? <ChevronDown className="h-4 w-4" />
                                  : <ChevronRight className="h-4 w-4" />
                                }
                              </td>
                              <td className="py-2.5 pr-4">
                                <div className="flex items-center gap-2.5">
                                  <span className={cn(
                                    "inline-flex items-center justify-center rounded-full text-[#050607] text-xs font-bold w-8 h-8 shrink-0",
                                    p.description?.toLowerCase().includes("return-heavy")
                                      ? "bg-amber-600"
                                      : "bg-[#66ff99]"
                                  )}>
                                    {p.profile_id}
                                  </span>
                                  {p.label && (
                                    <span className="text-xs font-semibold text-[#7a8680]">{p.label}</span>
                                  )}
                                </div>
                              </td>
                              <td className="py-2.5 pr-4 text-[#b4c0b8]">{p.description}</td>
                              <td className="py-2.5 pr-4 text-right font-mono text-[#b4c0b8]">
                                {p.portfolio_ltv != null ? `${p.portfolio_ltv < 0 ? '-' : ''}$${Math.abs(p.portfolio_ltv).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '—'}
                              </td>
                              <td className="py-2.5 pr-4 text-right font-mono text-[#b4c0b8]">
                                {p.population_count > 0 ? p.population_count.toLocaleString() : ''}
                                <span className="text-[#7a8680] ml-1">({(p.population_share * 100).toFixed(1)}%)</span>
                              </td>
                            </tr>
                            {expandedProfileId === p.profile_id && (
                              <tr key={`${p.profile_id}-detail`} className="bg-[#141a18]">
                                <td colSpan={5} className="p-4">
                                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    <div>
                                      <h4 className="text-xs font-semibold text-[#00aaff] mb-3 tracking-wide">Centroid</h4>
                                      <div className="space-y-3">
                                        {BEHAVIORAL_AXES.map((ax) => {
                                          const primaryFeat = ax.features[0];
                                          const primaryVal = p.centroid[primaryFeat] ?? 0;
                                          const auxFeatures = ax.features.slice(1).filter(f => f in p.centroid);
                                          return (
                                            <div key={ax.axis}>
                                              <div className="flex items-center gap-2 text-xs mb-1">
                                                <span className="w-40 truncate text-[#edf3ef] font-bold">{ax.label}</span>
                                                <div className="flex-1 bg-[#2e3432] rounded-full h-2 overflow-hidden">
                                                  <div className="bg-[#66ff99] h-full rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(primaryVal * 10, 100))}%` }} />
                                                </div>
                                                <span className="font-mono text-[#b4c0b8] w-10 text-right font-semibold">{primaryVal.toFixed(2)}</span>
                                              </div>
                                              {auxFeatures.length > 0 && (
                                                <div className="space-y-0.5 pl-3">
                                                  {auxFeatures.map((feat) => {
                                                    const val = p.centroid[feat] ?? 0;
                                                    return (
                                                      <div key={feat} className="flex items-center gap-2 text-xs">
                                                        <span className="w-[148px] truncate text-[#7a8680]">{feat}</span>
                                                        <div className="flex-1 bg-[#1a211e] rounded-full h-1.5 overflow-hidden">
                                                          <div className="bg-[#7a8680] h-full rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(val * 10, 100))}%` }} />
                                                        </div>
                                                        <span className="font-mono text-[#7a8680] w-10 text-right">{val.toFixed(2)}</span>
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
                                    <div>
                                      <h4 className="text-xs font-semibold text-[#00aaff] mb-3 tracking-wide">Dispersion (σ)</h4>
                                      <div className="space-y-3">
                                        {BEHAVIORAL_AXES.map((ax) => {
                                          const primaryFeat = ax.features[0];
                                          const primaryVal = p.dispersion[primaryFeat] ?? 0;
                                          const auxFeatures = ax.features.slice(1).filter(f => f in p.dispersion);
                                          return (
                                            <div key={ax.axis}>
                                              <div className="flex items-center gap-2 text-xs mb-1">
                                                <span className="w-40 truncate text-[#edf3ef] font-bold">{ax.label}</span>
                                                <span className="font-mono text-[#b4c0b8] font-semibold">{primaryVal.toFixed(3)}</span>
                                              </div>
                                              {auxFeatures.length > 0 && (
                                                <div className="space-y-0.5 pl-3">
                                                  {auxFeatures.map((feat) => {
                                                    const val = p.dispersion[feat] ?? 0;
                                                    return (
                                                      <div key={feat} className="flex items-center gap-2 text-xs">
                                                        <span className="w-[148px] truncate text-[#7a8680]">{feat}</span>
                                                        <span className="font-mono text-[#7a8680]">{val.toFixed(3)}</span>
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
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        ))}
                        {/* Total Portfolio LTV Row */}
                        <tr className="bg-[#141a18]">
                          <td className="py-4 pr-2"></td>
                          <td className="py-4 pr-4" colSpan={2}>
                            <span className="text-[10px] tracking-wider text-[#7a8680] font-bold">Total Portfolio LTV</span>
                          </td>
                          <td className="py-4 pr-4 text-right font-mono text-[#edf3ef] font-bold border-t border-[#2e3432]">
                            {(() => {
                              const totalLTV = catalog.profiles.reduce((sum: number, p: any) => sum + (p.portfolio_ltv || 0), 0);
                              return `${totalLTV < 0 ? '-' : ''}$${Math.abs(totalLTV).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
                            })()}
                          </td>
                          <td className="py-4 pr-4"></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-[#7a8680] py-8 text-center">
                  No catalog loaded. Learn profiles first or select a saved catalog.
                </div>
              )}
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
                            <div className="flex items-center justify-between mb-4">
                              <h4 className="mt-0 font-semibold text-[#00aaff]">Optimal Incentive Program</h4>
                            </div>
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b border-slate-200 text-left text-slate-500">
                                    <th className="py-2 pr-4 font-medium">Profile ID</th>
                                    <th className="py-2 pr-4 font-medium">Assigned Incentive(s)</th>
                                    <th className="py-2 pr-4 font-medium text-right">Orig LTV</th>
                                    <th className="py-2 pr-4 font-medium text-right">Gross LTV</th>
                                    <th className="py-2 pr-4 font-medium text-right">Cost</th>
                                    <th className="py-2 pr-4 font-medium text-right">Lift</th>
                                    <th className="py-2 pr-4 font-bold text-right">Final LTV</th>
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
