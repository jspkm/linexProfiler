import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOptimization } from "@/app/hooks/useOptimization";

const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
  localStorage.clear();
  sessionStorage.clear();
});

describe("useOptimization", () => {
  it("initializes with null state", () => {
    const { result } = renderHook(() => useOptimization());
    expect(result.current.optimizationId).toBeNull();
    expect(result.current.optimizationState).toBeNull();
    expect(result.current.optimizeInProgress).toBe(false);
    expect(result.current.optimizationPolling).toBe(false);
  });

  it("starts MC optimization and sets state synchronously", async () => {
    const mcResponse = {
      optimization_id: "mc_test123",
      engine: "monte_carlo",
      status: "completed",
      results: [{ profile_id: "P0", lift: 100 }],
      total_lift: 100,
    };
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mcResponse),
    });

    const setGenLoading = vi.fn();
    const setGenError = vi.fn();
    const { result } = renderHook(() => useOptimization());

    await act(async () => {
      await result.current.startOptimization("v1", "is_default", setGenLoading, setGenError);
    });

    expect(result.current.optimizationId).toBe("mc_test123");
    expect(result.current.optimizationState?.engine).toBe("monte_carlo");
    expect(result.current.optimizeInProgress).toBe(false); // MC completes synchronously
    expect(result.current.optimizationPolling).toBe(false);
  });

  it("handles start optimization error", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Catalog not found" }),
    });

    const setGenLoading = vi.fn();
    const setGenError = vi.fn();
    const { result } = renderHook(() => useOptimization());

    await act(async () => {
      await result.current.startOptimization("v_bad", "is_default", setGenLoading, setGenError);
    });

    expect(setGenError).toHaveBeenCalledWith("Catalog not found");
    expect(result.current.optimizeInProgress).toBe(false);
  });

  it("updates optimization cache", () => {
    const { result } = renderHook(() => useOptimization());
    const data = { optimization_id: "mc_abc", catalog_version: "v1", status: "completed" };

    act(() => {
      result.current.updateOptimizationCache(data, true);
    });

    expect(result.current.optimizationCacheRef.current["mc_abc"]).toEqual(data);
  });

  it("skips cache update for empty optimization_id", () => {
    const { result } = renderHook(() => useOptimization());
    act(() => {
      result.current.updateOptimizationCache({ optimization_id: "" }, false);
    });
    expect(Object.keys(result.current.optimizationCacheRef.current)).toHaveLength(0);
  });

  it("fetches saved optimizations", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ optimizations: [{ optimization_id: "mc_1", status: "completed" }] }),
    });

    const { result } = renderHook(() => useOptimization());
    await act(async () => {
      await result.current.fetchSavedOptimizations("v1");
    });

    expect(result.current.savedOptimizations).toHaveLength(1);
  });

  it("handles delete optimization", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ deleted: true }) });

    const { result } = renderHook(() => useOptimization());

    // Set an optimization first
    act(() => {
      result.current.setOptimizationId("mc_delete_me");
    });

    // Mock the list response for after delete
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ optimizations: [] }),
    });

    await act(async () => {
      await result.current.deleteOptimization(false, "v1");
    });

    expect(result.current.optimizationState).toBeNull();
  });

  it("does not delete when learnInProgress", async () => {
    const { result } = renderHook(() => useOptimization());

    act(() => {
      result.current.setOptimizationId("mc_keep");
    });

    await act(async () => {
      await result.current.deleteOptimization(true, "v1"); // learnInProgress = true
    });

    // Should not have called fetch for delete
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
