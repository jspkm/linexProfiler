"use client";

import { useState, useEffect, useMemo } from "react";
import { Upload, Loader2, Square, Trash2, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ApiRecord, GridCustomColumn } from "@/lib/types";
import type { GeneratorTab } from "./theme";

type ColFormat = "dollar" | "percent" | "ratio" | "number";

interface ProfileGeneratorViewProps {
  genLoading: boolean;
  genError: string;
  learnStatus: string;
  learnInProgress: boolean;
  generatorTab: GeneratorTab;
  setGeneratorTab: (v: GeneratorTab) => void;
  learnSource: string;
  setLearnSource: (v: string) => void;
  learnUploadName: string;
  setLearnUploadName: (v: string) => void;
  learnUploadFile: File | null;
  setLearnUploadFile: (v: File | null) => void;
  learnUploadSubmitted: boolean;
  setLearnUploadSubmitted: (v: boolean) => void;
  pendingUploadedPortfolioName: string;
  setPendingUploadedPortfolioName: (v: string) => void;
  uploadedDatasets: ApiRecord[];
  deleteSelectedPortfolio: () => void;
  learnK: number;
  setLearnK: (v: number) => void;
  learnProfiles: () => void;
  stopLearnProcess: () => void;
  catalog: ApiRecord | null;
  catalogList: ApiRecord[];
  selectedCatalogVersion: string;
  setSelectedCatalogVersion: (v: string) => void;
  loadCatalog: (v?: string) => void;
  startOptimization: () => void;
  stopOptimization: () => void;
  deleteOptimization: () => void;
  deleteCatalog: (v: string) => void;
  optimizationState: ApiRecord | null;
  optimizationStarting: boolean;
  optimizeInProgress: boolean;
  optimizationStopPhase: string;
  showOptimizationProgress: boolean;
  savedOptimizations: ApiRecord[];
  selectedSavedOptimizationId: string | null;
  loadSavedOptimization: (v: string) => void;
  fetchSavedOptimizations: (v?: string) => void;
  incentiveSets: ApiRecord[];
  selectedIncentiveSetVersion: string | null;
  setSelectedIncentiveSetVersion: (v: string) => void;
  selectedIncentiveSetDetail: ApiRecord | null;
  incentiveSetDetailLoading: boolean;
  gridCustomColumns: GridCustomColumn[];
  formatCustomColValue: (v: number, format: ColFormat) => string;
}

