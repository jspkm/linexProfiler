import { describe, it, expect } from "vitest";
import {
  C,
  BEHAVIORAL_AXES,
  PRIMARY_FEATURES,
  OPTIMIZATION_CACHE_STORAGE_KEY,
} from "@/app/components/theme";

describe("theme constants", () => {
  it("defines all required color tokens", () => {
    expect(C.bg).toBe("#050607");
    expect(C.accent).toBe("#66ff99");
    expect(C.danger).toBe("#ff5d73");
    expect(C.text).toBeDefined();
    expect(C.textSec).toBeDefined();
    expect(C.muted).toBeDefined();
    expect(C.panel).toBeDefined();
    expect(C.surface).toBeDefined();
    expect(C.border).toBeDefined();
  });

  it("defines color values as strings", () => {
    for (const value of Object.values(C)) {
      expect(typeof value).toBe("string");
    }
  });
});

describe("BEHAVIORAL_AXES", () => {
  it("has exactly 4 axes", () => {
    expect(BEHAVIORAL_AXES).toHaveLength(4);
  });

  it("each axis has required fields", () => {
    for (const axis of BEHAVIORAL_AXES) {
      expect(axis).toHaveProperty("axis");
      expect(axis).toHaveProperty("label");
      expect(axis).toHaveProperty("features");
      expect(axis.features.length).toBeGreaterThan(0);
    }
  });

  it("includes expected axis names", () => {
    const names = BEHAVIORAL_AXES.map((a) => a.axis);
    expect(names).toContain("activity_recency");
    expect(names).toContain("purchase_frequency");
    expect(names).toContain("spend_intensity");
    expect(names).toContain("refund_return");
  });
});

describe("PRIMARY_FEATURES", () => {
  it("is a Set with one feature per axis", () => {
    expect(PRIMARY_FEATURES.size).toBe(BEHAVIORAL_AXES.length);
  });

  it("contains the first feature from each axis", () => {
    for (const axis of BEHAVIORAL_AXES) {
      expect(PRIMARY_FEATURES.has(axis.features[0])).toBe(true);
    }
  });
});

describe("OPTIMIZATION_CACHE_STORAGE_KEY", () => {
  it("is a non-empty string", () => {
    expect(typeof OPTIMIZATION_CACHE_STORAGE_KEY).toBe("string");
    expect(OPTIMIZATION_CACHE_STORAGE_KEY.length).toBeGreaterThan(0);
  });
});
