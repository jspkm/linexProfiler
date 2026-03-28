// Shared color palette and constants for the LINEX Terminal dark theme

export const C = {
  bg: "#050607",
  panel: "#0c0f0f",
  panelAlt: "#101514",
  surface: "#141a18",
  surfaceLt: "#1a211e",
  border: "#2e3432",
  borderLt: "#3d4542",
  text: "#edf3ef",
  textSec: "#b4c0b8",
  muted: "#7a8680",
  accent: "#66ff99",
  accentDim: "#3bb266",
  accentBg: "rgba(102,255,153,0.06)",
  danger: "#ff5d73",
  blue: "#5b9bff",
  amber: "#ffb347",
  amberBg: "rgba(255,179,71,0.08)",
} as const;

export const BEHAVIORAL_AXES: { axis: string; label: string; features: string[] }[] = [
  { axis: "activity_recency", label: "Activity Recency", features: ["recency_days", "active_months", "temporal_spread"] },
  { axis: "purchase_frequency", label: "Purchase Frequency", features: ["frequency_per_month", "transaction_count", "cadence_mean", "cadence_std"] },
  { axis: "spend_intensity", label: "Spend Intensity", features: ["total_spend", "avg_order_value", "max_order_value", "unique_products", "product_diversity"] },
  { axis: "refund_return", label: "Refund / Return", features: ["cancellation_rate", "cancellation_count"] },
];

export const PRIMARY_FEATURES = new Set(BEHAVIORAL_AXES.map(a => a.features[0]));

export type View = "terminal" | "profiler" | "workflow" | "dataroom";
export type ProfilerTab = "test" | "upload";

export const DEFAULT_LOCAL_API_BASE_URL = "http://127.0.0.1:5050/linexone-dev/us-central1";
export const CLOUD_FUNCTION_URL = (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_API_BASE_URL?.trim())
  || (typeof process !== "undefined" && process.env?.NODE_ENV === "development" ? DEFAULT_LOCAL_API_BASE_URL : "/api");
export const DATASETS_URL = `${CLOUD_FUNCTION_URL}/list_portfolio_datasets`;
export const OPTIMIZATION_CACHE_STORAGE_KEY = "linex.optimizationCache.v2";
