import { useState, useRef, useCallback } from "react";
import { CLOUD_FUNCTION_URL, isAbortError } from "@/lib/api";
import { OPTIMIZATION_CACHE_STORAGE_KEY } from "@/app/components/theme";
import type { ApiRecord } from "@/lib/types";

export function useOptimization() {
  const [optimizationId, setOptimizationId] = useState<string | null>(null);
  const [optimizationState, setOptimizationState] = useState<ApiRecord | null>(null);
  const [optimizationPolling, setOptimizationPolling] = useState(false);
  const [optimizationStarting, setOptimizationStarting] = useState(false);
  const [optimizeInProgress, setOptimizeInProgress] = useState(false);
  const [optimizationStopPhase, setOptimizationStopPhase] = useState<"idle" | "cancelling" | "cleaning">("idle");
  const [savedOptimizations, setSavedOptimizations] = useState<ApiRecord[]>([]);
  const [selectedSavedOptimizationId, setSelectedSavedOptimizationId] = useState<string | null>(null);
  const [showOptimizationProgress, setShowOptimizationProgress] = useState(false);

  const optimizationStartAbortRef = useRef<AbortController | null>(null);
  const optimizationStopRequestedRef = useRef(false);
  const optimizationCacheRef = useRef<ApiRecord>({});
  const optimizationLatestByCatalogRef = useRef<Record<string, string>>({});
  const savedOptimizationsFetchSeqRef = useRef(0);
  const loadOptimizationFetchSeqRef = useRef(0);
  const optimizationCacheBootstrappedRef = useRef(false);

  // Bootstrap cache from localStorage
  if (!optimizationCacheBootstrappedRef.current && typeof window !== "undefined") {
    optimizationCacheBootstrappedRef.current = true;
    try {
      const raw = localStorage.getItem(OPTIMIZATION_CACHE_STORAGE_KEY) || sessionStorage.getItem("linex.optimizationCache.v1");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.cache && typeof parsed.cache === "object") optimizationCacheRef.current = parsed.cache;
        if (parsed?.latestByCatalog && typeof parsed.latestByCatalog === "object") optimizationLatestByCatalogRef.current = parsed.latestByCatalog;
      }
    } catch { /* ignore browser cache read errors */ }
  }

  const updateOptimizationCache = useCallback((optimizationData: ApiRecord, persist = false) => {
    const optimizationKey = String(optimizationData?.optimization_id || "");
    if (!optimizationKey) return;
    optimizationCacheRef.current[optimizationKey] = optimizationData;
    const catalogKey = String(optimizationData?.catalog_version || "");
    if (catalogKey) optimizationLatestByCatalogRef.current[catalogKey] = optimizationKey;
    if (persist) {
      try {
        const payload = JSON.stringify({ cache: optimizationCacheRef.current, latestByCatalog: optimizationLatestByCatalogRef.current });
        localStorage.setItem(OPTIMIZATION_CACHE_STORAGE_KEY, payload);
        sessionStorage.setItem("linex.optimizationCache.v1", payload);
      } catch { /* best-effort browser cache only */ }
    }
  }, []);

  const fetchSavedOptimizations = useCallback(async (catalogVersion?: string) => {
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
        if (exps.length > 0) {
          const preferred = exps.find((exp: ApiRecord) =>
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
            loadSavedOptimization(preferredId, { refresh: !cached });
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSavedOptimization = useCallback(async (expId: string, options?: { refresh?: boolean }) => {
    const shouldRefresh = options?.refresh !== false;
    optimizationStopRequestedRef.current = false;
    setSelectedSavedOptimizationId(expId);
    if (expId !== optimizationId) setShowOptimizationProgress(false);
    const cached = optimizationCacheRef.current[expId];
    if (cached) {
      setOptimizationState(cached);
      setOptimizationId(expId);
      setOptimizeInProgress(cached?.status === "running");
    }
    if (!shouldRefresh && cached?.status !== "running") return;
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
  }, [optimizationId, updateOptimizationCache]);

  const startOptimization = async (selectedCatalogVersion: string, selectedIncentiveSetVersion: string, setGenLoading: (v: boolean) => void, setGenError: (v: string) => void) => {
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
        body: JSON.stringify({ catalog_version: selectedCatalogVersion, incentive_set_version: selectedIncentiveSetVersion || undefined, engine: "monte_carlo" }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to start optimization");
      }
      const data = await res.json();
      const startedOptimizationId = String(data?.optimization_id || data?.experiment_id || "");
      if (!startedOptimizationId) throw new Error("Failed to start optimization: missing optimization_id");
      if (optimizationStopRequestedRef.current) {
        setOptimizationStopPhase("cancelling");
        await fetch(`${CLOUD_FUNCTION_URL}/cancel_optimize/${startedOptimizationId}`, { method: "POST" }).catch(() => {});
        setOptimizationStopPhase("cleaning");
        await fetch(`${CLOUD_FUNCTION_URL}/delete_optimize/${startedOptimizationId}`, { method: "DELETE" }).catch(() => {});
        setOptimizationPolling(false); setOptimizationState(null); setOptimizationId(null);
        setSelectedSavedOptimizationId(null); setShowOptimizationProgress(false);
        setOptimizationStopPhase("idle"); setOptimizeInProgress(false);
        return;
      }
      setOptimizationId(startedOptimizationId);
      setSelectedSavedOptimizationId(startedOptimizationId);
      // Monte Carlo results arrive synchronously, no polling needed
      if (data?.engine === "monte_carlo") {
        updateOptimizationCache(data, true);
        setOptimizationState(data);
        setOptimizeInProgress(false);
        setShowOptimizationProgress(false);
      } else {
        setOptimizationPolling(true);
      }
    } catch (err: unknown) {
      if (!isAbortError(err)) {
        setGenError(err instanceof Error ? err.message : "Failed to start optimization");
      }
      setOptimizationStopPhase("idle"); setOptimizeInProgress(false);
    } finally {
      optimizationStartAbortRef.current = null;
      setOptimizationStarting(false);
      setGenLoading(false);
    }
  };

  const stopOptimization = async (selectedCatalogVersion: string) => {
    optimizationStopRequestedRef.current = true;
    setOptimizationStopPhase("cancelling");
    setShowOptimizationProgress(true);
    setOptimizeInProgress(true);
    if (optimizationStartAbortRef.current) { optimizationStartAbortRef.current.abort(); optimizationStartAbortRef.current = null; }
    if (!optimizationId) {
      setOptimizationStarting(false); setShowOptimizationProgress(false);
      setOptimizationStopPhase("idle"); setOptimizeInProgress(false);
      return;
    }
    try {
      await fetch(`${CLOUD_FUNCTION_URL}/cancel_optimize/${optimizationId}`, { method: "POST" });
      setOptimizationStopPhase("cleaning");
      await fetch(`${CLOUD_FUNCTION_URL}/delete_optimize/${optimizationId}`, { method: "DELETE" });
    } catch { /* silently fail */ }
    finally {
      setOptimizationPolling(false); setOptimizationState(null); setOptimizationId(null);
      setSelectedSavedOptimizationId(null); fetchSavedOptimizations(selectedCatalogVersion || undefined);
      setOptimizationStarting(false); setOptimizationStopPhase("idle"); setOptimizeInProgress(false);
    }
  };

  const deleteOptimization = async (learnInProgress: boolean, selectedCatalogVersion: string) => {
    if (learnInProgress || optimizeInProgress) return;
    if (!optimizationId) return;
    try {
      await fetch(`${CLOUD_FUNCTION_URL}/delete_optimize/${optimizationId}`, { method: "DELETE" });
      setOptimizationState(null); setOptimizationId(null);
      setSelectedSavedOptimizationId(null);
      fetchSavedOptimizations(selectedCatalogVersion || undefined);
    } catch { setOptimizationState((prev) => { void prev; return prev; }); }
  };

  return {
    optimizationId, setOptimizationId,
    optimizationState, setOptimizationState,
    optimizationPolling, setOptimizationPolling,
    optimizationStarting,
    optimizeInProgress, setOptimizeInProgress,
    optimizationStopPhase, setOptimizationStopPhase,
    savedOptimizations,
    selectedSavedOptimizationId, setSelectedSavedOptimizationId,
    showOptimizationProgress, setShowOptimizationProgress,
    optimizationStopRequestedRef, optimizationCacheRef, optimizationLatestByCatalogRef,
    updateOptimizationCache,
    fetchSavedOptimizations, loadSavedOptimization,
    startOptimization, stopOptimization, deleteOptimization,
  };
}
