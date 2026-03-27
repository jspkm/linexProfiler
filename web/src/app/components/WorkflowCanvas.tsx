"use client";

import { C } from "./theme";

export interface Workflow {
  workflow_id: string;
  name: string;
  description: string;
  detail: string;
  created_at?: string;
  updated_at?: string;
}

interface Template {
  id: string;
  cat: string;
  text: string;
  icon: string;
  desc: string;
}

const builtinTemplates: Template[] = [
  {
    id: "t0",
    cat: "Profile Generator",
    text: "Optimize portfolio",
    icon: "🚀",
    desc: "Learn behavioral profiles from transaction data using clustering, then derive optimal incentive program through simulation.",
  },
];

interface WorkflowCanvasProps {
  onTemplate: (template: Template) => void;
  workflows: Workflow[];
}

export default function WorkflowCanvas({ onTemplate, workflows }: WorkflowCanvasProps) {
  return (
    <div style={{ height: "100%", overflow: "auto", padding: "24px 28px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <div>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#00aaff", letterSpacing: "0.05em" }}>
            Workflow
          </span>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
            Click a workflow card to activate it, or describe your own.
          </div>
        </div>
      </div>

      {/* Built-in + User Workflows */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {builtinTemplates.map((t) => (
            <div
              key={t.id}
              onClick={() => onTemplate(t)}
              style={{
                border: `1px solid ${C.border}`,
                borderRadius: 2,
                padding: "14px 16px",
                background: C.surface,
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = C.accent + "66";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = C.border;
              }}
            >
              <div>
                  <p
                    style={{
                      fontSize: 12,
                      color: C.text,
                      margin: "0 0 4px",
                      lineHeight: 1.4,
                      fontWeight: 500,
                    }}
                  >
                    {t.text}
                  </p>
                  <p style={{ fontSize: 10, color: C.muted, margin: 0, lineHeight: 1.4 }}>
                    {t.desc}
                  </p>
              </div>
            </div>
          ))}
          {workflows.map((wf) => (
            <div
              key={wf.workflow_id}
              onClick={() =>
                onTemplate({
                  id: wf.workflow_id,
                  cat: "Custom",
                  text: wf.name,
                  icon: "⚡",
                  desc: wf.description,
                })
              }
              style={{
                border: `1px solid ${C.border}`,
                borderRadius: 2,
                padding: "14px 16px",
                background: C.surface,
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = C.accent + "66";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = C.border;
              }}
            >
              <div>
                <p
                  style={{
                    fontSize: 12,
                    color: C.text,
                    margin: "0 0 4px",
                    lineHeight: 1.4,
                    fontWeight: 500,
                  }}
                >
                  {wf.name}
                </p>
                <p style={{ fontSize: 10, color: C.muted, margin: 0, lineHeight: 1.4 }}>
                  {wf.description || "Custom workflow"}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
