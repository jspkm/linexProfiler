import { useState, useRef, useEffect, useCallback } from "react";
import { CLOUD_FUNCTION_URL } from "@/lib/api";
import { formatChatTimestamp, GREETING_RE, isGibberish, pickCanned, GRID_FIELDS, compileFormula } from "@/lib/helpers";
import type { ApiRecord, ChatMessage, GridCustomColumn, PendingCreateWorkflow, PendingWorkflowAction, PendingEdit } from "@/lib/types";

interface AgentChatDeps {
  // Learn profiles
  learnInProgress: boolean;
  setLearnInProgress: (v: boolean) => void;
  learnSource: string;
  setLearnSource: (v: string) => void;
  setLearnK: (v: number) => void;
  uploadedDatasets: ApiRecord[];
  fetchCatalogList: () => Promise<void>;
  loadCatalog: (version?: string) => Promise<void>;
  selectedCatalogVersion: string;
  setSelectedCatalogVersion: (v: string) => void;
  catalog: ApiRecord | null;
  catalogList: ApiRecord[];
  // Optimization
  optimizeInProgress: boolean;
  setOptimizeInProgress: (v: boolean) => void;
  optimizationId: string | null;
  setOptimizationId: (v: string | null) => void;
  optimizationState: ApiRecord | null;
  setOptimizationState: (v: ApiRecord | null) => void;
  optimizationPolling: boolean;
  setOptimizationPolling: (v: boolean) => void;
  showOptimizationProgress: boolean;
  setShowOptimizationProgress: (v: boolean) => void;
  setOptimizationStopPhase: (v: "idle" | "cancelling" | "cleaning") => void;
  setOptimizationStarting: (v: boolean) => void;
  optimizationStopRequestedRef: React.MutableRefObject<boolean>;
  optimizationCacheRef: React.MutableRefObject<ApiRecord>;
  savedOptimizations: ApiRecord[];
  selectedSavedOptimizationId: string | null;
  setSelectedSavedOptimizationId: (v: string | null) => void;
  fetchSavedOptimizations: (catalogVersion?: string) => Promise<void>;
  // Incentive sets
  incentiveSets: ApiRecord[];
  selectedIncentiveSetVersion: string;
  setSelectedIncentiveSetVersion: (v: string) => void;
  selectedIncentiveSetDetail: ApiRecord | null;
  setSelectedIncentiveSetDetail: (v: ApiRecord | null) => void;
  fetchIncentiveSets: () => Promise<void>;
  loadIncentiveSetDetail: (version?: string) => Promise<void>;
  // Workflows
  workflows: ApiRecord[];
  setWorkflows: (v: ApiRecord[]) => void;
  fetchWorkflows: () => Promise<void>;
  pendingDeleteCatalogRef: React.MutableRefObject<string | null>;
  setPendingDeleteCatalog: (v: string | null) => void;
  pendingDeleteIncentiveSetRef: React.MutableRefObject<string | null>;
  setPendingDeleteIncentiveSet: (v: string | null) => void;
  pendingDeleteWorkflowRef: React.MutableRefObject<string | null>;
  setPendingDeleteWorkflow: (v: string | null) => void;
  pendingCreateWorkflowRef: React.MutableRefObject<PendingCreateWorkflow>;
  setPendingCreateWorkflow: (v: PendingCreateWorkflow) => void;
  pendingWorkflowActionRef: React.MutableRefObject<PendingWorkflowAction>;
  setPendingWorkflowAction: (v: PendingWorkflowAction) => void;
  pendingEditWorkflowRef: React.MutableRefObject<PendingEdit>;
  setPendingEditWorkflow: (v: PendingEdit) => void;
  // Generator
  setGenLoading: (v: boolean) => void;
  setGenError: (v: string) => void;
}

