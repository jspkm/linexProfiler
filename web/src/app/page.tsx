"use client";

import { useState, useEffect } from "react";
import Papa from "papaparse";
import { Upload, FileText, Search, Activity, Loader2, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const CLOUD_FUNCTION_URL = process.env.NODE_ENV === "development"
  ? "http://127.0.0.1:5050/linexonewhitelabeler/us-central1"
  : "/api";

type View = "profiler" | "ask";
type ProfilerTab = "test" | "upload";

export default function Home() {
  const [activeView, setActiveView] = useState<View>("profiler");
  const [profilerTab, setProfilerTab] = useState<ProfilerTab>("test");

  // Test Users State
  const [testUserIds, setTestUserIds] = useState<string[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [testUsersLoading, setTestUsersLoading] = useState(false);

  // Upload State
  const [file, setFile] = useState<File | null>(null);
  const [customerId, setCustomerId] = useState("uploaded");

  // Common State
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [results, setResults] = useState<any>(null);
  const [error, setError] = useState("");

  // Ask Qu State
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [askLoading, setAskLoading] = useState(false);

  // Load test user IDs on mount
  useEffect(() => {
    fetchTestUsers();
  }, []);

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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const analyzeTestUser = async () => {
    if (!selectedUserId) return;
    setLoading(true);
    setLoadingStep("Profiling with Gemini...");
    setError("");
    setResults(null);
    try {
      const res = await fetch(`${CLOUD_FUNCTION_URL}/analyze_test_user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: selectedUserId }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to analyze test user");
      }
      setLoadingStep("Matching credit cards...");
      const data = await res.json();
      setResults(data);
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
      setLoadingStep("");
    }
  };

  const processFile = async (action: "analyze" | "ask") => {
    if (!file) return;

    if (action === "analyze") setLoading(true);
    if (action === "ask") setAskLoading(true);
    setError("");

    try {
      const text = await file.text();
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
      const transactions = parsed.data;

      if (action === "analyze") {
        const res = await fetch(`${CLOUD_FUNCTION_URL}/analyze_transactions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactions, customer_id: customerId }),
        });

        if (!res.ok) throw new Error("Failed to analyze transactions");
        const data = await res.json();
        setResults(data);
      } else {
        const res = await fetch(`${CLOUD_FUNCTION_URL}/ask_qu`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactions, customer_id: customerId, question }),
        });

        if (!res.ok) throw new Error("Failed to ask question");
        const data = await res.json();
        setAnswer(data.answer);
      }
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      if (action === "analyze") setLoading(false);
      if (action === "ask") setAskLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-64 border-r bg-white p-6 shadow-sm">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-blue-600">qu</h1>
          <p className="text-sm font-medium text-slate-500">Linex Profiler Quant Agent</p>
        </div>

        <nav className="space-y-1">
          <button
            onClick={() => setActiveView("profiler")}
            className={cn(
              "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              activeView === "profiler"
                ? "bg-slate-100 text-slate-900"
                : "text-slate-600 hover:bg-slate-50"
            )}
          >
            <Activity className="h-4 w-4" />
            User Profiler
          </button>
          <button
            onClick={() => setActiveView("ask")}
            className={cn(
              "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              activeView === "ask"
                ? "bg-slate-100 text-slate-900"
                : "text-slate-600 hover:bg-slate-50"
            )}
          >
            <Search className="h-4 w-4" />
            Ask qu
          </button>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-8">
        <div className="mx-auto max-w-6xl space-y-8">
          {error && (
            <div className="rounded-md bg-red-50 p-4 text-red-700 border border-red-200">
              {error}
            </div>
          )}

          {activeView === "profiler" ? (
            <div className="space-y-8">
              {/* Tabs: Test Users | Upload CSV */}
              <div className="flex border-b">
                <button
                  onClick={() => setProfilerTab("test")}
                  className={cn(
                    "px-6 py-3 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-2",
                    profilerTab === "test"
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  )}
                >
                  <Users className="h-4 w-4" />
                  Test Users
                </button>
                <button
                  onClick={() => setProfilerTab("upload")}
                  className={cn(
                    "px-6 py-3 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-2",
                    profilerTab === "upload"
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  )}
                >
                  <Upload className="h-4 w-4" />
                  Upload CSV
                </button>
              </div>

              {/* Test Users Tab */}
              {profilerTab === "test" && (
                <div className="rounded-xl border bg-white p-6 shadow-sm">
                  <h2 className="mb-4 text-lg font-semibold">Select Test User</h2>
                  {testUsersLoading ? (
                    <div className="flex items-center gap-2 text-slate-500">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading test users...
                    </div>
                  ) : testUserIds.length === 0 ? (
                    <p className="text-sm text-red-500">No test users found. Check data/test-users/ directory.</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-4">
                        <select
                          value={selectedUserId}
                          onChange={(e) => setSelectedUserId(e.target.value)}
                          className="rounded-md border px-3 py-2 text-sm bg-white min-w-[200px]"
                        >
                          {testUserIds.map((id) => (
                            <option key={id} value={id}>
                              User {id}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={analyzeTestUser}
                          disabled={!selectedUserId || loading}
                          className="rounded-md bg-blue-600 px-6 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                        >
                          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                          Analyze
                        </button>
                      </div>
                      {loading && loadingStep && (
                        <p className="text-sm text-slate-500 italic mt-1">{loadingStep}</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Upload CSV Tab */}
              {profilerTab === "upload" && (
                <div className="rounded-xl border bg-white p-6 shadow-sm">
                  <h2 className="mb-4 text-lg font-semibold">Upload CSV</h2>
                  <div className="flex items-center gap-4">
                    <label className="flex cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-slate-300 p-6 hover:border-blue-500 hover:bg-slate-50 transition-colors w-full max-w-md">
                      <div className="text-center">
                        <Upload className="mx-auto h-8 w-8 text-slate-400 mb-2" />
                        <span className="text-sm text-slate-600">
                          {file ? file.name : "Click or drag CSV here"}
                        </span>
                      </div>
                      <input
                        type="file"
                        accept=".csv"
                        className="hidden"
                        onChange={handleFileUpload}
                      />
                    </label>

                    <div className="space-y-4">
                      <input
                        type="text"
                        className="w-full rounded-md border px-3 py-2 text-sm"
                        placeholder="Customer ID (optional)"
                        value={customerId}
                        onChange={(e) => setCustomerId(e.target.value)}
                      />
                      <button
                        onClick={() => processFile("analyze")}
                        disabled={!file || loading}
                        className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                        Analyze Upload
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Results Dashboard */}
              {results && (
                <div className="space-y-8">
                  {/* TOON Results Output */}
                  <div className="rounded-xl border bg-white p-6 shadow-sm overflow-hidden">
                    <pre className="text-sm text-slate-900 overflow-x-auto whitespace-pre-wrap">
                      {formatToon(results.profile, results.card_recommendations)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-8">
              {/* Ask Qu View */}
              <div className="rounded-xl border bg-white p-8 shadow-sm">
                <h2 className="mb-2 text-2xl font-bold">Ask qu</h2>
                <p className="mb-8 text-slate-500">Ask any question about a person based on their transaction history.</p>

                <div className="space-y-6 max-w-2xl">
                  {/* Test User Selector */}
                  <div>
                    <label className="block text-sm font-medium mb-2">1. Select Test User</label>
                    <select
                      value={selectedUserId}
                      onChange={(e) => setSelectedUserId(e.target.value)}
                      className="rounded-md border px-3 py-2 text-sm bg-white min-w-[200px]"
                    >
                      {testUserIds.map((id) => (
                        <option key={id} value={id}>
                          User {id}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">2. Ask a Question</label>
                    <input
                      type="text"
                      className="w-full rounded-md border px-4 py-3"
                      placeholder="e.g. Is this person likely a student? What's their estimated income?"
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && selectedUserId && question) {
                          askTestUser();
                        }
                      }}
                    />
                  </div>

                  <button
                    onClick={askTestUser}
                    disabled={!selectedUserId || !question || askLoading}
                    className="w-full rounded-md bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {askLoading && <Loader2 className="h-5 w-5 animate-spin" />}
                    Ask
                  </button>

                  {answer && (
                    <div className="mt-8 rounded-lg bg-blue-50 p-6 border border-blue-100">
                      <h3 className="text-sm font-bold text-blue-900 mb-2">Answer</h3>
                      <div className="text-blue-900 whitespace-pre-wrap text-sm leading-relaxed">{answer}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );

  async function askTestUser() {
    if (!selectedUserId || !question) return;
    setAskLoading(true);
    setError("");
    setAnswer("");

    try {
      // First analyze the test user to get features
      const analyzeRes = await fetch(`${CLOUD_FUNCTION_URL}/analyze_test_user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: selectedUserId }),
      });
      if (!analyzeRes.ok) throw new Error("Failed to load test user data");
      // We don't actually need the full analysis for ask — let's use a dedicated approach
      // The ask_qu endpoint needs transactions, so we'll load the CSV from the test user endpoint
      // For now, we'll make the backend handle test users for ask too via a new approach
      // Actually, let's just read the test user file and send as transactions
    } catch {
      // fallback
    }

    try {
      // Use the test user CSV by loading it through the backend
      const res = await fetch(`${CLOUD_FUNCTION_URL}/ask_test_user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: selectedUserId, question }),
      });

      if (!res.ok) throw new Error("Failed to ask question");
      const data = await res.json();
      setAnswer(data.answer);
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setAskLoading(false);
    }
  }
}

// Helpers
const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884d8", "#82ca9d"];

function MetricCard({ title, value }: { title: string; value: string | number }) {
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-slate-500 mb-1 leading-none">{title}</p>
      <p className="text-2xl font-bold tracking-tight text-slate-900">{value}</p>
    </div>
  );
}

function formatToon(profile: any, rec: any) {
  let profileToon = "linex_profile:\n profile:\n";
  if (profile.raw_toon) {
    profileToon = profile.raw_toon;
  } else if (profile.attributes) {
    for (const [key, attr] of Object.entries(profile.attributes)) {
      const a = attr as any;
      profileToon += `  ${key}: ${a.value} [${a.confidence}]\n`;
    }
  }

  let recToon = " card_recommendation:\n";
  if (rec.raw_toon) {
    recToon = rec.raw_toon.replace("linex_profile:\n", "");
  } else if (rec.recommendations) {
    const fields = "card_id,card_name,issuer,fit_score,match,estimated_annual_value,description";
    recToon += `  recommendations[${rec.recommendations.length}]{${fields}}:\n`;
    for (const r of rec.recommendations) {
      recToon += `   ${r.card_id},${r.card_name},${r.issuer},${r.fit_score},${r.why_it_matches},${r.estimated_annual_reward_value},${r.description}\n`;
    }
  }

  if (!profileToon.endsWith('\n')) profileToon += '\n';

  return profileToon + recToon;
}
