import { describe, it, expect, beforeAll } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSplitPane } from "@/app/hooks/useSplitPane";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("min-width"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    }),
  });
});

describe("useSplitPane", () => {
  it("initializes with default split ratio", () => {
    const { result } = renderHook(() => useSplitPane());
    expect(result.current.splitRatio).toBe(50);
  });

  it("provides a ref for the container", () => {
    const { result } = renderHook(() => useSplitPane());
    expect(result.current.splitContainerRef).toBeDefined();
  });
});
