import { useState, useCallback } from "react";
import { CLOUD_FUNCTION_URL } from "@/lib/api";
import { useRefState } from "@/lib/useRefState";
import type { PendingCreateWorkflow, PendingWorkflowAction, PendingEdit } from "@/lib/types";
import type { Workflow } from "@/app/components/WorkflowCanvas";

export function useWorkflows() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [activeWorkflow, setActiveWorkflow] = useState<{ id: string; name: string; description: string; detail: string } | null>(null);

  const [pendingDeleteWorkflow, setPendingDeleteWorkflow, pendingDeleteWorkflowRef] = useRefState<string | null>(null);
  const [pendingCreateWorkflow, setPendingCreateWorkflow, pendingCreateWorkflowRef] = useRefState<PendingCreateWorkflow>(null);
  const [pendingWorkflowAction, setPendingWorkflowAction, pendingWorkflowActionRef] = useRefState<PendingWorkflowAction>(null);
  const [pendingEditWorkflow, setPendingEditWorkflow, pendingEditWorkflowRef] = useRefState<PendingEdit>(null);

  const fetchWorkflows = useCallback(async () => {
    try {
      const res = await fetch(`${CLOUD_FUNCTION_URL}/list_workflows`);
      if (res.ok) {
        const data = await res.json();
        setWorkflows(data.workflows || []);
      }
    } catch { /* silent */ }
  }, []);

  return {
    workflows, setWorkflows, fetchWorkflows,
    activeWorkflow, setActiveWorkflow,
    pendingDeleteWorkflow,
    pendingDeleteWorkflowRef, setPendingDeleteWorkflow,
    pendingCreateWorkflow, pendingCreateWorkflowRef, setPendingCreateWorkflow,
    pendingWorkflowAction, pendingWorkflowActionRef, setPendingWorkflowAction,
    pendingEditWorkflow, pendingEditWorkflowRef, setPendingEditWorkflow,
  };
}
