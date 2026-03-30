import { describe, it, expect } from "vitest";
import {
  formatChatTimestamp,
  GREETING_RE,
  GIBBERISH_RE,
  isGibberish,
  pickCanned,
  compileFormula,
  formatCustomColValue,
  GRID_FIELDS,
} from "@/lib/helpers";

describe("formatChatTimestamp", () => {
  it("formats a date", () => {
    const result = formatChatTimestamp(new Date("2026-03-28T14:30:00"));
    expect(result).toContain("3/28");
  });
});

describe("GREETING_RE", () => {
  it("matches greetings", () => {
    expect(GREETING_RE.test("hi")).toBe(true);
    expect(GREETING_RE.test("hello")).toBe(true);
    expect(GREETING_RE.test("hey!")).toBe(true);
    expect(GREETING_RE.test("yo")).toBe(true);
    expect(GREETING_RE.test("good morning")).toBe(true);
  });

  it("does not match real queries", () => {
    expect(GREETING_RE.test("optimize my portfolio")).toBe(false);
    expect(GREETING_RE.test("what is the lift for P0")).toBe(false);
  });
});

describe("GIBBERISH_RE / isGibberish", () => {
  it("detects gibberish", () => {
    expect(GIBBERISH_RE.test("!!!")).toBe(true);
    expect(GIBBERISH_RE.test("aaaaa")).toBe(true);
    expect(isGibberish("xyz")).toBe(true);
    expect(isGibberish("...")).toBe(true);
  });

  it("does not flag real text", () => {
    expect(isGibberish("optimize")).toBe(false);
    expect(isGibberish("what is the lift")).toBe(false);
  });
});

describe("pickCanned", () => {
  it("returns a greeting string", () => {
    const result = pickCanned("greeting");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns a gibberish string", () => {
    const result = pickCanned("gibberish");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("GRID_FIELDS", () => {
  it("has expected fields", () => {
    expect(GRID_FIELDS.original_portfolio_ltv).toBeDefined();
    expect(GRID_FIELDS.lift).toBeDefined();
    expect(GRID_FIELDS.new_net_portfolio_ltv).toBeDefined();
  });
});

describe("compileFormula", () => {
  it("compiles a valid formula", () => {
    const fn = compileFormula("lift / portfolio_cost");
    expect(fn).not.toBeNull();
    expect(fn!({ original_portfolio_ltv: 100, new_gross_portfolio_ltv: 150, portfolio_cost: 30, lift: 20, new_net_portfolio_ltv: 120 })).toBeCloseTo(0.667, 1);
  });

  it("compiles addition formula", () => {
    const fn = compileFormula("original_portfolio_ltv + lift");
    expect(fn).not.toBeNull();
    expect(fn!({ original_portfolio_ltv: 100, new_gross_portfolio_ltv: 0, portfolio_cost: 0, lift: 50, new_net_portfolio_ltv: 0 })).toBe(150);
  });

  it("rejects dangerous expressions", () => {
    expect(compileFormula("alert('xss')")).toBeNull();
    expect(compileFormula("process.exit()")).toBeNull();
    expect(compileFormula("window.location")).toBeNull();
  });

  it("rejects unknown fields", () => {
    expect(compileFormula("unknown_field * 2")).toBeNull();
  });

  it("returns 0 for division by zero", () => {
    const fn = compileFormula("lift / portfolio_cost");
    expect(fn).not.toBeNull();
    const result = fn!({ original_portfolio_ltv: 0, new_gross_portfolio_ltv: 0, portfolio_cost: 0, lift: 50, new_net_portfolio_ltv: 0 });
    expect(result).toBe(0); // Infinity is not finite, so returns 0
  });
});

describe("formatCustomColValue", () => {
  it("formats dollar values", () => {
    expect(formatCustomColValue(1234.5, "dollar")).toBe("$1,235");
  });

  it("formats percent values", () => {
    expect(formatCustomColValue(0.123, "percent")).toBe("12.3%");
  });

  it("formats ratio values", () => {
    expect(formatCustomColValue(3.14159, "ratio")).toBe("3.14");
  });

  it("formats number values", () => {
    expect(formatCustomColValue(1234.567, "number")).toBe("1,234.57");
  });

  it("handles non-finite values", () => {
    expect(formatCustomColValue(Infinity, "dollar")).toBe("—");
    expect(formatCustomColValue(NaN, "percent")).toBe("—");
  });

  it("handles zero", () => {
    expect(formatCustomColValue(0, "dollar")).toBe("$0");
    expect(formatCustomColValue(0, "percent")).toBe("0.0%");
  });

  it("handles negative values", () => {
    expect(formatCustomColValue(-500, "dollar")).toBe("$-500");
  });
});
