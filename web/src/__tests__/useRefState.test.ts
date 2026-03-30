import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRefState } from "@/lib/useRefState";

describe("useRefState", () => {
  it("initializes with the given value", () => {
    const { result } = renderHook(() => useRefState("hello"));
    const [state, , ref] = result.current;
    expect(state).toBe("hello");
    expect(ref.current).toBe("hello");
  });

  it("updates both state and ref", () => {
    const { result } = renderHook(() => useRefState(0));
    act(() => {
      result.current[1](42);
    });
    expect(result.current[0]).toBe(42);
    expect(result.current[2].current).toBe(42);
  });

  it("ref reflects latest value synchronously", () => {
    const { result } = renderHook(() => useRefState<string | null>(null));
    act(() => {
      result.current[1]("updated");
    });
    // Ref is synchronous
    expect(result.current[2].current).toBe("updated");
  });

  it("handles null values", () => {
    const { result } = renderHook(() => useRefState<string | null>("initial"));
    act(() => {
      result.current[1](null);
    });
    expect(result.current[0]).toBeNull();
    expect(result.current[2].current).toBeNull();
  });
});
