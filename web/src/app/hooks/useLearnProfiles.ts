import { useState, useRef, useEffect, useCallback } from "react";
import { CLOUD_FUNCTION_URL, DATASETS_URL, isAbortError } from "@/lib/api";
import type { ApiRecord } from "@/lib/types";

export function useLearnProfiles() {
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState("");
  const [learnStatus, setLearnStatus] = useState("");
  const [learnInProgress, setLearnInProgress] = useState(false);
  const [learnSource, setLearnSource] = useState("uploaded");
  const [learnUploadFile, setLearnUploadFile] = useState<File | null>(null);
  const [learnUploadName, setLearnUploadName] = useState("");
  const [learnUploadSubmitted, setLearnUploadSubmitted] = useState(false);
  const [pendingUploadedPortfolioName, setPendingUploadedPortfolioName] = useState("");
  const [uploadedDatasets, setUploadedDatasets] = useState<ApiRecord[]>([]);
  const [learnSourceAutoInitialized, setLearnSourceAutoInitialized] = useState(false);
  const [learnK, setLearnK] = useState(10);
  const [catalog, setCatalog] = useState<ApiRecord | null>(null);
  const [catalogList, setCatalogList] = useState<ApiRecord[]>([]);
  const [selectedCatalogVersion, setSelectedCatalogVersion] = useState("");

  const learnXhrRef = useRef<XMLHttpRequest | null>(null);
  const learnFetchAbortRef = useRef<AbortController | null>(null);
  const activeLearnUploadNameRef = useRef("");
  const activeLearnStartedAtRef = useRef("");
  const learnStopRequestedRef = useRef(false);

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
      xhr.ontimeout = () => { learnXhrRef.current = null; reject(new Error("Upload transfer timed out after 9 minutes.")); };
      xhr.onerror = () => { learnXhrRef.current = null; reject(new Error("Network error during upload transfer")); };
      xhr.onload = () => {
        learnXhrRef.current = null;
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`Upload transfer failed (HTTP ${xhr.status})`));
      };
      xhr.send(file);
    });
  };

  const startBackendElapsedStatus = (label: string, details: string[] = []) => {
    const started = Date.now();
    let tickCount = 0;
    const tick = () => {
      const secs = Math.max(0, Math.floor((Date.now() - started) / 1000));
      const duration = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s`;
      let text = label;
      if (details.length > 0) {
        text = tickCount === 0 ? label : details[(tickCount - 1) % details.length];
      }
      setLearnStatus(`${text} ${duration}`);
    };
    tick();
    const timer = setInterval(() => { tickCount += 1; tick(); }, 2200);
    return () => clearInterval(timer);
  };

  const sleepWithAbort = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
      const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
      const onAbort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
      signal.addEventListener("abort", onAbort, { once: true });
    });

  const postLearnProfilesWithRetry = async (body: ApiRecord, controller: AbortController) => {
    const maxAttempts = 6;
    let res: Response | null = null;
    let lastNetworkError: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        res = await fetch(`${CLOUD_FUNCTION_URL}/learn_profiles`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err: unknown) {
        if (isAbortError(err)) throw err;
        lastNetworkError = err;
        if (attempt === maxAttempts) throw err;
        setLearnStatus(`Learning... temporary network issue, retrying (${attempt}/${maxAttempts - 1})`);
        await sleepWithAbort(2000 * attempt, controller.signal);
        continue;
      }
      if (res.ok) return res;
      if (![502, 503, 504].includes(res.status) || attempt === maxAttempts) return res;
      setLearnStatus(`Connecting to learning service... retry ${attempt}/${maxAttempts - 1}`);
      await sleepWithAbort(2000 * attempt, controller.signal);
    }
    if (lastNetworkError) throw lastNetworkError;
    return res as Response;
  };

  const fetchCatalogList = useCallback(async () => {
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
        // Auto-select first if current selection is missing
        setSelectedCatalogVersion((prev) => {
          const hasSelected = Boolean(prev && catalogs.some((c: ApiRecord) => c.version === prev));
          if (!hasSelected) {
            const nextVersion = catalogs[0].version;
            setCatalog(null);
            loadCatalog(nextVersion);
            return nextVersion;
          }
          return prev;
        });
      }
    } catch { /* silent */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchUploadedDatasets = useCallback(async () => {
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
  }, []);

  const loadCatalog = useCallback(async (version?: string) => {
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
  }, []);

  // Default to Upload source when no uploaded datasets are available
  useEffect(() => {
    if (!learnUploadFile && uploadedDatasets.length === 0 && learnSource !== "uploaded" && learnSource !== "uploaded-pending") {
      setLearnSource("uploaded");
    }
  }, [learnUploadFile, uploadedDatasets, learnSource]);

  // When datasets exist, default to the latest one
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
      const exists = uploadedDatasets.some((d: ApiRecord) => d.dataset_id === selectedId);
      if (!exists) {
        setLearnSource(`uploaded-dataset:${firstDatasetId}`);
      }
    }
  }, [uploadedDatasets, learnSource, learnSourceAutoInitialized, learnUploadFile]);

  const learnProfiles = async () => {
    learnStopRequestedRef.current = false;
    setLearnInProgress(true);
    setGenLoading(true);
    setGenError("");
    setLearnStatus("Starting...");
    let stopElapsedStatus: (() => void) | null = null;
    activeLearnStartedAtRef.current = new Date().toISOString();
    try {
      let body: ApiRecord = { source: learnSource, k: learnK };
      let currentUploadName = "";

      if (learnSource === "uploaded") {
        setLearnStatus("Preparing upload...");
        if (!learnUploadFile) throw new Error("Upload a transaction CSV file to learn profiles");
        currentUploadName = learnUploadName.trim();
        activeLearnUploadNameRef.current = currentUploadName;
        if (!currentUploadName) throw new Error("Enter a name for this upload");

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
          if (!datasetId || !uploadUrl) throw new Error("Upload initialization response missing dataset_id/upload_url");

          setLearnStatus("Uploading... 0%");
          await putFileToSignedUrlWithProgress(uploadUrl, learnUploadFile, requiredHeaders, (pct) => setLearnStatus(`Uploading... ${pct}%`), 540000);
          setLearnUploadSubmitted(true);
          body = { source: "uploaded", k: learnK, upload_dataset_id: datasetId, upload_name: currentUploadName };
        } else {
          const errData = await uploadUrlRes.json().catch(() => ({}));
          const detail = String(errData?.error || "").trim();
          const canFallbackToDirectCsv = /bucket does not exist|billing account.*disabled|storage/i.test(detail);
          if (!canFallbackToDirectCsv) throw new Error(detail || `Failed to prepare upload (${uploadUrlRes.status}) at ${uploadInitUrl}`);
          setLearnStatus("Storage unavailable. Sending CSV directly...");
          const csvText = await learnUploadFile.text();
          body = { source: "uploaded", k: learnK, upload_name: currentUploadName, csv_text: csvText };
        }
      } else {
        setLearnStatus("Learning...");
      }

      if (learnSource === "uploaded") {
        setPendingUploadedPortfolioName(currentUploadName);
        setLearnSource("uploaded-pending");
        setLearnStatus("Upload complete. Connecting to learning service...");
      }
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
        let errData: ApiRecord = {};
        if (!looksLikeHtmlError) { try { errData = raw ? JSON.parse(raw) : {}; } catch { /* ignore */ } }
        const detail = looksLikeHtmlError ? "" : String(errData?.error || raw || "").trim();
        const msg = detail ? `Learning failed (${res.status}): ${detail}` : `Learning failed (${res.status}): Service temporarily unavailable. Please retry.`;
        throw new Error(msg);
      }
      const data: ApiRecord = await res.json();

      setCatalog(data);
      if (data?.upload_dataset_id) {
        setPendingUploadedPortfolioName("");
        setLearnSource(`uploaded-dataset:${data.upload_dataset_id}`);
      }
      if (stopElapsedStatus) { stopElapsedStatus(); stopElapsedStatus = null; }
      setLearnStatus("Learn complete.");
      setSelectedCatalogVersion(data.version);
      fetchCatalogList();
      fetchUploadedDatasets();
    } catch (err: unknown) {
      if (learnStopRequestedRef.current) {
        setGenError("");
      } else if (isAbortError(err)) {
        setGenError("Learning request timed out after 9 minutes. Try a smaller file.");
      } else {
        setGenError(err instanceof Error ? err.message : "Learning failed");
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
      const candidates = datasets.filter((d: ApiRecord) => {
        const sameName = String(d.upload_name || "").trim() === uploadName;
        const createdMs = Date.parse(String(d.created_at || ""));
        return sameName && Number.isFinite(createdMs) && createdMs >= (startedMs - 10000);
      });
      for (const d of candidates) {
        await fetch(`${CLOUD_FUNCTION_URL}/delete_portfolio_dataset/${d.dataset_id}`, { method: "DELETE" });
      }
      await fetchUploadedDatasets();
      await fetchCatalogList();
    } catch { /* best-effort cleanup only */ }
  };

  const stopLearnProcess = async () => {
    learnStopRequestedRef.current = true;
    if (learnXhrRef.current) { learnXhrRef.current.abort(); learnXhrRef.current = null; }
    if (learnFetchAbortRef.current) { learnFetchAbortRef.current.abort(); learnFetchAbortRef.current = null; }
    await cleanupStoppedLearnData();
    setGenLoading(false);
    setLearnStatus("");
    setLearnUploadSubmitted(false);
    setPendingUploadedPortfolioName("");
    setLearnSource("uploaded");
    setLearnInProgress(false);
  };

  const deleteSelectedPortfolio = async (optimizeInProgress: boolean) => {
    if (learnInProgress || optimizeInProgress) return;
    if (!learnSource.startsWith("uploaded-dataset:")) return;
    const datasetId = learnSource.split(":", 2)[1] || "";
    if (!datasetId) return;
    const ok = window.confirm("Delete this portfolio and all associated learned catalogs/optimizations?");
    if (!ok) return;
    setGenLoading(true);
    setGenError("");
    try {
      const res = await fetch(`${CLOUD_FUNCTION_URL}/delete_portfolio_dataset/${datasetId}`, { method: "DELETE" });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to delete portfolio dataset");
      }
      const listRes = await fetch(`${CLOUD_FUNCTION_URL}/list_portfolio_datasets`);
      if (listRes.ok) {
        const data = await listRes.json();
        const datasets = data.datasets || [];
        setUploadedDatasets(datasets);
        if (datasets.length > 0) setLearnSource(`uploaded-dataset:${datasets[0].dataset_id}`);
        else setLearnSource("uploaded");
      } else {
        setLearnSource("uploaded");
      }
      fetchCatalogList();
    } catch (err: unknown) {
      setGenError(err instanceof Error ? err.message : "Failed to delete portfolio dataset");
    } finally {
      setGenLoading(false);
    }
  };

  const deleteCatalog = async (version: string, optimizeInProgress: boolean) => {
    if (learnInProgress || optimizeInProgress) return;
    if (!confirm(`Delete catalog ${version}? This cannot be undone.`)) return;
    try {
      const res = await fetch(`${CLOUD_FUNCTION_URL}/delete_catalog/${version}`, { method: "DELETE" });
      if (res.ok) {
        const newList = catalogList.filter((c: ApiRecord) => c.version !== version);
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

  return {
    genLoading, setGenLoading, genError, setGenError,
    learnStatus, learnInProgress, setLearnInProgress,
    learnSource, setLearnSource,
    learnUploadFile, setLearnUploadFile,
    learnUploadName, setLearnUploadName,
    learnUploadSubmitted, setLearnUploadSubmitted,
    pendingUploadedPortfolioName, setPendingUploadedPortfolioName,
    uploadedDatasets, learnK, setLearnK,
    catalog, setCatalog,
    catalogList, selectedCatalogVersion, setSelectedCatalogVersion,
    fetchCatalogList, fetchUploadedDatasets, loadCatalog,
    learnProfiles, stopLearnProcess,
    deleteSelectedPortfolio, deleteCatalog,
  };
}
