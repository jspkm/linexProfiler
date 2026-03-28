"use client";

import { useState, useEffect, useRef } from "react";
import { useRefState } from "@/lib/useRefState";
import { Loader2, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatChatTimestamp, formatCustomColValue } from "@/lib/helpers";
import type { ApiRecord } from "@/lib/types";
import NavRail from "./components/NavRail";
import WorkflowCanvas from "./components/WorkflowCanvas";
import DataroomCanvas from "./components/DataroomCanvas";
import Dropdown from "./components/Dropdown";
import AgentChatPanel from "./components/AgentChatPanel";
import ProfilerView from "./components/ProfilerView";
import SensitivityChart from "./components/SensitivityChart";
import { C, CLOUD_FUNCTION_URL, type View } from "./components/theme";
import { useSplitPane } from "./hooks/useSplitPane";
import { useProfiler } from "./hooks/useProfiler";
import { useLearnProfiles } from "./hooks/useLearnProfiles";
import { useOptimization } from "./hooks/useOptimization";
import { useIncentiveSets } from "./hooks/useIncentiveSets";
import { useWorkflows } from "./hooks/useWorkflows";
import { useAgentChat } from "./hooks/useAgentChat";

export default function Home() {
  const [activeView, setActiveView] = useState<View>("terminal");
  const [typedWelcomeLine, setTypedWelcomeLine] = useState("");
  const [showRecentCatalogDetail, setShowRecentCatalogDetail] = useState(false);
  const [showRecentIncentiveDetail, setShowRecentIncentiveDetail] = useState(false);

  // Pending delete state with refs for synchronous access in async flows
  const [, setPendingDeleteCatalog, pendingDeleteCatalogRef] = useRefState<string | null>(null);
  const [, setPendingDeleteIncentiveSet, pendingDeleteIncentiveSetRef] = useRefState<string | null>(null);

  const splitPane = useSplitPane();
  const profiler = useProfiler();
  const learn = useLearnProfiles();
  const optimization = useOptimization();
  const incentives = useIncentiveSets();
  const wf = useWorkflows();

  const agentChat = useAgentChat({
    learnInProgress: learn.learnInProgress,
    setLearnInProgress: learn.setLearnInProgress,
    learnSource: learn.learnSource,
    setLearnSource: learn.setLearnSource,
    setLearnK: learn.setLearnK,
    uploadedDatasets: learn.uploadedDatasets,
    fetchCatalogList: learn.fetchCatalogList,
    loadCatalog: learn.loadCatalog,
    selectedCatalogVersion: learn.selectedCatalogVersion,
    setSelectedCatalogVersion: learn.setSelectedCatalogVersion,
    catalog: learn.catalog,
    catalogList: learn.catalogList,
    optimizeInProgress: optimization.optimizeInProgress,
    setOptimizeInProgress: optimization.setOptimizeInProgress,
    optimizationId: optimization.optimizationId,
    setOptimizationId: optimization.setOptimizationId,
    optimizationState: optimization.optimizationState,
    setOptimizationState: optimization.setOptimizationState,
    optimizationPolling: optimization.optimizationPolling,
    setOptimizationPolling: optimization.setOptimizationPolling,
    showOptimizationProgress: optimization.showOptimizationProgress,
    setShowOptimizationProgress: optimization.setShowOptimizationProgress,
    setOptimizationStopPhase: optimization.setOptimizationStopPhase,
    setOptimizationStarting: () => {},
    optimizationStopRequestedRef: optimization.optimizationStopRequestedRef,
    optimizationCacheRef: optimization.optimizationCacheRef,
    savedOptimizations: optimization.savedOptimizations,
    selectedSavedOptimizationId: optimization.selectedSavedOptimizationId,
    setSelectedSavedOptimizationId: optimization.setSelectedSavedOptimizationId,
    fetchSavedOptimizations: optimization.fetchSavedOptimizations,
    incentiveSets: incentives.incentiveSets,
    selectedIncentiveSetVersion: incentives.selectedIncentiveSetVersion,
    setSelectedIncentiveSetVersion: incentives.setSelectedIncentiveSetVersion,
    selectedIncentiveSetDetail: incentives.selectedIncentiveSetDetail,
    setSelectedIncentiveSetDetail: incentives.setSelectedIncentiveSetDetail,
    fetchIncentiveSets: incentives.fetchIncentiveSets,
    loadIncentiveSetDetail: incentives.loadIncentiveSetDetail,
    workflows: wf.workflows,
    setWorkflows: wf.setWorkflows as (v: ApiRecord[]) => void,
    fetchWorkflows: wf.fetchWorkflows,
    pendingDeleteCatalogRef,
    setPendingDeleteCatalog,
    pendingDeleteIncentiveSetRef,
    setPendingDeleteIncentiveSet,
    pendingDeleteWorkflowRef: wf.pendingDeleteWorkflowRef,
    setPendingDeleteWorkflow: wf.setPendingDeleteWorkflow,
    pendingCreateWorkflowRef: wf.pendingCreateWorkflowRef,
    setPendingCreateWorkflow: wf.setPendingCreateWorkflow,
    pendingWorkflowActionRef: wf.pendingWorkflowActionRef,
    setPendingWorkflowAction: wf.setPendingWorkflowAction,
    pendingEditWorkflowRef: wf.pendingEditWorkflowRef,
    setPendingEditWorkflow: wf.setPendingEditWorkflow,
    setGenLoading: learn.setGenLoading,
    setGenError: learn.setGenError,
  });

  // ── Welcome typing effect ──
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
      if (index >= welcomePromptLine.length) window.clearInterval(timer);
    }, 35);
    return () => window.clearInterval(timer);
  }, [welcomePromptLine]);

  // ── Data bootstrapping effects ──
  useEffect(() => {
    if (activeView === "terminal") {
      learn.fetchCatalogList();
      learn.fetchUploadedDatasets();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView]);

  useEffect(() => {
    if (activeView === "terminal") {
      learn.loadCatalog(learn.selectedCatalogVersion || undefined);
      optimization.fetchSavedOptimizations(learn.selectedCatalogVersion || undefined);
      incentives.fetchIncentiveSets();
    } else if (activeView === "workflow") {
      wf.fetchWorkflows();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView]);

  // Fetch data when a custom workflow is activated
  const prevActiveWorkflowRef = useRef<string | null>(null);
  useEffect(() => {
    if (wf.activeWorkflow && activeView === "terminal" && wf.activeWorkflow.id !== prevActiveWorkflowRef.current) {
      prevActiveWorkflowRef.current = wf.activeWorkflow.id;
      if (incentives.incentiveSets.length === 0) incentives.fetchIncentiveSets();
      if (!incentives.selectedIncentiveSetDetail) incentives.loadIncentiveSetDetail(incentives.selectedIncentiveSetVersion || undefined);
    } else if (!wf.activeWorkflow) {
      prevActiveWorkflowRef.current = null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wf.activeWorkflow, activeView]);

  const { loadIncentiveSetDetail, selectedIncentiveSetVersion: selectedISV } = incentives;
  useEffect(() => {
    if (activeView === "terminal") {
      loadIncentiveSetDetail(selectedISV || undefined);
    }
  }, [activeView, selectedISV, loadIncentiveSetDetail]);

  // Clear optimization state when incentive set changes and doesn't match loaded optimization
  useEffect(() => {
    if (!selectedISV) return;
    const currentOptISV = optimization.optimizationState?.incentive_set_version;
    if (currentOptISV && currentOptISV !== selectedISV) {
      optimization.setOptimizationState(null);
      optimization.setOptimizationId(null);
      optimization.setSelectedSavedOptimizationId(null);
      optimization.setOptimizeInProgress(false);
    }
  }, [selectedISV, optimization.optimizationState?.incentive_set_version, optimization.setOptimizationState, optimization.setOptimizationId, optimization.setSelectedSavedOptimizationId, optimization.setOptimizeInProgress]);

  // Optimization polling
  useEffect(() => {
    if (!optimization.optimizationId || !optimization.optimizationPolling) return;

    const poll = async () => {
      try {
        const res = await fetch(`${CLOUD_FUNCTION_URL}/optimize_status/${optimization.optimizationId}`);
        if (res.ok) {
          const data = await res.json();
          if (optimization.optimizationStopRequestedRef.current) return;
          optimization.updateOptimizationCache(data, data?.status !== "running");
          optimization.setOptimizationState(data);

          // Update optimization progress in agent chat
          const step = data.current_step || "";
          const pct = data.progress ?? 0;
          if (step && step !== agentChat.agentOptLastStep.current && !agentChat.agentOptDoneRef.current) {
            agentChat.agentOptLastStep.current = step;
            let friendly = step;
            const evalMatch = step.match(/^Evaluating (\S+)\s+\((\d+)(?:\/(\d+))?\)(?:\s*-\s*iter\s+(\d+)\/(\d+))?/);
            const doneMatch = step.match(/^(Converged|No meaningful improvement|Reached max iterations) for (\S+)/);
            if (evalMatch) {
              const [, profId, , total, iter, maxIter] = evalMatch;
              const label = profId + (total ? ` (${total} total)` : "");
              friendly = iter ? `Optimizing ${label} — iteration ${iter}/${maxIter}` : `Optimizing ${label}`;
            } else if (doneMatch) {
              const [, reason] = doneMatch;
              friendly = reason === "Converged" ? "converged, best bundle found" : reason === "No meaningful improvement" ? "best bundle found" : "complete";
            } else if (step === "Initializing...") {
              friendly = "Initializing";
            }
            const dotCount = (pct % 3) + 1;
            const dots = ".".repeat(dotCount);
            agentChat.setAgentChatMessages((msgs) => {
              const idx = msgs.findIndex((m) => m.id === "opt-progress");
              const allLines = idx >= 0 ? msgs[idx].text.split("\n") : [];
              const doneLines = allLines.filter((l: string) => l.startsWith("✓"));
              const isProfileDone = Boolean(doneMatch);
              let stageLines: string[];
              if (isProfileDone) {
                const lastInProgress = allLines.find((l: string) => !l.startsWith("✓") && l.startsWith("Optimizing"));
                const profileLabel = lastInProgress?.match(/^(Optimizing \S+)/)?.[1] || "Profile";
                stageLines = [...doneLines, `✓ ${profileLabel} — ${friendly}`];
              } else {
                stageLines = [...doneLines, `${friendly}${dots}`];
              }
              const progressText = "Starting optimization...\n" + stageLines.join("\n");
              if (idx >= 0) { const copy = [...msgs]; copy[idx] = { ...copy[idx], text: progressText }; return copy; }
              return [...msgs, { id: "opt-progress", role: "agent" as const, text: progressText, submittedAt: formatChatTimestamp(new Date()) }];
            });
          }

          if ((data.status === "completed" || data.status === "failed" || data.status === "cancelled") && !agentChat.agentOptDoneRef.current) {
            agentChat.agentOptDoneRef.current = true;
            optimization.setOptimizationPolling(false);
            optimization.setOptimizeInProgress(false);
            agentChat.agentOptLastStep.current = "";
            if (data.status === "completed") {
              const totalLift = (data.results || []).reduce((s: number, r: ApiRecord) => s + (Number(r.lift) || 0), 0);
              const profileCount = (data.results || []).length;
              agentChat.setAgentChatMessages((prev) => {
                const prog = prev.find((m) => m.id === "opt-progress");
                const stageLines = prog ? prog.text.split("\n").filter((l: string) => l.startsWith("✓")).join("\n") : "";
                const idx = prev.findIndex((m) => m.id === "opt-progress");
                const finalText = "Starting optimization...\n" + (stageLines ? stageLines + "\n" : "") + `✓ Optimal Incentive Program generated (${profileCount} profiles)\nTotal portfolio lift: +$${Math.round(totalLift).toLocaleString("en-US")}`;
                if (idx >= 0) { const copy = [...prev]; copy[idx] = { ...copy[idx], id: `${Date.now()}-opt-done`, text: finalText, submittedAt: formatChatTimestamp(new Date()) }; return copy; }
                return prev;
              });
            } else {
              agentChat.setAgentChatMessages((prev) => {
                const idx = prev.findIndex((m) => m.id === "opt-progress");
                const failText = `Optimization ${data.status}. ${data.error || ""}`.trim();
                if (idx >= 0) { const copy = [...prev]; copy[idx] = { ...copy[idx], id: `${Date.now()}-opt-done`, text: failText, submittedAt: formatChatTimestamp(new Date()) }; return copy; }
                return prev;
              });
            }
            if (data.status === "completed" && !optimization.optimizationStopRequestedRef.current) {
              fetch(`${CLOUD_FUNCTION_URL}/save_optimize/${optimization.optimizationId}`, { method: "POST" })
                .then(() => optimization.fetchSavedOptimizations(learn.selectedCatalogVersion || undefined))
                .catch(() => {});
            }
          } else if (data.status === "running") {
            optimization.setOptimizeInProgress(true);
          }
        }
      } catch { /* silently fail on poll */ }
    };

    poll();
    const interval = setInterval(poll, 800);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optimization.optimizationId, optimization.optimizationPolling, learn.selectedCatalogVersion, optimization.updateOptimizationCache]);

  // Restore optimization cache from localStorage when switching tabs
  const {
    optimizeInProgress, optimizationId, optimizationState,
    optimizationLatestByCatalogRef, optimizationCacheRef,
    setSelectedSavedOptimizationId, setOptimizationState, setOptimizationId, setOptimizeInProgress,
  } = optimization;
  const { selectedCatalogVersion } = learn;
  useEffect(() => {
    if (activeView !== "terminal" || !selectedCatalogVersion) return;
    if (optimizeInProgress && optimizationId) return;
    const cachedOptimizationId = optimizationLatestByCatalogRef.current[selectedCatalogVersion];
    if (!cachedOptimizationId) return;
    const cachedState = optimizationCacheRef.current[cachedOptimizationId];
    if (!cachedState) return;
    if (optimizationState && optimizationState.catalog_version === selectedCatalogVersion) return;
    if (incentives.selectedIncentiveSetVersion && cachedState?.incentive_set_version && cachedState.incentive_set_version !== incentives.selectedIncentiveSetVersion) return;
    setSelectedSavedOptimizationId(cachedOptimizationId);
    setOptimizationState(cachedState);
    setOptimizationId(cachedOptimizationId);
    setOptimizeInProgress(cachedState?.status === "running");
  }, [activeView, optimizeInProgress, optimizationId, optimizationState, selectedCatalogVersion, optimizationLatestByCatalogRef, optimizationCacheRef, setSelectedSavedOptimizationId, setOptimizationState, setOptimizationId, setOptimizeInProgress]);

  useEffect(() => {
    if (activeView === "terminal" && learn.selectedCatalogVersion) {
      optimization.fetchSavedOptimizations(learn.selectedCatalogVersion);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, learn.selectedCatalogVersion]);

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: C.bg, fontFamily: "'IBM Plex Mono', 'SF Mono', Menlo, monospace", color: C.text }}>
      <NavRail
        view={activeView}
        setView={(v) => {
          if (v !== "terminal") wf.setActiveWorkflow(null);
          setActiveView(v);
        }}
      />

      <div className="flex-1 overflow-hidden" style={{ background: "#070a09" }}>
        <div ref={splitPane.splitContainerRef} className="relative flex h-full overflow-hidden bg-[#070a09]">
          <section className="min-h-0 overflow-auto" style={{ width: splitPane.isDesktopViewport ? `${splitPane.splitRatio}%` : "100%" }}>

            {activeView === "workflow" && (
              <WorkflowCanvas
                workflows={wf.workflows}
                onTemplate={(t) => {
                  if (t.cat === "User Profiler") { setActiveView("profiler"); profiler.setProfilerTab("test"); }
                  else if (t.cat === "Profile Generator") { wf.setActiveWorkflow(null); setActiveView("terminal"); }
                  else if (t.cat === "Custom") {
                    const w = wf.workflows.find((w) => w.workflow_id === t.id);
                    wf.setActiveWorkflow({ id: t.id, name: t.text, description: t.desc, detail: w?.detail || t.desc || t.text });
                    setActiveView("terminal");
                  }
                }}
              />
            )}

            {activeView === "dataroom" && <DataroomCanvas datasets={learn.uploadedDatasets as { dataset_id: string; upload_name?: string; row_count?: number; parsed_user_count?: number; created_at?: string }[]} />}

            {activeView === "profiler" && (
              <ProfilerView
                profilerTab={profiler.profilerTab}
                setProfilerTab={profiler.setProfilerTab}
                testUserIds={profiler.testUserIds}
                selectedUserId={profiler.selectedUserId}
                setSelectedUserId={profiler.setSelectedUserId}
                testUsersLoading={profiler.testUsersLoading}
                file={profiler.file}
                handleFileUpload={profiler.handleFileUpload}
                loading={profiler.loading}
                results={profiler.results}
                error={profiler.error}
                analyzeTestUser={profiler.analyzeTestUser}
                processFile={profiler.processFile}
                stopProfilerProcess={profiler.stopProfilerProcess}
              />
            )}

            {activeView === "terminal" && (
              <div style={{ padding: "28px 24px 18px" }}>
                <div className="mx-auto max-w-6xl space-y-6">
                  {/* Custom Workflow Screen */}
                  {activeView === "terminal" && wf.activeWorkflow && (
                    <div className="space-y-4">
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div>
                          <h3 className="text-xs font-bold tracking-wider" style={{ color: "#00aaff" }}>{wf.activeWorkflow.name}</h3>
                          <p className="text-[10px] mt-1" style={{ color: C.muted }}>{wf.activeWorkflow.description}</p>
                        </div>
                        <button type="button" onClick={() => wf.setActiveWorkflow(null)} className="text-[10px] tracking-wider hover:underline underline-offset-2" style={{ color: C.accentDim }}>Back</button>
                      </div>
                      <div className="flex flex-col gap-4 max-w-[66%]">
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] tracking-wider font-semibold" style={{ color: C.muted }}>Incentive Set</label>
                          <Dropdown
                            value={incentives.selectedIncentiveSetVersion || ""}
                            options={incentives.incentiveSets.map((s: ApiRecord) => ({ value: s.version, label: `${s.name || s.version} (${s.incentive_count} incentives)${s.is_default ? " *" : ""}` }))}
                            onChange={(val) => { incentives.setSelectedIncentiveSetVersion(val); incentives.loadIncentiveSetDetail(val); }}
                            className="w-full"
                          />
                        </div>
                      </div>
                      {incentives.incentiveSetDetailLoading && (
                        <div className="flex items-center gap-2 py-4">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: C.muted }} />
                          <span className="text-xs" style={{ color: C.muted }}>Loading incentives…</span>
                        </div>
                      )}
                      {!incentives.incentiveSetDetailLoading && incentives.selectedIncentiveSetDetail && (
                        <div className="rounded-xl border overflow-hidden" style={{ borderColor: C.border, background: C.surface }}>
                          <div className="px-4 py-2.5 border-b text-[10px] tracking-wider font-semibold" style={{ borderColor: C.border, color: C.muted }}>
                            {incentives.selectedIncentiveSetDetail.name || incentives.selectedIncentiveSetDetail.version} — {(incentives.selectedIncentiveSetDetail.incentives || []).length} incentives
                          </div>
                          {(incentives.selectedIncentiveSetDetail.incentives || []).length === 0 ? (
                            <p className="text-xs px-4 py-3" style={{ color: C.muted }}>No incentives in this set.</p>
                          ) : (
                            <div className="px-4 py-3 flex flex-wrap gap-1.5">
                              {(incentives.selectedIncentiveSetDetail.incentives || []).map((inc: ApiRecord, idx: number) => (
                                <span key={idx} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border" style={{ borderColor: C.border, background: "white", color: "black" }}>
                                  {inc.name}
                                  <span style={{ color: C.muted }}>${Math.round((inc.estimated_annual_cost_per_user || 0) * (inc.redemption_rate || 1))}</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Optimize Portfolio — Home or Generator */}
                  {!wf.activeWorkflow && (
                    <div className="space-y-4">
                      <h3 className="text-xs font-bold tracking-wider" style={{ color: "#00aaff" }}>Optimize Portfolio</h3>
                      <div className="flex flex-col gap-4 max-w-[66%]">
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] tracking-wider font-semibold" style={{ color: C.muted }}>Portfolio</label>
                          <div className="flex items-center gap-2">
                            <Dropdown
                              value={learn.learnSource}
                              options={learn.uploadedDatasets.map((d: ApiRecord) => ({ value: `uploaded-dataset:${d.dataset_id}`, label: `${d.upload_name || d.dataset_id} (${d.row_count || 0} rows)` }))}
                              onChange={(val) => {
                                learn.setLearnSource(val);
                                const newDatasetId = val.startsWith("uploaded-dataset:") ? val.replace("uploaded-dataset:", "") : "";
                                const newDataset = learn.uploadedDatasets.find((d: ApiRecord) => d.dataset_id === newDatasetId);
                                const newName = newDataset?.upload_name || newDatasetId;
                                const newRowCount = Number(newDataset?.row_count ?? 0);
                                const hasCatalogs = newRowCount > 0 && learn.catalogList.some((c: ApiRecord) => String(c.source || "").toLowerCase().includes(newName.toLowerCase()));
                                if (hasCatalogs && learn.selectedCatalogVersion) optimization.fetchSavedOptimizations(learn.selectedCatalogVersion);
                                else { optimization.setOptimizationState(null); optimization.setSelectedSavedOptimizationId(""); }
                              }}
                              className="w-full"
                            />
                            <span className="text-[10px] tracking-wider shrink-0 invisible">Show</span>
                          </div>
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] tracking-wider font-semibold" style={{ color: C.muted }}>Profile</label>
                          {(() => {
                            const selectedDatasetId = learn.learnSource.startsWith("uploaded-dataset:") ? learn.learnSource.replace("uploaded-dataset:", "") : "";
                            const selectedDataset = learn.uploadedDatasets.find((d: ApiRecord) => d.dataset_id === selectedDatasetId);
                            const portfolioName = selectedDataset?.upload_name || selectedDatasetId;
                            const portfolioRowCount = Number(selectedDataset?.row_count ?? 0);
                            const filtered = portfolioRowCount === 0 ? [] : learn.catalogList.filter((c: ApiRecord) => {
                              if (!portfolioName) return true;
                              return String(c.source || "").toLowerCase().includes(portfolioName.toLowerCase());
                            });
                            return filtered.length > 0 ? (
                              <>
                                <div className="flex items-center gap-2">
                                  <Dropdown
                                    value={learn.selectedCatalogVersion}
                                    options={filtered.map((c: ApiRecord) => ({ value: c.version, label: `${c.version} (${c.profile_count} profiles)` }))}
                                    onChange={(val) => { learn.setSelectedCatalogVersion(val); learn.loadCatalog(val); optimization.fetchSavedOptimizations(val); setShowRecentCatalogDetail(false); }}
                                    mono
                                    className="w-full"
                                  />
                                  <button type="button" onClick={() => setShowRecentCatalogDetail(v => !v)} className="text-[10px] tracking-wider hover:underline underline-offset-2 shrink-0" style={{ color: C.accentDim }}>
                                    {showRecentCatalogDetail ? "Hide" : "Show"}
                                  </button>
                                </div>
                                {showRecentCatalogDetail && learn.catalog && (
                                  <div className="mt-2 rounded-lg border overflow-x-clip" style={{ borderColor: C.border, background: C.surface }}>
                                    <div className="px-3 py-2 border-b text-[10px] tracking-wider font-semibold sticky top-0 z-10" style={{ borderColor: C.border, color: C.muted, background: C.surface }}>
                                      Version: <span className="font-mono">{learn.catalog.version}</span> · Source: {learn.catalog.source} · K={learn.catalog.k}
                                      {learn.catalog.total_learning_population > 0 && ` · ${learn.catalog.total_learning_population.toLocaleString()} users`}
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
                                        {learn.catalog.profiles.map((p: ApiRecord) => (
                                          <tr key={p.profile_id} style={{ borderBottom: `1px solid ${C.border}` }}>
                                            <td className="py-2 px-3" style={{ color: C.muted }}><ChevronRight className="h-3 w-3" /></td>
                                            <td className="py-2 pr-4">
                                              <div className="flex items-center gap-2">
                                                <span className={cn("inline-flex items-center justify-center rounded-full text-white text-[10px] font-bold w-6 h-6 shrink-0", p.description?.toLowerCase().includes("return-heavy") ? "bg-amber-600" : "bg-[#3bb266]")}>{p.profile_id}</span>
                                                {p.label && <span className="text-[10px] font-semibold" style={{ color: C.muted }}>{p.label}</span>}
                                              </div>
                                            </td>
                                            <td className="py-2 pr-4" style={{ color: C.textSec }}>{p.description}</td>
                                            <td className="py-2 pr-4 text-right font-mono" style={{ color: C.textSec }}>
                                              {p.portfolio_ltv != null ? `${p.portfolio_ltv < 0 ? '-' : ''}$${Math.abs(p.portfolio_ltv).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '—'}
                                            </td>
                                            <td className="py-2 pr-4 text-right font-mono" style={{ color: C.muted }}>
                                              {p.population_count > 0 ? p.population_count.toLocaleString() : ''}<span className="ml-1">({(p.population_share * 100).toFixed(1)}%)</span>
                                            </td>
                                          </tr>
                                        ))}
                                        <tr style={{ background: C.surfaceLt }}>
                                          <td className="py-3 px-3" colSpan={3}><span className="text-[9px] tracking-wider font-bold" style={{ color: C.muted }}>Total Portfolio LTV</span></td>
                                          <td className="py-3 pr-4 text-right font-mono font-bold" style={{ color: C.text, borderTop: `1px solid ${C.border}` }}>
                                            {(() => { const total = learn.catalog.profiles.reduce((s: number, p: ApiRecord) => s + (p.portfolio_ltv || 0), 0); return `${total < 0 ? '-' : ''}$${Math.abs(total).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`; })()}
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
                              value={incentives.selectedIncentiveSetVersion || optimization.optimizationState?.incentive_set_version || ""}
                              options={incentives.incentiveSets.map((s: ApiRecord) => ({ value: s.version, label: `${s.name || s.version} (${s.incentive_count} incentives)${s.is_default ? " *" : ""}` }))}
                              onChange={(val) => { incentives.setSelectedIncentiveSetVersion(val); optimization.setOptimizationState(null); optimization.setSelectedSavedOptimizationId(""); setShowRecentIncentiveDetail(false); }}
                              className="w-full"
                            />
                            <button type="button" onClick={() => { const next = !showRecentIncentiveDetail; setShowRecentIncentiveDetail(next); if (next && !incentives.selectedIncentiveSetDetail) incentives.loadIncentiveSetDetail(incentives.selectedIncentiveSetVersion || optimization.optimizationState?.incentive_set_version || undefined); }} className="text-[10px] tracking-wider hover:underline underline-offset-2 shrink-0" style={{ color: C.accentDim }}>
                              {showRecentIncentiveDetail ? "Hide" : "Show"}
                            </button>
                          </div>
                          {showRecentIncentiveDetail && incentives.selectedIncentiveSetDetail && (
                            <div className="mt-2 rounded-lg border overflow-hidden" style={{ borderColor: C.border, background: C.surface }}>
                              <div className="px-3 py-2 border-b text-[10px] tracking-wider font-semibold" style={{ borderColor: C.border, color: C.muted }}>
                                {incentives.selectedIncentiveSetDetail.name || incentives.selectedIncentiveSetDetail.version} ({(incentives.selectedIncentiveSetDetail.incentives || []).length} incentives)
                              </div>
                              <div className="px-3 py-2">
                                {(incentives.selectedIncentiveSetDetail.incentives || []).length === 0 ? (
                                  <p className="text-xs" style={{ color: C.muted }}>No incentives loaded.</p>
                                ) : (
                                  <div className="flex flex-wrap gap-1.5">
                                    {(incentives.selectedIncentiveSetDetail.incentives || []).map((inc: ApiRecord, idx: number) => (
                                      <span key={idx} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border" style={{ borderColor: C.border, background: "white", color: "black" }}>
                                        {inc.name}<span style={{ color: C.muted }}>${Math.round((inc.estimated_annual_cost_per_user || 0) * (inc.redemption_rate || 1))}</span>
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
                      {optimization.optimizationState?.results && optimization.optimizationState.results.length > 0 && (
                        <div className="rounded-xl border px-6 pb-6 pt-3 space-y-4" style={{ borderColor: C.border, background: C.surface }}>
                          <div className="flex items-center justify-between sticky top-0 z-10 pb-2" style={{ background: C.surface }}>
                            <h4 className="text-xs font-bold tracking-wider" style={{ color: "#00aaff" }}>Optimal Incentive Program</h4>
                            {optimization.optimizationState?.engine === "monte_carlo" && optimization.optimizationState?.optimization_id && (
                              <button
                                className="px-3 py-1 text-[10px] font-medium rounded border hover:opacity-80 transition-opacity"
                                style={{ borderColor: C.border, color: C.accentDim }}
                                onClick={async () => {
                                  try {
                                    const res = await fetch(`${CLOUD_FUNCTION_URL}/export_deal_memo/${optimization.optimizationState!.optimization_id}`, { method: "POST" });
                                    if (!res.ok) throw new Error("Export failed");
                                    const data = await res.json();
                                    const byteChars = atob(data.pdf_base64);
                                    const byteArray = new Uint8Array(byteChars.length);
                                    for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
                                    const blob = new Blob([byteArray], { type: "application/pdf" });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement("a");
                                    a.href = url;
                                    a.download = data.filename || "deal_memo.pdf";
                                    a.click();
                                    URL.revokeObjectURL(url);
                                  } catch (e) { console.error("Deal memo export failed:", e); }
                                }}
                              >
                                Export Deal Memo
                              </button>
                            )}
                          </div>
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
                                  {optimization.optimizationState?.engine === "monte_carlo" && (
                                    <>
                                      <th className="py-2 pr-4 font-medium text-right">90% CI</th>
                                      <th className="py-2 pr-4 font-medium text-right">P(Lift&gt;0)</th>
                                    </>
                                  )}
                                  {agentChat.gridCustomColumns.map((col) => (
                                    <th key={col.id} className="py-2 pr-4 font-medium text-right" style={{ color: "#00aaff" }}>{col.label}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {optimization.optimizationState.results.map((r: ApiRecord, idx: number) => (
                                  <tr key={`${r.profile_id}-${idx}`} style={{ borderBottom: `1px solid ${C.border}` }}>
                                    <td className="py-3 pr-4 font-semibold" style={{ color: C.text }}>{r.profile_id}</td>
                                    <td className="py-3 pr-4">
                                      <div className="flex flex-wrap gap-1">
                                        {(r.selected_incentives || []).map((inc: string, idx: number) => (<span key={idx} className="inline-flex px-2 py-0.5 rounded text-xs font-semibold bg-white text-black">{inc}</span>))}
                                        {(!r.selected_incentives || r.selected_incentives.length === 0) && (<span className="text-xs" style={{ color: C.muted }}>None</span>)}
                                      </div>
                                    </td>
                                    <td className="py-3 pr-4 text-right font-mono" style={{ color: C.muted }}>{`$${Math.round(r.original_portfolio_ltv).toLocaleString('en-US')}`}</td>
                                    <td className="py-3 pr-4 text-right font-mono" style={{ color: C.textSec }}>{`$${Math.round(r.new_gross_portfolio_ltv).toLocaleString('en-US')}`}</td>
                                    <td className="py-3 pr-4 text-right font-mono" style={{ color: C.textSec }}>{`${r.portfolio_cost > 0 ? '-' : ''}$${Math.round(Math.abs(r.portfolio_cost)).toLocaleString('en-US')}`}</td>
                                    <td className="py-3 pr-4 text-right font-mono" style={{ color: C.textSec }}>{`+$${Math.round(r.lift).toLocaleString('en-US')}`}</td>
                                    <td className="py-3 pr-4 text-right font-mono font-bold" style={{ color: C.text }}>{`$${Math.round(r.new_net_portfolio_ltv).toLocaleString('en-US')}`}</td>
                                    {optimization.optimizationState?.engine === "monte_carlo" && (
                                      <>
                                        <td className="py-3 pr-4 text-right font-mono text-xs" style={{ color: C.muted }}>
                                          {r.confidence_interval_90
                                            ? `$${Math.round(r.confidence_interval_90[0]).toLocaleString('en-US')} – $${Math.round(r.confidence_interval_90[1]).toLocaleString('en-US')}`
                                            : "—"}
                                        </td>
                                        <td className="py-3 pr-4 text-right font-mono" style={{ color: C.textSec }}>
                                          {r.probability_positive_lift != null ? `${(r.probability_positive_lift * 100).toFixed(0)}%` : "—"}
                                        </td>
                                      </>
                                    )}
                                    {agentChat.gridCustomColumns.map((col) => (
                                      <td key={col.id} className="py-3 pr-4 text-right font-mono" style={{ color: "#00aaff" }}>{formatCustomColValue(col.expr(r), col.format)}</td>
                                    ))}
                                  </tr>
                                ))}
                                <tr style={{ background: C.surfaceLt }}>
                                  <td className="py-4 pr-4" colSpan={2}><span className="text-[10px] tracking-wider font-bold" style={{ color: C.muted }}>Maximized Total Portfolio</span></td>
                                  <td className="py-4 pr-4 text-right font-mono font-bold" style={{ color: C.text, borderTop: `1px solid ${C.border}` }}>{`$${Math.round(optimization.optimizationState.results.reduce((s: number, r: ApiRecord) => s + (r.original_portfolio_ltv || 0), 0)).toLocaleString('en-US')}`}</td>
                                  <td className="py-4 pr-4 text-right font-mono" style={{ color: C.textSec, borderTop: `1px solid ${C.border}` }}>{`$${Math.round(optimization.optimizationState.results.reduce((s: number, r: ApiRecord) => s + (r.new_gross_portfolio_ltv || 0), 0)).toLocaleString('en-US')}`}</td>
                                  <td className="py-4 pr-4 text-right font-mono" style={{ color: C.textSec, borderTop: `1px solid ${C.border}` }}>{`-$${Math.round(optimization.optimizationState.results.reduce((s: number, r: ApiRecord) => s + (r.portfolio_cost || 0), 0)).toLocaleString('en-US')}`}</td>
                                  <td className="py-4 pr-4 text-right font-mono font-bold" style={{ color: C.textSec, borderTop: `1px solid ${C.border}` }}>{`+$${Math.round(optimization.optimizationState.results.reduce((s: number, r: ApiRecord) => s + (r.lift || 0), 0)).toLocaleString('en-US')}`}</td>
                                  <td className="py-4 pr-4 text-right font-mono font-bold" style={{ color: C.text, borderTop: `1px solid ${C.border}` }}>{`$${Math.round(optimization.optimizationState.results.reduce((s: number, r: ApiRecord) => s + (r.new_net_portfolio_ltv || 0), 0)).toLocaleString('en-US')}`}</td>
                                  {optimization.optimizationState?.engine === "monte_carlo" && (
                                    <>
                                      <td className="py-4 pr-4" style={{ borderTop: `1px solid ${C.border}` }} />
                                      <td className="py-4 pr-4" style={{ borderTop: `1px solid ${C.border}` }} />
                                    </>
                                  )}
                                  {agentChat.gridCustomColumns.map((col) => {
                                    const results = optimization.optimizationState!.results as ApiRecord[];
                                    const vals = results.map((r: ApiRecord) => col.expr(r));
                                    const agg = col.totalsExpr === "avg" ? vals.reduce((s, v) => s + v, 0) / (vals.length || 1) : vals.reduce((s, v) => s + v, 0);
                                    return (<td key={col.id} className="py-4 pr-4 text-right font-mono font-bold" style={{ color: "#00aaff", borderTop: `1px solid ${C.border}` }}>{formatCustomColValue(agg, col.format)}</td>);
                                  })}
                                </tr>
                              </tbody>
                            </table>
                          </div>
                          {optimization.optimizationState?.engine === "monte_carlo" && optimization.optimizationState?.sensitivity_analysis && (
                            <SensitivityChart data={optimization.optimizationState.sensitivity_analysis} />
                          )}
                          <div className="text-xs px-1" style={{ color: C.muted }}>
                            {optimization.optimizationState?.engine === "monte_carlo"
                              ? `Monte Carlo simulation (${(optimization.optimizationState?.n_simulations || 5000).toLocaleString()} draws per bundle). Uptake rates sampled from Beta-Binomial priors. Only net-positive bundles retained (p5 ≥ 95% of baseline). 90% CI = 5th–95th percentile range.`
                              : "Convergence-based optimization: each profile iterates until rolling outcomes statistically stabilize (low variance + near-zero trend), with max-iteration and patience guards. Only net-positive incentives retained (marginal LTV > effective cost)."
                            }
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          {splitPane.isDesktopViewport && (
            <>
              <AgentChatPanel
                agentChatMessages={agentChat.agentChatMessages}
                agentChatLoading={agentChat.agentChatLoading}
                agentChatDraft={agentChat.agentChatDraft}
                setAgentChatDraft={agentChat.setAgentChatDraft}
                typedWelcomeLine={typedWelcomeLine}
                agentChatScrollRef={agentChat.agentChatScrollRef}
                optimizeInProgress={optimization.optimizeInProgress}
                learnInProgress={learn.learnInProgress}
                pendingCreateWorkflow={wf.pendingCreateWorkflow}
                pendingWorkflowAction={wf.pendingWorkflowAction}
                pendingEditWorkflow={wf.pendingEditWorkflow}
                onSubmit={agentChat.submitAgentChat}
                onStop={agentChat.handleAgentStop}
              />

              <div
                onMouseDown={splitPane.startSplitResize}
                className="group/divider absolute top-0 bottom-0 z-30 hidden w-8 -translate-x-1/2 cursor-col-resize items-center justify-center md:flex"
                style={{ left: `${splitPane.splitRatio}%` }}
                role="separator"
                aria-label="Resize panes"
                aria-orientation="vertical"
                title="Drag to resize panes"
              >
                <div className={cn(
                  "pointer-events-none absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-[#66ff99] transition-opacity duration-150",
                  splitPane.isResizingSplit ? "opacity-100" : "opacity-0 group-hover/divider:opacity-100",
                )} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