export function useAgentChat(deps: AgentChatDeps) {
  const [agentChatDraft, setAgentChatDraft] = useState("");
  const [agentChatMessages, setAgentChatMessages] = useState<ChatMessage[]>([]);
  const [agentChatLoading, setAgentChatLoading] = useState(false);
  const [gridCustomColumns, setGridCustomColumns] = useState<GridCustomColumn[]>([]);

  const agentOptLastStep = useRef("");
  const agentOptDoneRef = useRef(false);
  const agentLearnAbortRef = useRef<AbortController | null>(null);
  const agentChatScrollRef = useRef<HTMLDivElement | null>(null);
  const agentStoppingRef = useRef(false);

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    const el = agentChatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [agentChatMessages, agentChatLoading]);

  /** Build full optimization context sent to backend */
  const buildGridContext = useCallback((overrides?: { incentiveSetDetail?: ApiRecord }) => {
    const ctx: ApiRecord = {
      fields: GRID_FIELDS,
      custom_columns: gridCustomColumns.map((c) => ({ label: c.label, formula: c.exprSource, format: c.format })),
      has_results: Boolean(deps.optimizationState?.results?.length),
    };
    if (deps.catalog) {
      ctx.catalog = {
        version: deps.catalog.version, source: deps.catalog.source, k: deps.catalog.k,
        total_learning_population: deps.catalog.total_learning_population,
        profiles: (((deps.catalog as ApiRecord)?.profiles as ApiRecord[]) || []).map((p: ApiRecord) => ({
          profile_id: p.profile_id, label: p.label, description: p.description,
          portfolio_ltv: p.portfolio_ltv, population_count: p.population_count, population_share: p.population_share,
        })),
      };
    }
    const incDetail = overrides?.incentiveSetDetail || deps.selectedIncentiveSetDetail;
    if (incDetail) {
      ctx.incentive_set = {
        name: incDetail.name || incDetail.version, version: incDetail.version,
        incentives: (incDetail.incentives || []).map((inc: ApiRecord) => ({
          name: inc.name, estimated_annual_cost_per_user: inc.estimated_annual_cost_per_user,
          redemption_rate: inc.redemption_rate,
          effective_cost: Math.round((Number(inc.estimated_annual_cost_per_user) || 0) * (Number(inc.redemption_rate) || 1)),
        })),
      };
    }
    if (deps.optimizationState) {
      const isMC = deps.optimizationState.engine === "monte_carlo";
      ctx.optimization = {
        status: deps.optimizationState.status,
        engine: deps.optimizationState.engine || "legacy",
        ...(isMC
          ? { n_simulations: deps.optimizationState.n_simulations }
          : { max_iterations: deps.optimizationState.max_iterations || 50, convergence_window: deps.optimizationState.convergence_window || 6, patience: deps.optimizationState.patience || 3 }
        ),
        started_at: deps.optimizationState.started_at,
        completed_at: deps.optimizationState.completed_at,
        results: ((deps.optimizationState.results as ApiRecord[]) || []).map((r: ApiRecord) => ({
          profile_id: r.profile_id, selected_incentives: r.selected_incentives,
          original_portfolio_ltv: r.original_portfolio_ltv, new_gross_portfolio_ltv: r.new_gross_portfolio_ltv,
          portfolio_cost: r.portfolio_cost, lift: r.lift, new_net_portfolio_ltv: r.new_net_portfolio_ltv,
          ...(isMC ? {
            percentiles: r.percentiles,
            probability_positive_lift: r.probability_positive_lift,
            confidence_interval_90: r.confidence_interval_90,
          } : {}),
        })),
      };
      if (isMC && deps.optimizationState.sensitivity_analysis) {
        ctx.optimization.sensitivity_analysis = deps.optimizationState.sensitivity_analysis;
      }
    }
    ctx.available_profiles = deps.catalogList.map((c: ApiRecord) => ({ version: c.version, source: c.source, k: c.k }));
    ctx.uploaded_portfolios = (deps.uploadedDatasets || []).map((d: ApiRecord) => ({ dataset_id: d.dataset_id, name: d.upload_name, created_at: d.created_at }));
    ctx.saved_programs = (deps.savedOptimizations || []).map((exp: ApiRecord) => ({
      optimization_id: exp.optimization_id, status: exp.status, profile_count: exp.result_count || 0,
      total_lift: exp.total_lift ?? null, started_at: exp.started_at, completed_at: exp.completed_at,
      catalog_version: exp.catalog_version, incentive_set_version: exp.incentive_set_version,
    }));
    ctx.available_incentive_sets = (deps.incentiveSets || []).map((s: ApiRecord) => ({
      version: s.version, name: s.name || s.version, is_default: s.is_default || false, incentive_count: s.incentive_count || 0,
    }));
    ctx.available_workflows = [
      { workflow_id: "builtin-optimize-portfolio", name: "Optimize portfolio", description: "Learn behavioral profiles from transaction data using clustering, then derive optimal incentive program through simulation.", type: "built-in" },
      ...(deps.workflows || []).map((w: ApiRecord) => ({ workflow_id: w.workflow_id, name: w.name, description: w.description, detail: w.detail || "", type: "custom" })),
    ];
    ctx.pending_delete_catalog = deps.pendingDeleteCatalogRef.current;
    ctx.pending_delete_incentive_set = deps.pendingDeleteIncentiveSetRef.current;
    ctx.pending_delete_workflow = deps.pendingDeleteWorkflowRef.current;
    ctx.is_busy = Boolean(deps.learnInProgress || deps.optimizeInProgress);
    if (deps.learnInProgress) ctx.busy_reason = "profile_creation";
    else if (deps.optimizeInProgress) ctx.busy_reason = "optimization";
    ctx.selected_catalog_version = deps.selectedCatalogVersion || null;
    ctx.selected_incentive_set_version = deps.selectedIncentiveSetVersion || null;
    ctx.has_optimization_result = Boolean(deps.optimizationState?.status === "completed");
    return ctx;
  }, [gridCustomColumns, deps]);

  /** Execute structured actions returned by the backend */
  const executeAgentActions = useCallback(async (actions: ApiRecord[]) => {
    for (const action of actions) {
      if (action.type === "add_column") {
        const fn = compileFormula(action.formula || "");
        if (!fn) continue;
        const newCol: GridCustomColumn = {
          id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          label: (action.label || "").toUpperCase(),
          expr: fn, exprSource: action.formula,
          format: (["dollar", "percent", "ratio", "number"].includes(action.format) ? action.format : "number") as GridCustomColumn["format"],
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
        const k = Number(action.k);
        const source = action.source || "uploaded";
        if (!k || k < 2) continue;
        if (deps.learnInProgress || deps.optimizeInProgress) {
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: "Cannot create a profile while another operation is in progress.", submittedAt: formatChatTimestamp(new Date()) }]);
          continue;
        }
        const datasetId = action.dataset_id || (deps.uploadedDatasets.length > 0 ? deps.uploadedDatasets[0].dataset_id : null);
        if (source.startsWith("uploaded") && !datasetId) {
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: "No uploaded dataset found. Please upload a portfolio CSV first.", submittedAt: formatChatTimestamp(new Date()) }]);
          continue;
        }
        deps.setLearnK(k);
        if (datasetId) deps.setLearnSource(`uploaded-dataset:${datasetId}`);
        try {
          setAgentChatLoading(true);
          deps.setLearnInProgress(true);
          const learnAbort = new AbortController();
          agentLearnAbortRef.current = learnAbort;
          const body: ApiRecord = { k, source: datasetId ? `uploaded-dataset:${datasetId}` : source };
          const res = await fetch(`${CLOUD_FUNCTION_URL}/learn_profiles`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body), signal: learnAbort.signal,
          });
          if (res.ok) {
            const data = await res.json();
            await deps.fetchCatalogList();
            if (data.version) { deps.setSelectedCatalogVersion(data.version); deps.loadCatalog(data.version); }
            setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: `Profile created successfully (version: ${data.version || "unknown"}, K=${k}, ${(data.profiles || []).length} profiles).`, submittedAt: formatChatTimestamp(new Date()) }]);
          } else {
            const errData = await res.json().catch(() => ({}));
            setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: `Failed to create profile: ${errData.error || res.statusText}`, submittedAt: formatChatTimestamp(new Date()) }]);
          }
        } catch (e: unknown) {
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: `Error creating profile: ${e instanceof Error ? e.message : "unknown error"}`, submittedAt: formatChatTimestamp(new Date()) }]);
        } finally {
          agentLearnAbortRef.current = null; setAgentChatLoading(false); deps.setLearnInProgress(false);
        }
      } else if (action.type === "request_delete_profile") {
        const version = action.version || "";
        if (version) deps.setPendingDeleteCatalog(version);
      } else if (action.type === "confirm_delete_profile") {
        const version = deps.pendingDeleteCatalogRef.current || action.version || "";
        if (!version) continue;
        if (deps.learnInProgress || deps.optimizeInProgress) {
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: "Cannot delete while another operation is in progress.", submittedAt: formatChatTimestamp(new Date()) }]);
          continue;
        }
        const deleteProgressId = `${Date.now()}-del-progress`;
        try {
          setAgentChatLoading(true);
          setAgentChatMessages((prev) => [...prev, { id: deleteProgressId, role: "agent", text: `Deleting profile ${version.slice(0, 12)}...`, submittedAt: formatChatTimestamp(new Date()) }]);
          const listRes = await fetch(`${CLOUD_FUNCTION_URL}/list_optimizations?catalog_version=${version}`);
          if (listRes.ok) {
            const listData = await listRes.json();
            for (const opt of (listData.optimizations || [])) {
              await fetch(`${CLOUD_FUNCTION_URL}/delete_optimize/${opt.optimization_id}`, { method: "DELETE" });
            }
          }
          const res = await fetch(`${CLOUD_FUNCTION_URL}/delete_catalog/${version}`, { method: "DELETE" });
          if (res.ok) {
            await deps.fetchCatalogList();
            if (deps.selectedCatalogVersion === version) {
              deps.setSelectedCatalogVersion(""); deps.setOptimizationState(null); deps.setOptimizationId(null);
            }
            setAgentChatMessages((prev) => {
              const idx = prev.findIndex((m) => m.id === deleteProgressId);
              const doneMsg = { id: `${Date.now()}-sys`, role: "agent" as const, text: "Done. Profile and associated programs deleted.", submittedAt: formatChatTimestamp(new Date()) };
              if (idx >= 0) { const copy = [...prev]; copy[idx] = { ...prev[idx], ...doneMsg }; return copy; }
              return [...prev, doneMsg];
            });
          } else {
            setAgentChatMessages((prev) => {
              const idx = prev.findIndex((m) => m.id === deleteProgressId);
              const failMsg = { id: `${Date.now()}-sys`, role: "agent" as const, text: "Failed to delete profile.", submittedAt: formatChatTimestamp(new Date()) };
              if (idx >= 0) { const copy = [...prev]; copy[idx] = { ...prev[idx], ...failMsg }; return copy; }
              return [...prev, failMsg];
            });
          }
        } catch {
          setAgentChatMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === deleteProgressId);
            const errMsg = { id: `${Date.now()}-sys`, role: "agent" as const, text: "Error deleting profile.", submittedAt: formatChatTimestamp(new Date()) };
            if (idx >= 0) { const copy = [...prev]; copy[idx] = { ...prev[idx], ...errMsg }; return copy; }
            return [...prev, errMsg];
          });
        } finally {
          deps.setPendingDeleteCatalog(null); setAgentChatLoading(false);
        }
      } else if (action.type === "cancel_delete_profile") {
        deps.setPendingDeleteCatalog(null);
      } else if (action.type === "fork_profile") {
        const version = action.version || "";
        if (!version) continue;
        try {
          const res = await fetch(`${CLOUD_FUNCTION_URL}/fork_catalog`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ source_version: version }),
          });
          if (res.ok) {
            const data = await res.json();
            await deps.fetchCatalogList();
            if (data.version) { deps.setSelectedCatalogVersion(data.version); deps.loadCatalog(data.version); }
            setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: `Profile duplicated. New version: ${data.version || "unknown"}.`, submittedAt: formatChatTimestamp(new Date()) }]);
          } else {
            const errData = await res.json().catch(() => ({}));
            setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: `Failed to duplicate profile: ${errData.error || res.statusText}`, submittedAt: formatChatTimestamp(new Date()) }]);
          }
        } catch (e: unknown) {
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: `Error duplicating profile: ${e instanceof Error ? e.message : "unknown error"}`, submittedAt: formatChatTimestamp(new Date()) }]);
        }
      } else if (action.type === "list_programs") {
        const programs = deps.savedOptimizations || [];
        let listText: string;
        if (programs.length === 0) { listText = "No programs found for the current context."; }
        else {
          const lines = programs.map((exp: ApiRecord, i: number) => {
            const totalLift = exp.total_lift ?? (Array.isArray(exp.results) ? (exp.results as ApiRecord[]).reduce((s: number, r: ApiRecord) => s + (Number(r.lift) || 0), 0) : null);
            const profileCount = exp.result_count || (Array.isArray(exp.results) ? exp.results.length : 0);
            const date = exp.completed_at || exp.started_at || "";
            const dateStr = date ? new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) + " " + new Date(date).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "—";
            const status = (exp.status || "unknown").toLowerCase();
            const liftStr = totalLift != null ? `+$${Math.round(totalLift).toLocaleString("en-US")}` : "—";
            return `${i + 1}. ${dateStr} · ${profileCount} profiles · lift: ${liftStr} · ${status}`;
          });
          listText = lines.join("\n");
        }
        setAgentChatMessages((prev) => {
          const copy = [...prev];
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i].role === "agent") { copy[i] = { ...copy[i], text: copy[i].text + "\n\n" + listText }; return copy; }
          }
          return [...copy, { id: `${Date.now()}-sys`, role: "agent", text: listText, submittedAt: formatChatTimestamp(new Date()) }];
        });
      } else if (action.type === "delete_program") {
        const optId = action.optimization_id || "";
        if (!optId) continue;
        try {
          setAgentChatLoading(true);
          const delProgressId = `${Date.now()}-delprog`;
          setAgentChatMessages((prev) => [...prev, { id: delProgressId, role: "agent", text: "Deleting program...", submittedAt: formatChatTimestamp(new Date()) }]);
          await fetch(`${CLOUD_FUNCTION_URL}/delete_optimize/${optId}`, { method: "DELETE" });
          if (deps.optimizationId === optId) { deps.setOptimizationState(null); deps.setOptimizationId(null); deps.setSelectedSavedOptimizationId(null); }
          delete deps.optimizationCacheRef.current[optId];
          await deps.fetchSavedOptimizations(deps.selectedCatalogVersion || undefined);
          setAgentChatMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === delProgressId);
            const doneMsg = { id: `${Date.now()}-sys`, role: "agent" as const, text: "Done. Program deleted.", submittedAt: formatChatTimestamp(new Date()) };
            if (idx >= 0) { const copy = [...prev]; copy[idx] = { ...prev[idx], ...doneMsg }; return copy; }
            return [...prev, doneMsg];
          });
        } catch (e: unknown) {
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: `Failed to delete program: ${e instanceof Error ? e.message : "unknown error"}`, submittedAt: formatChatTimestamp(new Date()) }]);
        } finally { setAgentChatLoading(false); }
      } else if (action.type === "run_optimization") {
        if (!deps.selectedCatalogVersion) {
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: "No profile selected. Please select a profile first.", submittedAt: formatChatTimestamp(new Date()) }]);
          continue;
        }
        if (deps.optimizeInProgress || deps.learnInProgress) {
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: "Another operation is already in progress. Please wait for it to complete.", submittedAt: formatChatTimestamp(new Date()) }]);
          continue;
        }
        const catVersion = action.catalog_version || deps.selectedCatalogVersion;
        const incVersion = action.incentive_set_version || deps.selectedIncentiveSetVersion || undefined;
        try {
          setAgentChatLoading(true);
          deps.setOptimizeInProgress(true);
          deps.setOptimizationState(null); deps.setOptimizationId(null);
          deps.setShowOptimizationProgress(true); deps.setGenError("");
          deps.optimizationStopRequestedRef.current = false;
          const res = await fetch(`${CLOUD_FUNCTION_URL}/start_optimize`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              catalog_version: catVersion,
              incentive_set_version: incVersion,
              engine: "monte_carlo",
              ...(action.budget != null ? { budget: Number(action.budget) } : {}),
              ...(action.target_ltv != null ? { target_ltv: Number(action.target_ltv) } : {}),
            }),
          });
          if (!res.ok) { const errData = await res.json().catch(() => ({})); throw new Error(errData.error || "Failed to start optimization"); }
          const data = await res.json();
          const optId = String(data?.optimization_id || data?.experiment_id || "");
          if (!optId) throw new Error("Missing optimization_id");
          deps.setOptimizationId(optId);
          deps.setSelectedSavedOptimizationId(optId);
          // MC results arrive synchronously
          if (data?.engine === "monte_carlo") {
            deps.optimizationCacheRef.current[optId] = data;
            deps.setOptimizationState(data);
            deps.setOptimizeInProgress(false);
            deps.setShowOptimizationProgress(false);
            agentOptDoneRef.current = true;
            const profileCount = (data.results || []).length;
            const totalLift = data.total_lift != null ? `$${Math.round(data.total_lift).toLocaleString()}` : "";
            const totalCost = data.total_cost != null ? `$${Math.round(data.total_cost).toLocaleString()}` : "";
            const warnLines = (data.warnings || []).map((w: string) => `\n${w}`).join("");
            setAgentChatMessages((prev) => {
              const copy = [...prev];
              for (let i = copy.length - 1; i >= 0; i--) {
                if (copy[i].role === "agent") {
                  copy[i] = { ...copy[i], id: `opt-done-${Date.now()}`, text: `Optimization complete.\nProfiles: ${profileCount}\nLift: ${totalLift}\nCost: ${totalCost}${warnLines}` };
                  return copy;
                }
              }
              return copy;
            });
          } else {
            deps.setOptimizationPolling(true);
            agentOptLastStep.current = "";
            agentOptDoneRef.current = false;
            setAgentChatMessages((prev) => {
              const copy = [...prev];
              for (let i = copy.length - 1; i >= 0; i--) {
                if (copy[i].role === "agent") { copy[i] = { ...copy[i], id: "opt-progress", text: "Starting optimization..." }; return copy; }
              }
              return [...copy, { id: "opt-progress", role: "agent", text: "Starting optimization...", submittedAt: formatChatTimestamp(new Date()) }];
            });
          }
        } catch (e: unknown) {
          deps.setOptimizeInProgress(false); deps.setShowOptimizationProgress(false);
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: `Failed to start optimization: ${e instanceof Error ? e.message : "unknown error"}`, submittedAt: formatChatTimestamp(new Date()) }]);
        } finally { setAgentChatLoading(false); }
      } else if (action.type === "list_incentive_sets") {
        const sets = deps.incentiveSets || [];
        let listText: string;
        if (sets.length === 0) { listText = "No incentive sets found."; }
        else {
          const lines = sets.map((s: ApiRecord, i: number) => {
            const defaultTag = s.is_default ? " (default)" : "";
            return `${i + 1}. ${s.name || s.version} · ${s.incentive_count || 0} incentives${defaultTag}`;
          });
          listText = lines.join("\n");
        }
        setAgentChatMessages((prev) => {
          const copy = [...prev];
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i].role === "agent") { copy[i] = { ...copy[i], text: copy[i].text + "\n\n" + listText }; return copy; }
          }
          return [...copy, { id: `${Date.now()}-sys`, role: "agent", text: listText, submittedAt: formatChatTimestamp(new Date()) }];
        });
      } else if (action.type === "create_incentive_set") {
        const name = action.name || ""; const description = action.description || ""; const incentives = action.incentives || [];
        const setAsDefault = action.set_as_default || false;
        if (!incentives.length) { setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: "Cannot create an incentive set with no incentives.", submittedAt: formatChatTimestamp(new Date()) }]); continue; }
        try {
          setAgentChatLoading(true);
          const res = await fetch(`${CLOUD_FUNCTION_URL}/create_incentive_set`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, description, incentives, set_as_default: setAsDefault }),
          });
          if (res.ok) {
            const data = await res.json();
            await deps.fetchIncentiveSets();
            if (data.version) { deps.setSelectedIncentiveSetVersion(data.version); deps.loadIncentiveSetDetail(data.version); }
            setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: `Incentive set "${name || data.version}" created with ${incentives.length} incentives.`, submittedAt: formatChatTimestamp(new Date()) }]);
          } else {
            const errData = await res.json().catch(() => ({}));
            setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: `Failed to create incentive set: ${errData.error || res.statusText}`, submittedAt: formatChatTimestamp(new Date()) }]);
          }
        } catch (e: unknown) {
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: `Error creating incentive set: ${e instanceof Error ? e.message : "unknown error"}`, submittedAt: formatChatTimestamp(new Date()) }]);
        } finally { setAgentChatLoading(false); }
      } else if (action.type === "update_incentive_set") {
        const version = action.version || "";
        if (!version) continue;
        try {
          setAgentChatLoading(true);
          const body: ApiRecord = {};
          if (action.name !== undefined) body.name = action.name;
          if (action.description !== undefined) body.description = action.description;
          if (action.incentives !== undefined) body.incentives = action.incentives;
          const res = await fetch(`${CLOUD_FUNCTION_URL}/update_incentive_set/${version}`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
          });
          if (res.ok) {
            await deps.fetchIncentiveSets();
            if (deps.selectedIncentiveSetVersion === version) deps.loadIncentiveSetDetail(version);
            setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: "Incentive set updated.", submittedAt: formatChatTimestamp(new Date()) }]);
          } else {
            const errData = await res.json().catch(() => ({}));
            if (res.status === 409) {
              setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: `Cannot update: this incentive set has been used to generate ${errData.optimization_count || "one or more"} incentive program(s). Create a new incentive set instead.`, submittedAt: formatChatTimestamp(new Date()) }]);
            } else {
              setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: `Failed to update incentive set: ${errData.error || res.statusText}`, submittedAt: formatChatTimestamp(new Date()) }]);
            }
          }
        } catch (e: unknown) {
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: `Error updating incentive set: ${e instanceof Error ? e.message : "unknown error"}`, submittedAt: formatChatTimestamp(new Date()) }]);
        } finally { setAgentChatLoading(false); }
      } else if (action.type === "request_delete_incentive_set") {
        const version = action.version || "";
        if (!version) continue;
        try {
          const usageRes = await fetch(`${CLOUD_FUNCTION_URL}/check_incentive_set_usage/${version}`);
          if (usageRes.ok) {
            const usageData = await usageRes.json();
            const count = usageData.optimization_count || 0;
            if (count > 0) {
              deps.setPendingDeleteIncentiveSet(version);
              const setName = deps.incentiveSets.find((s: ApiRecord) => s.version === version)?.name || version.slice(0, 12);
              setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: `⚠ Are you sure you want to delete incentive set "${setName}"? This will also permanently delete ${count} incentive program(s) that were generated from it. Reply yes to confirm or no to cancel.`, submittedAt: formatChatTimestamp(new Date()) }]);
              continue;
            }
          }
        } catch { /* fall through */ }
        deps.setPendingDeleteIncentiveSet(version);
      } else if (action.type === "confirm_delete_incentive_set") {
        const version = deps.pendingDeleteIncentiveSetRef.current || action.version || "";
        if (!version) continue;
        try {
          setAgentChatLoading(true);
          const delProgressId = `${Date.now()}-del-is`;
          setAgentChatMessages((prev) => [...prev, { id: delProgressId, role: "agent", text: `Deleting incentive set ${version.slice(0, 12)} and associated programs...`, submittedAt: formatChatTimestamp(new Date()) }]);
          const res = await fetch(`${CLOUD_FUNCTION_URL}/delete_incentive_set/${version}`, { method: "DELETE" });
          if (res.ok) {
            const data = await res.json().catch(() => ({}));
            const deletedPrograms = data.deleted_optimizations || 0;
            await deps.fetchIncentiveSets();
            if (deps.selectedIncentiveSetVersion === version) { deps.setSelectedIncentiveSetVersion(""); deps.setSelectedIncentiveSetDetail(null); }
            const doneText = deletedPrograms > 0 ? `Done. Incentive set deleted along with ${deletedPrograms} incentive program(s).` : "Done. Incentive set deleted.";
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
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: "Error deleting incentive set.", submittedAt: formatChatTimestamp(new Date()) }]);
        } finally { deps.setPendingDeleteIncentiveSet(null); setAgentChatLoading(false); }
      } else if (action.type === "cancel_delete_incentive_set") {
        deps.setPendingDeleteIncentiveSet(null);
      } else if (action.type === "set_default_incentive_set") {
        const version = action.version || "";
        if (!version) continue;
        try {
          setAgentChatLoading(true);
          const res = await fetch(`${CLOUD_FUNCTION_URL}/set_default_incentive_set/${version}`, { method: "POST" });
          if (res.ok) {
            await deps.fetchIncentiveSets();
            setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: `Incentive set ${version.slice(0, 12)} set as default.`, submittedAt: formatChatTimestamp(new Date()) }]);
          } else {
            const errData = await res.json().catch(() => ({}));
            setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: `Failed to set default: ${errData.error || res.statusText}`, submittedAt: formatChatTimestamp(new Date()) }]);
          }
        } catch (e: unknown) {
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: `Error setting default: ${e instanceof Error ? e.message : "unknown error"}`, submittedAt: formatChatTimestamp(new Date()) }]);
        } finally { setAgentChatLoading(false); }
      } else if (action.type === "list_workflows") {
        try {
          setAgentChatLoading(true);
          const res = await fetch(`${CLOUD_FUNCTION_URL}/list_workflows`);
          const userWfs = res.ok ? (await res.json()).workflows || [] : [];
          deps.setWorkflows(userWfs);
          const allWfs = [
            { name: "Optimize portfolio", description: "Learn behavioral profiles from transaction data using clustering, then derive optimal incentive program through simulation.", type: "built-in" },
            ...userWfs.map((w: ApiRecord) => ({ ...w, type: "custom" })),
          ];
          const lines = allWfs.map((w: ApiRecord, i: number) => {
            const tag = w.type === "built-in" ? "built-in" : "custom";
            const date = w.created_at ? new Date(w.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
            return `${i + 1}. ${w.name} — ${w.description || "(no description)"} [${tag}]${date ? ` · ${date}` : ""}`;
          });
          setAgentChatMessages((prev) => {
            const copy = [...prev];
            for (let i = copy.length - 1; i >= 0; i--) {
              if (copy[i].role === "agent") { copy[i] = { ...copy[i], text: copy[i].text + "\n\n" + lines.join("\n") }; return copy; }
            }
            return [...copy, { id: `${Date.now()}-sys`, role: "agent", text: lines.join("\n"), submittedAt: formatChatTimestamp(new Date()) }];
          });
        } catch { /* silent */ } finally { setAgentChatLoading(false); }
      } else if (action.type === "create_workflow") {
        const name = action.name || ""; const description = action.description || ""; const detail = action.detail || "";
        if (!name) continue;
        try {
          setAgentChatLoading(true);
          const res = await fetch(`${CLOUD_FUNCTION_URL}/create_workflow`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, description, detail }),
          });
          if (res.ok) {
            const wf = await res.json();
            await deps.fetchWorkflows();
            setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: `Workflow "${wf.name}" created.`, submittedAt: formatChatTimestamp(new Date()) }]);
          } else {
            const errData = await res.json().catch(() => ({}));
            setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: `Failed to create workflow: ${errData.error || res.statusText}`, submittedAt: formatChatTimestamp(new Date()) }]);
          }
        } catch (e: unknown) {
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: `Error creating workflow: ${e instanceof Error ? e.message : "unknown error"}`, submittedAt: formatChatTimestamp(new Date()) }]);
        } finally { setAgentChatLoading(false); }
      } else if (action.type === "update_workflow") {
        const wfId = action.workflow_id || "";
        if (!wfId) continue;
        if (wfId.startsWith("builtin-")) {
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: "Built-in workflows cannot be modified.", submittedAt: formatChatTimestamp(new Date()) }]);
          continue;
        }
        try {
          setAgentChatLoading(true);
          const body: ApiRecord = {};
          if (action.name) body.name = action.name;
          if (action.description !== undefined) body.description = action.description;
          if (action.detail !== undefined) body.detail = action.detail;
          const res = await fetch(`${CLOUD_FUNCTION_URL}/update_workflow/${wfId}`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
          });
          if (res.ok) {
            await deps.fetchWorkflows();
            setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: "Workflow updated.", submittedAt: formatChatTimestamp(new Date()) }]);
          } else {
            const errData = await res.json().catch(() => ({}));
            setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: `Failed to update workflow: ${errData.error || res.statusText}`, submittedAt: formatChatTimestamp(new Date()) }]);
          }
        } catch (e: unknown) {
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: `Error updating workflow: ${e instanceof Error ? e.message : "unknown error"}`, submittedAt: formatChatTimestamp(new Date()) }]);
        } finally { setAgentChatLoading(false); }
      } else if (action.type === "request_delete_workflow") {
        const wfId = action.workflow_id || "";
        if (!wfId) continue;
        if (wfId.startsWith("builtin-")) {
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: "Built-in workflows cannot be deleted.", submittedAt: formatChatTimestamp(new Date()) }]);
          continue;
        }
        deps.setPendingDeleteWorkflow(wfId);
      } else if (action.type === "confirm_delete_workflow") {
        const wfId = deps.pendingDeleteWorkflowRef.current || action.workflow_id || "";
        if (!wfId) continue;
        try {
          setAgentChatLoading(true);
          const res = await fetch(`${CLOUD_FUNCTION_URL}/delete_workflow/${wfId}`, { method: "DELETE" });
          if (res.ok) { await deps.fetchWorkflows(); setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: "Workflow deleted.", submittedAt: formatChatTimestamp(new Date()) }]); }
          else { setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: "Failed to delete workflow.", submittedAt: formatChatTimestamp(new Date()) }]); }
        } catch { setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-sys`, role: "agent", text: "Error deleting workflow.", submittedAt: formatChatTimestamp(new Date()) }]); }
        finally { deps.setPendingDeleteWorkflow(null); setAgentChatLoading(false); }
      } else if (action.type === "cancel_delete_workflow") {
        deps.setPendingDeleteWorkflow(null);
      } else if (action.type === "save_report_config") {
        const configName = action.name || "Untitled Report";
        const columns = (gridCustomColumns || []).map((c) => ({
          label: c.label, exprSource: c.exprSource, format: c.format, totalsExpr: c.totalsExpr,
        }));
        setAgentChatMessages((prev) => [...prev, {
          id: `${Date.now()}-sys`, role: "agent",
          text: `Report configuration "${configName}" saved with ${columns.length} custom column(s).`,
          submittedAt: formatChatTimestamp(new Date()),
        }]);
      } else if (action.type === "load_report_config") {
        setAgentChatMessages((prev) => [...prev, {
          id: `${Date.now()}-sys`, role: "agent",
          text: `Report configuration loaded.`,
          submittedAt: formatChatTimestamp(new Date()),
        }]);
      } else if (action.type === "update_chart_config" || action.type === "update_layout") {
        setAgentChatMessages((prev) => [...prev, {
          id: `${Date.now()}-sys`, role: "agent",
          text: `View updated.`,
          submittedAt: formatChatTimestamp(new Date()),
        }]);
      }
    }
  }, [deps, gridCustomColumns]);

  const submitAgentChat = useCallback(async () => {
    const next = agentChatDraft.trim();
    const inWorkflowFlow = Boolean(deps.pendingCreateWorkflowRef.current || deps.pendingWorkflowActionRef.current || deps.pendingEditWorkflowRef.current);
    if (agentChatLoading) return;
    if (!next && !inWorkflowFlow) return;
    const ts = formatChatTimestamp(new Date());
    const userMsg: ChatMessage = { id: `${Date.now()}-u`, role: "user", text: next, submittedAt: ts };
    setAgentChatMessages((prev) => [...prev, userMsg]);
    setAgentChatDraft("");

    const YES_RE = /^(y|yes|yep|yeah|yea|confirm|sure|ok|okay|do it|go ahead)$/i;
    const NO_RE = /^(n|no|nope|nah|cancel|never\s*mind|abort)$/i;

    // Handle pending delete confirmations
    if (deps.pendingDeleteCatalogRef.current) {
      const lower = next.toLowerCase();
      if (YES_RE.test(lower)) { await executeAgentActions([{ type: "confirm_delete_profile" }]); return; }
      else if (NO_RE.test(lower)) { await executeAgentActions([{ type: "cancel_delete_profile" }]); setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent", text: "Deletion cancelled.", submittedAt: formatChatTimestamp(new Date()) }]); return; }
    }
    if (deps.pendingDeleteIncentiveSetRef.current) {
      const lower = next.toLowerCase();
      if (YES_RE.test(lower)) { await executeAgentActions([{ type: "confirm_delete_incentive_set" }]); return; }
      else if (NO_RE.test(lower)) { await executeAgentActions([{ type: "cancel_delete_incentive_set" }]); setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent", text: "Deletion cancelled.", submittedAt: formatChatTimestamp(new Date()) }]); return; }
    }
    if (deps.pendingDeleteWorkflowRef.current) {
      const lower = next.toLowerCase();
      if (YES_RE.test(lower)) { await executeAgentActions([{ type: "confirm_delete_workflow" }]); return; }
      else if (NO_RE.test(lower)) { await executeAgentActions([{ type: "cancel_delete_workflow" }]); setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent", text: "Deletion cancelled.", submittedAt: formatChatTimestamp(new Date()) }]); return; }
    }

    // Workflow CRUD interception
    const WORKFLOW_CREATE_RE = /^(create|add|new|make)\s+(a\s+)?(new\s+)?(custom\s+)?workflow$/i;
    const WORKFLOW_CREATE_NAMED_RE = /^(create|add|new|make)\s+(a\s+)?(new\s+)?(custom\s+)?workflow\s+(?:called|named|:)?\s*(.+)$/i;
    const WORKFLOW_LIST_RE = /^(list|show|my)\s+workflows?$/i;
    const lower = next.toLowerCase().trim();

    // Handle pending create-workflow conversation
    if (deps.pendingCreateWorkflowRef.current) {
      const pending = deps.pendingCreateWorkflowRef.current;
      if (pending.step === "awaiting_name") {
        const name = next.trim();
        if (!name) { setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent", text: "Please provide a name for the workflow.", submittedAt: formatChatTimestamp(new Date()) }]); return; }
        deps.setPendingCreateWorkflow({ step: "awaiting_description", name });
        setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent", text: `Workflow name: "${name}". Provide a description (or press Enter to skip).`, submittedAt: formatChatTimestamp(new Date()) }]);
        return;
      }
      if (pending.step === "awaiting_description") {
        const desc = (!next.trim() || /^(skip|none|no|-|n\/a)$/i.test(next.trim())) ? "" : next.trim();
        deps.setPendingCreateWorkflow({ step: "awaiting_detail", name: pending.name, description: desc });
        setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent", text: "Provide detail for the workflow — this is the context the Agent uses to compose the UI when the card is clicked (or press Enter to skip).", submittedAt: formatChatTimestamp(new Date()) }]);
        return;
      }
      if (pending.step === "awaiting_detail") {
        const detail = (!next.trim() || /^(skip|none|no|-|n\/a)$/i.test(next.trim())) ? "" : next.trim();
        deps.setPendingCreateWorkflow(null);
        await executeAgentActions([{ type: "create_workflow", name: pending.name, description: pending.description, detail }]);
        return;
      }
    }

    // Handle pending workflow action selection
    if (deps.pendingWorkflowActionRef.current) {
      const pending = deps.pendingWorkflowActionRef.current;
      const num = parseInt(next.trim(), 10);
      if (num >= 1 && num <= pending.candidates.length) {
        const selected = pending.candidates[num - 1];
        deps.setPendingWorkflowAction(null);
        if (pending.action === "edit") {
          deps.setPendingCreateWorkflow({ step: "awaiting_name" });
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent", text: `Editing "${selected.name}". Enter new name (or press Enter to keep current):`, submittedAt: formatChatTimestamp(new Date()) }]);
          deps.pendingWorkflowActionRef.current = { action: "edit", candidates: [selected] };
          return;
        } else if (pending.action === "delete") {
          deps.setPendingDeleteWorkflow(selected.workflow_id);
          setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent", text: `Delete workflow "${selected.name}"? Type "yes" to confirm or "no" to cancel.`, submittedAt: formatChatTimestamp(new Date()) }]);
          return;
        }
      } else if (/^(cancel|back|never\s*mind|abort)$/i.test(next.trim())) {
        deps.setPendingWorkflowAction(null);
        setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent", text: "Cancelled.", submittedAt: formatChatTimestamp(new Date()) }]);
        return;
      }
      if (pending.action === "edit" && pending.candidates.length === 1) {
        const selected = pending.candidates[0];
        const newName = (!next.trim() || /^(skip|none|no|-|n\/a)$/i.test(next.trim())) ? undefined : next.trim();
        deps.setPendingWorkflowAction(null);
        setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-edit`, role: "agent", text: "Enter new description (or press Enter to keep current):", submittedAt: formatChatTimestamp(new Date()) }]);
        deps.setPendingEditWorkflow({ workflow_id: selected.workflow_id, name: newName, step: "awaiting_description" });
        return;
      }
      setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent", text: `Please enter a number between 1 and ${pending.candidates.length}, or "cancel".`, submittedAt: formatChatTimestamp(new Date()) }]);
      return;
    }

    // Handle multi-step edit workflow
    if (deps.pendingEditWorkflowRef.current) {
      const pe = deps.pendingEditWorkflowRef.current;
      const skip = (!next.trim() || /^(skip|none|no|-|n\/a)$/i.test(next.trim()));
      if (pe.step === "awaiting_description") {
        const newDesc = skip ? undefined : next.trim();
        deps.setPendingEditWorkflow({ ...pe, description: newDesc, step: "awaiting_detail" });
        setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent", text: "Enter new detail (or press Enter to keep current):", submittedAt: formatChatTimestamp(new Date()) }]);
        return;
      }
      if (pe.step === "awaiting_detail") {
        const newDetail = skip ? undefined : next.trim();
        deps.setPendingEditWorkflow(null);
        const body: ApiRecord = {};
        if (pe.name !== undefined) body.name = pe.name;
        if (pe.description !== undefined) body.description = pe.description;
        if (newDetail !== undefined) body.detail = newDetail;
        await executeAgentActions([{ type: "update_workflow", workflow_id: pe.workflow_id, ...body }]);
        return;
      }
    }

    // Detect create/edit/delete/list workflow commands
    const namedMatch = next.match(WORKFLOW_CREATE_NAMED_RE);
    if (namedMatch) {
      deps.setPendingCreateWorkflow({ step: "awaiting_description", name: namedMatch[5].trim() });
      setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent", text: `Workflow name: "${namedMatch[5].trim()}". Provide a description (or press Enter to skip).`, submittedAt: formatChatTimestamp(new Date()) }]);
      return;
    }
    if (WORKFLOW_CREATE_RE.test(lower)) {
      deps.setPendingCreateWorkflow({ step: "awaiting_name" });
      setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent", text: "What would you like to name the new workflow?", submittedAt: formatChatTimestamp(new Date()) }]);
      return;
    }

    const WORKFLOW_EDIT_RE = /^(edit|update|modify|rename)\s+(a\s+)?(custom\s+)?workflow(\s+(\d+))?$/i;
    const WORKFLOW_EDIT_N_RE = /^(edit|update|modify|rename)\s+(\d+)$/i;
    const editMatch = next.match(WORKFLOW_EDIT_RE) || next.match(WORKFLOW_EDIT_N_RE);
    if (editMatch) {
      const customWfs = (deps.workflows as ApiRecord[]).filter((w) => w.workflow_id && !String(w.workflow_id).startsWith("builtin-"));
      if (customWfs.length === 0) { setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent", text: "No custom workflows to edit. Create one first.", submittedAt: formatChatTimestamp(new Date()) }]); return; }
      const numStr = editMatch[5] || editMatch[2];
      const num = numStr ? parseInt(numStr, 10) : NaN;
      if (num >= 1 && num <= customWfs.length) {
        const selected = customWfs[num - 1];
        deps.setPendingWorkflowAction({ action: "edit", candidates: [selected] });
        setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent", text: `Editing "${selected.name}". Enter new name (or press Enter to keep current):`, submittedAt: formatChatTimestamp(new Date()) }]);
        return;
      }
      deps.setPendingWorkflowAction({ action: "edit", candidates: customWfs });
      const lines = customWfs.map((w: ApiRecord, i: number) => `${i + 1}. ${w.name}${w.description ? ` — ${w.description}` : ""}`);
      setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent", text: `Which workflow to edit?\n\n${lines.join("\n")}`, submittedAt: formatChatTimestamp(new Date()) }]);
      return;
    }

    const WORKFLOW_DELETE_RE = /^(delete|remove)\s+(a\s+)?(custom\s+)?workflow(\s+(\d+))?$/i;
    const WORKFLOW_DELETE_N_RE = /^(delete|remove)\s+(\d+)$/i;
    const deleteMatch = next.match(WORKFLOW_DELETE_RE) || next.match(WORKFLOW_DELETE_N_RE);
    if (deleteMatch) {
      const customWfs = (deps.workflows as ApiRecord[]).filter((w) => w.workflow_id && !String(w.workflow_id).startsWith("builtin-"));
      if (customWfs.length === 0) { setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent", text: "No custom workflows to delete.", submittedAt: formatChatTimestamp(new Date()) }]); return; }
      const numStr = deleteMatch[5] || deleteMatch[2];
      const num = numStr ? parseInt(numStr, 10) : NaN;
      if (num >= 1 && num <= customWfs.length) {
        const selected = customWfs[num - 1];
        deps.setPendingDeleteWorkflow(selected.workflow_id);
        setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent", text: `Delete workflow "${selected.name}"? Type "yes" to confirm or "no" to cancel.`, submittedAt: formatChatTimestamp(new Date()) }]);
        return;
      }
      deps.setPendingWorkflowAction({ action: "delete", candidates: customWfs });
      const lines = customWfs.map((w: ApiRecord, i: number) => `${i + 1}. ${w.name}${w.description ? ` — ${w.description}` : ""}`);
      setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent", text: `Which workflow to delete?\n\n${lines.join("\n")}`, submittedAt: formatChatTimestamp(new Date()) }]);
      return;
    }

    if (WORKFLOW_LIST_RE.test(lower)) {
      setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent", text: "Available workflows:", submittedAt: formatChatTimestamp(new Date()) }]);
      await executeAgentActions([{ type: "list_workflows" }]);
      return;
    }

    // Non-actionable: handle locally
    const lastMsg = agentChatMessages[agentChatMessages.length - 1];
    const agentJustAsked = lastMsg?.role === "agent";
    if (!agentJustAsked && !deps.pendingDeleteCatalogRef.current && !deps.pendingDeleteIncentiveSetRef.current && !deps.pendingDeleteWorkflowRef.current && (GREETING_RE.test(next) || isGibberish(next))) {
      const kind = GREETING_RE.test(next) ? "greeting" : "gibberish";
      setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent", text: pickCanned(kind), submittedAt: formatChatTimestamp(new Date()) }]);
      return;
    }

    // Ensure incentive set detail is loaded and matches selected version
    let freshIncentiveSetDetail: ApiRecord | null = null;
    const detailMismatch = deps.selectedIncentiveSetDetail && deps.selectedIncentiveSetVersion && deps.selectedIncentiveSetDetail.version !== deps.selectedIncentiveSetVersion;
    if ((!deps.selectedIncentiveSetDetail || detailMismatch) && (deps.selectedIncentiveSetVersion || deps.incentiveSets.length > 0)) {
      const versionToLoad = deps.selectedIncentiveSetVersion || deps.incentiveSets.find((s: ApiRecord) => s.is_default)?.version || deps.incentiveSets[0]?.version;
      if (versionToLoad) {
        try {
          const url = `${CLOUD_FUNCTION_URL}/incentive_set/${versionToLoad}`;
          const detailRes = await fetch(url);
          if (detailRes.ok) { freshIncentiveSetDetail = await detailRes.json(); deps.setSelectedIncentiveSetDetail(freshIncentiveSetDetail); }
        } catch { /* proceed without detail */ }
      }
    }

    // Route to backend
    setAgentChatLoading(true);
    try {
      const body: ApiRecord = { message: next };
      body.grid_context = buildGridContext(freshIncentiveSetDetail ? { incentiveSetDetail: freshIncentiveSetDetail } : undefined);
      const recentHistory = agentChatMessages.slice(-20).map((m) => ({ role: m.role === "user" ? "user" : "agent", text: m.text }));
      if (recentHistory.length > 0) body.history = recentHistory;
      const res = await fetch(`${CLOUD_FUNCTION_URL}/agent_chat`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json();
      const reply: ChatMessage = { id: `${Date.now()}-a`, role: "agent", text: data.answer ?? data.error ?? "Something went wrong.", submittedAt: formatChatTimestamp(new Date()) };
      setAgentChatMessages((prev) => [...prev, reply]);
      if (Array.isArray(data.actions) && data.actions.length > 0) {
        await executeAgentActions(data.actions);
      }
    } catch {
      setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-a`, role: "agent", text: "Connection error. Please try again.", submittedAt: formatChatTimestamp(new Date()) }]);
    } finally { setAgentChatLoading(false); }
  }, [agentChatDraft, agentChatLoading, agentChatMessages, buildGridContext, executeAgentActions, deps]);

  const handleAgentStop = useCallback(async () => {
    if (agentStoppingRef.current) return;
    agentStoppingRef.current = true;
    if (deps.optimizeInProgress) {
      agentOptDoneRef.current = true;
      deps.optimizationStopRequestedRef.current = true;
      agentOptLastStep.current = "";
      deps.setOptimizationPolling(false);
      deps.setOptimizeInProgress(false);
      const optId = deps.optimizationId;
      deps.setOptimizationState(null); deps.setOptimizationId(null);
      deps.setSelectedSavedOptimizationId(null); deps.setShowOptimizationProgress(false);
      deps.setOptimizationStopPhase("idle"); deps.setGenLoading(false); deps.setOptimizationStarting(false);
      if (optId) {
        delete deps.optimizationCacheRef.current[optId];
        (async () => {
          try {
            await fetch(`${CLOUD_FUNCTION_URL}/cancel_optimize/${optId}`, { method: "POST" }).catch(() => {});
            await fetch(`${CLOUD_FUNCTION_URL}/delete_optimize/${optId}`, { method: "DELETE" }).catch(() => {});
          } finally {
            delete deps.optimizationCacheRef.current[optId];
            await deps.fetchSavedOptimizations(deps.selectedCatalogVersion || undefined);
          }
        })();
      }
      const stoppedId = `${Date.now()}-stopped`;
      setAgentChatMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === "opt-progress");
        if (idx >= 0) { const copy = [...prev]; copy[idx] = { ...copy[idx], id: stoppedId, text: "Optimization stopped.", submittedAt: formatChatTimestamp(new Date()) }; return copy; }
        return [...prev, { id: stoppedId, role: "agent" as const, text: "Optimization stopped.", submittedAt: formatChatTimestamp(new Date()) }];
      });
    } else if (deps.learnInProgress) {
      if (agentLearnAbortRef.current) { agentLearnAbortRef.current.abort(); agentLearnAbortRef.current = null; }
      deps.setLearnInProgress(false);
      setAgentChatLoading(false);
      setAgentChatMessages((prev) => [...prev, { id: `${Date.now()}-stopped`, role: "agent" as const, text: "Profile creation stopped.", submittedAt: formatChatTimestamp(new Date()) }]);
    }
    agentStoppingRef.current = false;
  }, [deps]);

  return {
    agentChatDraft, setAgentChatDraft,
    agentChatMessages, setAgentChatMessages,
    agentChatLoading,
    gridCustomColumns,
    agentOptLastStep, agentOptDoneRef,
    agentChatScrollRef,
    submitAgentChat, handleAgentStop,
    executeAgentActions, buildGridContext,
  };
}
