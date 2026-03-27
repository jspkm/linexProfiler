// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ApiRecord is a deliberate safe-any wrapper for untyped API responses
export type ApiRecord = Record<string, any>;

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  submittedAt: string;
}

export interface GridCustomColumn {
  id: string;
  label: string;
  expr: (r: Record<string, number>) => number;
  exprSource: string;
  format: "dollar" | "percent" | "ratio" | "number";
  totalsExpr?: "sum" | "avg" | "weighted";
}

export type PendingCreateWorkflow =
  | { step: "awaiting_name" }
  | { step: "awaiting_description"; name: string }
  | { step: "awaiting_detail"; name: string; description: string }
  | null;

export type PendingWorkflowAction = {
  action: "edit" | "delete";
  candidates: ApiRecord[];
} | null;

export type PendingEdit = {
  workflow_id: string;
  name?: string;
  description?: string;
  step: "awaiting_description" | "awaiting_detail";
} | null;
