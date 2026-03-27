import { useState, useRef, useEffect } from "react";
import { CLOUD_FUNCTION_URL, isAbortError } from "@/lib/api";
import type { ApiRecord } from "@/lib/types";

export function useProfiler() {
  const [profilerTab, setProfilerTab] = useState<"test" | "upload">("test");
  const [testUserIds, setTestUserIds] = useState<string[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [testUsersLoading, setTestUsersLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [customerId] = useState("uploaded");
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [results, setResults] = useState<ApiRecord | null>(null);
  const [error, setError] = useState("");
  const profilerAbortRef = useRef<AbortController | null>(null);

  const fetchTestUsers = async () => {
    setTestUsersLoading(true);
    try {
      const res = await fetch(`${CLOUD_FUNCTION_URL}/list_test_users`);
      if (res.ok) {
        const data = await res.json();
        setTestUserIds(data.user_ids || []);
        if (data.user_ids?.length > 0) {
          setSelectedUserId(data.user_ids[0]);
        }
      }
    } catch {
      // Silently fail — test users may not be available
    } finally {
      setTestUsersLoading(false);
    }
  };

  useEffect(() => {
    fetchTestUsers();
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const analyzeTestUser = async () => {
    if (!selectedUserId) return;
    const controller = new AbortController();
    profilerAbortRef.current = controller;
    setLoading(true);
    setLoadingStep("Profiling with Gemini...");
    setError("");
    setResults(null);
    try {
      const res = await fetch(`${CLOUD_FUNCTION_URL}/analyze_test_user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: selectedUserId }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to analyze test user");
      }
      setLoadingStep("Matching credit cards...");
      const data = await res.json();
      setResults(data);
    } catch (err: unknown) {
      if (!isAbortError(err)) {
        setError(err instanceof Error ? err.message : "An error occurred");
      }
    } finally {
      setLoading(false);
      setLoadingStep("");
      profilerAbortRef.current = null;
    }
  };

  const processFile = async () => {
    if (!file) return;
    const Papa = (await import("papaparse")).default;
    const controller = new AbortController();
    profilerAbortRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const text = await file.text();
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
      const transactions = parsed.data;
      const res = await fetch(`${CLOUD_FUNCTION_URL}/analyze_transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactions, customer_id: customerId }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error("Failed to analyze transactions");
      const data = await res.json();
      setResults(data);
    } catch (err: unknown) {
      if (!isAbortError(err)) {
        setError(err instanceof Error ? err.message : "An error occurred");
      }
    } finally {
      setLoading(false);
      profilerAbortRef.current = null;
    }
  };

  const stopProfilerProcess = () => {
    if (profilerAbortRef.current) {
      profilerAbortRef.current.abort();
      profilerAbortRef.current = null;
    }
    setLoading(false);
    setLoadingStep("");
    setResults(null);
    setError("");
  };

  return {
    profilerTab, setProfilerTab,
    testUserIds, selectedUserId, setSelectedUserId, testUsersLoading,
    file, handleFileUpload,
    loading, loadingStep, results, error,
    analyzeTestUser, processFile, stopProfilerProcess,
  };
}