export default function ProfileGeneratorView({
  genLoading, genError, learnStatus, learnInProgress, generatorTab, setGeneratorTab,
  learnSource, setLearnSource, learnUploadName, setLearnUploadName, learnUploadFile, setLearnUploadFile, learnUploadSubmitted, setLearnUploadSubmitted, pendingUploadedPortfolioName, setPendingUploadedPortfolioName, uploadedDatasets, deleteSelectedPortfolio, learnK, setLearnK, learnProfiles, stopLearnProcess,
  catalogList, selectedCatalogVersion, setSelectedCatalogVersion,
  startOptimization, stopOptimization, deleteOptimization, deleteCatalog,
  optimizationState, optimizeInProgress, optimizationStopPhase, showOptimizationProgress,
  savedOptimizations, selectedSavedOptimizationId, loadSavedOptimization, fetchSavedOptimizations,
  incentiveSets, selectedIncentiveSetVersion, setSelectedIncentiveSetVersion, selectedIncentiveSetDetail, incentiveSetDetailLoading,
  gridCustomColumns, formatCustomColValue,
}: ProfileGeneratorViewProps) {
  const [showIncentiveSetIncentives, setShowIncentiveSetIncentives] = useState(false);
  const [showDecisionSteps, setShowDecisionSteps] = useState(false);
  const [optimizeInitElapsedSec, setOptimizeInitElapsedSec] = useState(0);
  const isLearnActive = Boolean(learnInProgress);
  const isOptimizeActive = Boolean(optimizeInProgress);
  const showOptimizeStatusMessage = showOptimizationProgress && (isOptimizeActive || optimizationState || optimizationStopPhase !== "idle");
  const isGeneratorLocked = isLearnActive || isOptimizeActive;
  const selectedSetMeta = incentiveSets.find((s: ApiRecord) => s.version === selectedIncentiveSetVersion);
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
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setOptimizeInitElapsedSec(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);
    return () => {
      clearInterval(timer);
      queueMicrotask(() => setOptimizeInitElapsedSec(0));
    };
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
  const tabs: { key: GeneratorTab; label: string }[] = [
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
  const renderOptimizationStatus = (state: ApiRecord) => {
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
  const formatProgramName = (program: ApiRecord) => {
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
    const base = (savedOptimizations || []).map((exp: ApiRecord) => ({
      optimization_id: String(exp.optimization_id || ""),
      label: formatProgramName(exp),
    })).filter((exp: { optimization_id: string }) => Boolean(exp.optimization_id));

    const selectedId = String(selectedSavedOptimizationId || "");
    if (!selectedId || base.some((exp: { optimization_id: string }) => exp.optimization_id === selectedId)) {
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
  const renderOptimizationDecisionSteps = (state: ApiRecord | null) => {
    const status = String(state?.status || "");
    const isRunning = status === "running";
    const isFinished = status === "completed" || status === "cancelled";
    const isFailed = status === "failed";
    const hasAnyData = Boolean(state);
    const hasPilotData = Array.isArray(state?.available_incentives)
      && state.available_incentives.some((inc: ApiRecord) => Number(inc?.uptake_observed_trials || 0) > 0);
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
                      {uploadedDatasets.map((d: ApiRecord) => (
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
                    {/* eslint-disable-next-line @next/next/no-img-element */}
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
                    className="rounded-md border px-3 py-2 text-sm bg-white w-full sm:max-w-160"
                  >
                    {catalogList.map((c: ApiRecord) => (
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
                    value={selectedIncentiveSetVersion || ""}
                    disabled={isGeneratorLocked}
                    onChange={(e) => setSelectedIncentiveSetVersion(e.target.value)}
                    className="rounded-md border px-3 py-2 text-sm bg-white w-full sm:max-w-160"
                  >
                    {incentiveSets.map((s: ApiRecord) => (
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
                        {incentivesForDisplay.map((inc: ApiRecord, idx: number) => (
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
                    className="rounded-md border px-3 py-2 text-sm bg-white w-full sm:max-w-160"
                  >
                    {programOptions.map((program) => (
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
                      <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto max-w-full sm:max-w-130 flex items-center gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
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
                          {/* Results table */}
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
                                    {(gridCustomColumns || []).map((col) => (
                                      <th key={col.id} className="py-2 pr-4 font-medium text-right text-[#00aaff]">{col.label}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {optimizationState.results.map((r: ApiRecord) => (
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
                                      {(gridCustomColumns || []).map((col) => (
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
                                        const totalOrig = optimizationState.results.reduce((sum: number, r: ApiRecord) => sum + (r.original_portfolio_ltv || 0), 0);
                                        return `$${Math.round(totalOrig).toLocaleString('en-US')}`;
                                      })()}
                                    </td>
                                    <td className="py-4 pr-4 text-right font-mono text-slate-700 border-t border-slate-200">
                                      {(() => {
                                        const totalGross = optimizationState.results.reduce((sum: number, r: ApiRecord) => sum + (r.new_gross_portfolio_ltv || 0), 0);
                                        return `$${Math.round(totalGross).toLocaleString('en-US')}`;
                                      })()}
                                    </td>
                                    <td className="py-4 pr-4 text-right font-mono text-slate-700 border-t border-slate-200">
                                      {(() => {
                                        const totalCost = optimizationState.results.reduce((sum: number, r: ApiRecord) => sum + (r.portfolio_cost || 0), 0);
                                        return `-$${Math.round(totalCost).toLocaleString('en-US')}`;
                                      })()}
                                    </td>
                                    <td className="py-4 pr-4 text-right font-mono text-slate-700 font-bold border-t border-slate-200">
                                      {(() => {
                                        const totalLift = optimizationState.results.reduce((sum: number, r: ApiRecord) => sum + (r.lift || 0), 0);
                                        return `+$${Math.round(totalLift).toLocaleString('en-US')}`;
                                      })()}
                                    </td>
                                    <td className="py-4 pr-4 text-right font-mono text-slate-900 font-bold border-t border-slate-200">
                                      {(() => {
                                        const totalNet = optimizationState.results.reduce((sum: number, r: ApiRecord) => sum + (r.new_net_portfolio_ltv || 0), 0);
                                        return `$${Math.round(totalNet).toLocaleString('en-US')}`;
                                      })()}
                                    </td>
                                    {(gridCustomColumns || []).map((col) => {
                                      const results = optimizationState.results as ApiRecord[];
                                      const vals = results.map((r: ApiRecord) => col.expr(r));
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

                          {/* Methodology note */}
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
