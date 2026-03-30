import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWorkflows } from "@/app/hooks/useWorkflows";

const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

describe("useWorkflows", () => {
  it("initializes with empty workflows", () => {
    const { result } = renderHook(() => useWorkflows());
    expect(result.current.workflows).toEqual([]);
    expect(result.current.activeWorkflow).toBeNull();
  });

  it("fetches workflows", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        workflows: [
          { workflow_id: "wf_1", name: "Test", description: "A test workflow" },
        ],
      }),
    });

    const { result } = renderHook(() => useWorkflows());
    await act(async () => {
      await result.current.fetchWorkflows();
    });

    expect(result.current.workflows).toHaveLength(1);
    expect(result.current.workflows[0].name).toBe("Test");
  });

  it("sets active workflow", () => {
    const { result } = renderHook(() => useWorkflows());
    act(() => {
      result.current.setActiveWorkflow({ id: "wf_1", name: "Test", description: "Desc", detail: "Detail" });
    });
    expect(result.current.activeWorkflow?.name).toBe("Test");
  });

  it("clears active workflow", () => {
    const { result } = renderHook(() => useWorkflows());
    act(() => {
      result.current.setActiveWorkflow({ id: "wf_1", name: "Test", description: "", detail: "" });
    });
    act(() => {
      result.current.setActiveWorkflow(null);
    });
    expect(result.current.activeWorkflow).toBeNull();
  });
});
