"use client";

import { useState, useEffect } from "react";
import Papa from "papaparse";
import { Upload, FileText, Search, Activity, Loader2, Users, PanelLeft } from "lucide-react";
import { cn } from "@/lib/utils";

const CLOUD_FUNCTION_URL = process.env.NODE_ENV === "development"
  ? "http://127.0.0.1:5050/linexonewhitelabeler/us-central1"
  : "/api";

type View = "profiler";
type ProfilerTab = "test" | "upload";

export default function Home() {
  const [activeView, setActiveView] = useState<View>("profiler");
  const [profilerTab, setProfilerTab] = useState<ProfilerTab>("test");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

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

  const processFile = async () => {
    if (!file) return;

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
      });

      if (!res.ok) throw new Error("Failed to analyze transactions");
      const data = await res.json();
      setResults(data);
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-[#F3F4F6]">
      {/* Sidebar */}
      <aside
        className={cn(
          "border-r border-[#E5E7EB] bg-[#F9FAFB] py-6 flex flex-col shrink-0 transition-[width] duration-300 ease-in-out overflow-hidden",
          isSidebarOpen ? "w-56 px-4" : "w-16 px-2 items-center"
        )}
      >
        <div className={cn("mb-8 flex items-center", isSidebarOpen ? "justify-between w-full pl-2" : "justify-center")}>
          {isSidebarOpen && <h1 className="text-2xl font-bold tracking-tight text-black whitespace-nowrap">linex qu</h1>}
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className={cn("p-1.5 text-slate-500 hover:bg-slate-200 rounded-md shrink-0", isSidebarOpen ? "-mr-2" : "")}
            title={isSidebarOpen ? "Close sidebar" : "Open sidebar"}
          >
            <PanelLeft className="h-5 w-5" />
          </button>
        </div>

        <nav className="space-y-1 w-full">
          <button
            onClick={() => setActiveView("profiler")}
            className={cn(
              "flex w-full items-center rounded-md py-2 text-sm font-medium transition-colors",
              isSidebarOpen ? "px-3 gap-3 justify-start" : "px-0 justify-center",
              activeView === "profiler"
                ? "bg-slate-200 text-slate-900" /* slightly darker for selected */
                : "text-slate-600 hover:bg-slate-100"
            )}
            title={!isSidebarOpen ? "User Profiler" : undefined}
          >
            <Activity className="h-5 w-5 shrink-0" />
            {isSidebarOpen && <span className="whitespace-nowrap">User Profiler</span>}
          </button>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 transition-all duration-300 ease-in-out">
        <div className="flex-1 p-8">
          <div className="mx-auto max-w-6xl space-y-8">
            {error && (
              <div className="rounded-md bg-red-50 p-4 text-red-700 border border-red-200">
                {error}
              </div>
            )}

            {activeView === "profiler" ? (
              <div className="space-y-8">

                <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-sm flex flex-col min-h-[260px]">
                  {/* Tabs Header */}
                  <div className="flex border-b border-[#E5E7EB] px-2 pt-2">
                    <button
                      onClick={() => setProfilerTab("test")}
                      className={cn(
                        "px-6 py-3 text-sm border-b-2 -mb-px transition-colors flex items-center gap-2",
                        profilerTab === "test"
                          ? "border-black text-black font-bold"
                          : "font-medium border-transparent text-slate-500 hover:text-slate-700"
                      )}
                    >
                      <Users className="h-4 w-4" />
                      Test Users
                    </button>
                    <button
                      onClick={() => setProfilerTab("upload")}
                      className={cn(
                        "px-6 py-3 text-sm border-b-2 -mb-px transition-colors flex items-center gap-2",
                        profilerTab === "upload"
                          ? "border-black text-black font-bold"
                          : "font-medium border-transparent text-slate-500 hover:text-slate-700"
                      )}
                    >
                      <Upload className="h-4 w-4" />
                      Upload CSV
                    </button>
                  </div>

                  {/* Tab Content */}
                  <div className="p-6 flex-1 flex flex-col">
                    {/* Test Users Tab */}
                    {profilerTab === "test" && (
                      <div className="flex-1 flex flex-col">
                        {testUsersLoading ? (
                          <div className="flex items-center gap-2 text-slate-500">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Loading test users...
                          </div>
                        ) : testUserIds.length === 0 ? (
                          <p className="text-sm text-red-500">No test users found. Check data/test-users/ directory.</p>
                        ) : (
                          <>
                            <div>
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

                            <div className="mt-auto flex items-center gap-4 pt-4">
                              <button
                                onClick={analyzeTestUser}
                                disabled={!selectedUserId || loading}
                                className="rounded-md bg-black px-6 py-2 text-sm font-semibold text-white hover:opacity-80 disabled:opacity-50 flex items-center gap-2 shrink-0"
                              >
                                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                                Analyze
                              </button>
                              {loading && <InlineAnalyzingIndicator />}
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* Upload CSV Tab */}
                    {profilerTab === "upload" && (
                      <div className="flex-1 flex flex-col">
                        <div className="flex items-center gap-6">
                          <label className="flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-slate-300 py-4 hover:border-blue-500 hover:bg-slate-50 transition-colors w-1/2 shrink-0">
                            <div className="text-center">
                              <Upload className="mx-auto h-5 w-5 text-slate-400 mb-1" />
                              <span className="text-sm text-slate-600">
                                Click or drag CSV here
                              </span>
                            </div>
                            <input
                              type="file"
                              accept=".csv"
                              className="hidden"
                              onChange={handleFileUpload}
                            />
                          </label>

                          {file && (
                            <div className="flex-1 text-sm font-semibold text-slate-700 truncate">
                              {file.name}
                            </div>
                          )}
                        </div>

                        <div className="mt-auto flex items-center gap-4 pt-4">
                          <button
                            onClick={() => processFile()}
                            disabled={!file || loading}
                            className="rounded-md bg-black px-6 py-2 text-sm font-semibold text-white hover:opacity-80 disabled:opacity-50 flex items-center gap-2 shrink-0"
                          >
                            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                            Analyze
                          </button>
                          {loading && <InlineAnalyzingIndicator />}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Results Dashboard */}
                {results && (
                  <div className="space-y-8">
                    {/* TOON Results Output */}
                    <div className="overflow-hidden px-2">
                      <pre className="text-sm text-slate-900 overflow-x-auto whitespace-pre-wrap">
                        {formatToon(results.profile, results.card_recommendations)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
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

const ALL_STATEMENTS = [
  "Brewing up something good...",
  "Let me dig into this...",
  "Hmm, let me see...",
  "One moment...",
  "Cooking up an answer...",
  "Poking around...",
  "Down the rabbit hole...",
  "Crunching the numbers...",
  "Dusting off the archives...",
  "Connecting the dots...",
  "Rummaging through my brain...",
  "Give me a sec...",
  "Chewing on this...",
  "Putting on my thinking cap...",
  "Let me work my magic...",
  "Diving in...",
  "Spinning up the gears...",
  "Cracking open the books...",
  "Hold my coffee...",
  "Summoning the answer...",
  "Untangling this...",
  "Sniffing out the details...",
  "Rolling up my sleeves...",
  "Consulting the oracle..."
];

function InlineAnalyzingIndicator() {
  const [stepIndex, setStepIndex] = useState(0);
  const [steps, setSteps] = useState<string[]>([]);

  useEffect(() => {
    // Shuffle and pick 10 random statements for this run
    const shuffled = [...ALL_STATEMENTS].sort(() => 0.5 - Math.random());
    setSteps(shuffled.slice(0, 10));
  }, []);

  useEffect(() => {
    if (steps.length === 0) return;
    const interval = setInterval(() => {
      setStepIndex((current) => (current + 1) % steps.length);
    }, 2200);
    return () => clearInterval(interval);
  }, [steps]);

  return (
    <div className="flex items-center gap-4 flex-1">
      <div className="relative flex items-center justify-center w-8 h-8 shrink-0">
        <div className="relative flex items-center justify-center w-full h-full">
          {/* Animated Linex Logo */}
          <img src="/linex-animated.svg" alt="Loading..." className="w-6 h-6" />
        </div>
      </div>
      <div className="h-5 overflow-hidden flex-1 relative">
        <div
          className="flex flex-col transition-transform duration-500 ease-in-out"
          style={{ transform: `translateY(-${stepIndex * 20}px)` }}
        >
          {steps.map((step, i) => (
            <div key={i} className="h-5 flex items-center text-sm font-medium text-slate-600">
              {step}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
