import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchJson, postJson, deleteJson, isAbortError } from "@/lib/api";

const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

describe("fetchJson", () => {
  it("returns parsed JSON on success", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: 42 }) });
    const result = await fetchJson("http://test.com/api");
    expect(result).toEqual({ data: 42 });
  });

  it("throws on non-ok response with error field", async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 400,
      json: () => Promise.resolve({ error: "Bad request" }),
    });
    await expect(fetchJson("http://test.com/api")).rejects.toThrow("Bad request");
  });

  it("throws with status code when no error field", async () => {
    mockFetch.mockResolvedValue({
      ok: false, status: 500,
      json: () => Promise.reject(new Error("parse fail")),
    });
    await expect(fetchJson("http://test.com/api")).rejects.toThrow("Request failed (500)");
  });
});

describe("postJson", () => {
  it("sends POST with JSON body", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });
    await postJson("http://test.com/api", { key: "value" });
    expect(mockFetch).toHaveBeenCalledWith("http://test.com/api", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "value" }),
    }));
  });
});

describe("deleteJson", () => {
  it("sends DELETE request", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ deleted: true }) });
    await deleteJson("http://test.com/api");
    expect(mockFetch).toHaveBeenCalledWith("http://test.com/api", expect.objectContaining({
      method: "DELETE",
    }));
  });
});

describe("isAbortError", () => {
  it("returns true for AbortError DOMException", () => {
    const err = new DOMException("Aborted", "AbortError");
    expect(isAbortError(err)).toBe(true);
  });

  it("returns false for regular Error", () => {
    expect(isAbortError(new Error("fail"))).toBe(false);
  });

  it("returns false for non-AbortError DOMException", () => {
    const err = new DOMException("fail", "NetworkError");
    expect(isAbortError(err)).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });
});
