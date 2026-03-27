"use client";

import { Upload, Loader2, Users, Square, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { BEHAVIORAL_AXES } from "./theme";
import { formatToon, ALL_STATEMENTS } from "@/lib/helpers";
import type { ApiRecord } from "@/lib/types";
import { useState, useEffect } from "react";

interface ProfilerViewProps {
  profilerTab: "test" | "upload";
  setProfilerTab: (v: "test" | "upload") => void;
  testUserIds: string[];
  selectedUserId: string;
  setSelectedUserId: (v: string) => void;
  testUsersLoading: boolean;
  file: File | null;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  loading: boolean;
  results: ApiRecord | null;
  error: string;
  analyzeTestUser: () => void;
  processFile: () => void;
  stopProfilerProcess: () => void;
}

function InlineAnalyzingIndicator() {
  const [stepIndex, setStepIndex] = useState(0);
  const [steps] = useState<string[]>(() => {
    const shuffled = [...ALL_STATEMENTS].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 10);
  });

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
          {/* eslint-disable-next-line @next/next/no-img-element */}
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

export function ProfileAssignmentView({ assignment }: { assignment: ApiRecord }) {
  return (
    <div className="rounded-lg border border-slate-200 p-5 space-y-4">
      <div className="flex items-center gap-4">
        <span className="inline-flex items-center justify-center rounded-full bg-slate-900 text-white text-sm font-bold w-12 h-12">
          {assignment.profile_id}
        </span>
        <div>
          <div className="text-lg font-semibold text-slate-900">
            {assignment.profile_label || `Profile ${assignment.profile_id}`}
          </div>
          <div className="text-sm text-slate-500">
            Confidence: <span className="font-semibold text-slate-700">{(assignment.confidence * 100).toFixed(1)}%</span>
            {' · '}Customer: {assignment.customer_id}
          </div>
        </div>
      </div>

      {assignment.alternates && assignment.alternates.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-[#00aaff] mb-2 tracking-wide">Alternate Candidates</h4>
          <div className="flex flex-wrap gap-3">
            {assignment.alternates.map((alt: ApiRecord, i: number) => (
              <div key={i} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
                <span className="font-semibold">{alt.profile_id}</span>
                <span className="text-slate-400 ml-2">d={alt.distance}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {assignment.feature_vector && (
        <div>
          <h4 className="text-xs font-semibold text-[#00aaff] mb-3 tracking-wide">Feature Vector (normalized)</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {BEHAVIORAL_AXES.map((ax) => {
              const primaryFeat = ax.features[0];
              const primaryVal = assignment.feature_vector[primaryFeat] ?? 0;
              const auxFeatures = ax.features.slice(1).filter((f: string) => f in assignment.feature_vector);
              return (
                <div key={ax.axis}>
                  <div className="flex items-center gap-2 text-xs mb-1">
                    <span className="w-40 truncate text-slate-800 font-bold">{ax.label}</span>
                    <div className="flex-1 bg-slate-200 rounded-full h-1.5 overflow-hidden">
                      <div className="bg-blue-600 h-full rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(primaryVal * 10, 100))}%` }} />
                    </div>
                    <span className="font-mono text-slate-700 w-10 text-right font-semibold">{primaryVal.toFixed(2)}</span>
                  </div>
                  {auxFeatures.length > 0 && (
                    <div className="space-y-0.5 pl-3">
                      {auxFeatures.map((feat: string) => {
                        const val = assignment.feature_vector[feat] ?? 0;
                        return (
                          <div key={feat} className="flex items-center gap-2 text-xs">
                            <span className="w-37 truncate text-slate-400">{feat}</span>
                            <div className="flex-1 bg-slate-100 rounded-full h-1 overflow-hidden">
                              <div className="bg-blue-300 h-full rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(val * 10, 100))}%` }} />
                            </div>
                            <span className="font-mono text-slate-400 w-10 text-right">{val.toFixed(2)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProfilerView(props: ProfilerViewProps) {
  const {
    profilerTab, setProfilerTab,
    testUserIds, selectedUserId, setSelectedUserId, testUsersLoading,
    file, handleFileUpload,
    loading, results, error,
    analyzeTestUser, processFile, stopProfilerProcess,
  } = props;

  return (
    <div className="p-3 md:p-4">
      <div className="mx-auto max-w-6xl space-y-6">
        {error && (
          <div className="rounded-md bg-red-50 p-4 text-red-700 border border-red-200">
            {error}
          </div>
        )}

        <div className="space-y-6">
          <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-sm flex flex-col min-h-65">
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

            <div className="p-6 flex-1 flex flex-col">
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
                          className="rounded-md border px-3 py-2 text-sm bg-white min-w-50"
                        >
                          {testUserIds.map((id) => (
                            <option key={id} value={id}>User {id}</option>
                          ))}
                        </select>
                      </div>
                      <div className="mt-auto flex items-center gap-4 pt-4">
                        <button
                          onClick={loading ? stopProfilerProcess : analyzeTestUser}
                          disabled={!selectedUserId}
                          aria-label="Submit"
                          title={loading ? "Stop" : "Submit"}
                          className="rounded-full bg-black w-8 h-8 text-white hover:opacity-80 disabled:opacity-50 flex items-center justify-center shrink-0"
                        >
                          {loading ? <Square className="h-3.5 w-3.5" /> : <ArrowUp className="h-4 w-4" strokeWidth={2.25} />}
                        </button>
                        {loading && <InlineAnalyzingIndicator />}
                      </div>
                    </>
                  )}
                </div>
              )}

              {profilerTab === "upload" && (
                <div className="flex-1 flex flex-col">
                  <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:gap-6">
                    <label className="flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-slate-300 py-4 hover:border-blue-500 hover:bg-slate-50 transition-colors w-full sm:w-1/2 shrink-0">
                      <div className="text-center">
                        <Upload className="mx-auto h-5 w-5 text-slate-400 mb-1" />
                        <span className="text-sm text-slate-600">Click or drag CSV here</span>
                      </div>
                      <input type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
                    </label>
                    {file && (
                      <div className="flex-1 text-sm font-semibold text-slate-700 break-all sm:truncate">
                        {file.name}
                      </div>
                    )}
                  </div>
                  <div className="mt-auto flex items-center gap-4 pt-4">
                    <button
                      onClick={loading ? stopProfilerProcess : () => processFile()}
                      disabled={!file}
                      aria-label="Submit"
                      title={loading ? "Stop" : "Submit"}
                      className="rounded-full bg-black w-8 h-8 text-white hover:opacity-80 disabled:opacity-50 flex items-center justify-center shrink-0"
                    >
                      {loading ? <Square className="h-3.5 w-3.5" /> : <ArrowUp className="h-4 w-4" strokeWidth={2.25} />}
                    </button>
                    {loading && <InlineAnalyzingIndicator />}
                  </div>
                </div>
              )}
            </div>
          </div>

          {results && (
            <div className="space-y-8">
              <div className="overflow-hidden px-2">
                <pre className="text-sm text-slate-900 overflow-x-auto whitespace-pre-wrap">
                  {formatToon(results.profile, results.card_recommendations)}
                </pre>
              </div>
              {results.assignment && (
                <div className="px-2 pt-4 border-t border-slate-200">
                  <ProfileAssignmentView assignment={results.assignment} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
