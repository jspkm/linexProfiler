import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIncentiveSets } from "@/app/hooks/useIncentiveSets";

const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

describe("useIncentiveSets", () => {
  it("initializes with empty state", () => {
    const { result } = renderHook(() => useIncentiveSets());
    expect(result.current.incentiveSets).toEqual([]);
    expect(result.current.selectedIncentiveSetVersion).toBe("");
  });

  it("fetches incentive sets and selects default", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        incentive_sets: [
          { version: "is_abc", name: "Default", is_default: true, incentive_count: 10 },
          { version: "is_xyz", name: "Custom", is_default: false, incentive_count: 5 },
        ],
      }),
    });

    const { result } = renderHook(() => useIncentiveSets());
    await act(async () => {
      await result.current.fetchIncentiveSets();
    });

    expect(result.current.incentiveSets).toHaveLength(2);
    expect(result.current.selectedIncentiveSetVersion).toBe("is_abc");
  });

  it("loads incentive set detail", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        version: "is_abc",
        name: "Default",
        incentives: [{ name: "Cash back", estimated_annual_cost_per_user: 100, redemption_rate: 0.3 }],
      }),
    });

    const { result } = renderHook(() => useIncentiveSets());
    await act(async () => {
      await result.current.loadIncentiveSetDetail("is_abc");
    });

    expect(result.current.selectedIncentiveSetDetail?.name).toBe("Default");
  });
});
