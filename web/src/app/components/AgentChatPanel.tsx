"use client";

import { Square, ArrowUp } from "lucide-react";
import type { ChatMessage } from "@/lib/types";

interface AgentChatPanelProps {
  agentChatMessages: ChatMessage[];
  agentChatLoading: boolean;
  agentChatDraft: string;
  setAgentChatDraft: (v: string) => void;
  typedWelcomeLine: string;
  agentChatScrollRef: React.RefObject<HTMLDivElement | null>;
  optimizeInProgress: boolean;
  learnInProgress: boolean;
  pendingCreateWorkflow: unknown;
  pendingWorkflowAction: unknown;
  pendingEditWorkflow: unknown;
  onSubmit: () => void;
  onStop: () => void;
}

export default function AgentChatPanel({
  agentChatMessages, agentChatLoading,
  agentChatDraft, setAgentChatDraft,
  typedWelcomeLine, agentChatScrollRef,
  optimizeInProgress, learnInProgress,
  pendingCreateWorkflow, pendingWorkflowAction, pendingEditWorkflow,
  onSubmit, onStop,
}: AgentChatPanelProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    onSubmit();
  };

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <aside className="min-h-0 flex-1 overflow-hidden bg-[#111820] p-3 md:p-4">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex min-h-0 flex-1 flex-col bg-transparent">
          <div ref={agentChatScrollRef} className="min-h-0 flex-1 overflow-auto px-4 py-1 flex flex-col [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex-1" />
            {agentChatMessages.length === 0 ? (
              <div className="mb-0.5 flex items-center gap-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/linex-icon.svg" alt="Agent" className="h-[14px] w-[14px] shrink-0" />
                <h2 className="text-sm leading-tight text-[#3bb266]">
                  {typedWelcomeLine}
                </h2>
              </div>
            ) : (
              <div className="space-y-3">
                {agentChatMessages.map((message) => (
                  <div key={message.id} className={`flex max-w-[85%] flex-col ${message.role === "user" ? "ml-auto items-end" : "mr-auto items-start"}`}>
                    <div className={`w-fit rounded-md px-3 py-2 ${message.role === "user" ? "border border-[#5f6670] bg-[#0d1218] text-right" : "text-left"}`}>
                      {message.id === "opt-progress" && (
                        <div className="mb-1.5 flex items-center gap-2">
                          <svg width="14" height="14" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <defs>
                              <clipPath id="optProgressClip">
                                <rect x="0" y="0" width="44" height="0">
                                  <animate attributeName="height" values="0;44;44;0" keyTimes="0;0.4;0.8;1" dur="2s" repeatCount="indefinite" />
                                </rect>
                              </clipPath>
                            </defs>
                            <g clipPath="url(#optProgressClip)">
                              <path d="M11.2383 44H0L2.93359 40H14.1729L11.2383 44ZM17.1074 36H5.86816L8.80273 32H20.042L17.1074 36ZM22.9756 28H11.7363L14.6709 24H25.9102L22.9756 28ZM28.8447 20H17.6055L20.54 16H31.7793L28.8447 20ZM34.7139 12H23.4746L26.4092 8H37.6484L34.7139 12ZM40.583 4H29.3438L32.2783 0H43.5176L40.583 4Z" fill="#3bb266"/>
                              <path d="M42.3877 44H30.9336L28.1143 40H39.5693L42.3877 44ZM36.75 36H25.2949L22.4756 32H33.9307L36.75 36ZM31.1113 28H22.9756L25.9102 24H28.292L31.1113 28ZM17.6055 20H14.0176L11.1982 16H20.54L17.6055 20ZM19.835 12H8.37988L5.56055 8H17.0156L19.835 12ZM14.1963 4H2.74121L0.264648 0.486328H11.7197L14.1963 4Z" fill="#3bb266"/>
                            </g>
                          </svg>
                        </div>
                      )}
                      <p className={`text-sm wrap-break-words whitespace-pre-wrap ${message.role === "user" ? "text-[#3bb266]" : "text-[#9ca3af]"}`}>{message.text}</p>
                    </div>
                    {message.id !== "opt-progress" && <p className="mt-1 whitespace-nowrap text-[10px] text-[#6f7782]">{message.submittedAt}</p>}
                  </div>
                ))}
                {agentChatLoading && (
                  <div className="mr-auto flex max-w-[85%] flex-col items-start">
                    <div className="w-fit rounded-md px-3 py-2 flex items-center">
                      <svg width="16" height="16" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <defs>
                          <clipPath id="agentDrawClip">
                            <rect x="0" y="0" width="44" height="0">
                              <animate attributeName="height" values="0;44;44;0" keyTimes="0;0.4;0.8;1" dur="2s" repeatCount="indefinite" />
                            </rect>
                          </clipPath>
                        </defs>
                        <g clipPath="url(#agentDrawClip)">
                          <path d="M11.2383 44H0L2.93359 40H14.1729L11.2383 44ZM17.1074 36H5.86816L8.80273 32H20.042L17.1074 36ZM22.9756 28H11.7363L14.6709 24H25.9102L22.9756 28ZM28.8447 20H17.6055L20.54 16H31.7793L28.8447 20ZM34.7139 12H23.4746L26.4092 8H37.6484L34.7139 12ZM40.583 4H29.3438L32.2783 0H43.5176L40.583 4Z" fill="#3bb266"/>
                          <path d="M42.3877 44H30.9336L28.1143 40H39.5693L42.3877 44ZM36.75 36H25.2949L22.4756 32H33.9307L36.75 36ZM31.1113 28H22.9756L25.9102 24H28.292L31.1113 28ZM17.6055 20H14.0176L11.1982 16H20.54L17.6055 20ZM19.835 12H8.37988L5.56055 8H17.0156L19.835 12ZM14.1963 4H2.74121L0.264648 0.486328H11.7197L14.1963 4Z" fill="#3bb266"/>
                        </g>
                      </svg>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="shrink-0 px-4 py-3">
            <form className="relative" onSubmit={handleFormSubmit}>
              <span className="pointer-events-none absolute left-3 top-2 text-sm leading-[1.3] text-[#45d58d]">
                {">"}
              </span>
              <textarea
                autoFocus
                value={agentChatDraft}
                onChange={(e) => setAgentChatDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={agentChatMessages.length > 0 ? "Reply..." : "Ask the Agent..."}
                className="terminal-block-caret min-h-22 w-full resize-none border-0 border-t border-[#167516] bg-transparent pl-[calc(0.75rem+2ch)] pr-20 py-2 text-sm leading-[1.3] text-[#3bb266] placeholder:text-[#3bb266]/80 focus:outline-none"
              />
              {(optimizeInProgress || learnInProgress) ? (
                <button
                  type="button"
                  aria-label="Stop"
                  title="Stop"
                  onClick={onStop}
                  className="absolute bottom-4 right-3 rounded-full bg-[#66ff99] w-8 h-8 text-black hover:opacity-80 flex items-center justify-center"
                >
                  <Square className="h-3.5 w-3.5 fill-current" strokeWidth={0} />
                </button>
              ) : (
                <button
                  type="submit"
                  aria-label="Submit"
                  title="Submit"
                  disabled={(!agentChatDraft.trim() && !pendingCreateWorkflow && !pendingWorkflowAction && !pendingEditWorkflow) || agentChatLoading}
                  className="absolute bottom-4 right-3 rounded-full bg-[#66ff99] w-8 h-8 text-black hover:opacity-80 disabled:opacity-30 flex items-center justify-center"
                >
                  <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
                </button>
              )}
            </form>
          </div>
        </div>
      </div>
    </aside>
  );
}
