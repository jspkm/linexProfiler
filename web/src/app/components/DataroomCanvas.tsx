"use client";

import { useRef, useState } from "react";
import { C } from "./theme";

interface Dataset {
  dataset_id: string;
  upload_name?: string;
  row_count?: number;
  parsed_user_count?: number;
  created_at?: string;
}

interface DataroomCanvasProps {
  datasets: Dataset[];
}

const columns = ["Name", "Rows", "User Count", "Uploaded On"];

export default function DataroomCanvas({ datasets }: DataroomCanvasProps) {
  const [sampleOpen, setSampleOpen] = useState(false);
  const [uploadsOpen, setUploadsOpen] = useState(false);
  const [showDropZone, setShowDropZone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div style={{ height: "100%", overflow: "auto", padding: "18px 24px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 18,
        }}
      >
        <div>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#00aaff", letterSpacing: "0.05em" }}>
            Dataroom
          </span>
        </div>
        <button
          onClick={() => setShowDropZone((p) => !p)}
          style={{
            fontSize: 12,
            color: "#1a1a1a",
            background: "#ffffff",
            border: "1px solid #d0d0d0",
            borderRadius: 6,
            padding: "5px 12px",
            cursor: "pointer",
            fontFamily: "inherit",
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span style={{ fontSize: 13 }}>↑</span> Upload Files
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx"
          multiple
          style={{ display: "none" }}
        />
      </div>

      <div
        style={{
          border: `1px solid ${C.border}`,
          borderRadius: 2,
          background: C.surface,
          overflow: "hidden",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, tableLayout: "fixed" }}>
          <colgroup>
            <col />
            <col style={{ width: 120 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 140 }} />
          </colgroup>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              {columns.map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: "left",
                    padding: "9px 12px",
                    color: C.muted,
                    fontWeight: 600,
                    fontSize: 9,
                    letterSpacing: "0.05em",
                    borderBottom: `1px solid ${C.border}`,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Sample Portfolio folder */}
            <tr
              onClick={() => setSampleOpen((p) => !p)}
              style={{ cursor: "pointer", borderBottom: `1px solid ${C.border}33` }}
            >
              <td colSpan={4} style={{ padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: C.muted, fontSize: 11 }}>
                    {sampleOpen ? "▾" : "▸"}
                  </span>
                  <span style={{ fontSize: 13 }}>📁</span>
                  <span style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>
                    Sample Portfolio
                  </span>
                  <span style={{ fontSize: 10, color: C.muted }}>
                    ({datasets.length})
                  </span>
                </div>
              </td>
            </tr>
            {sampleOpen &&
              datasets.map((d) => (
                <tr key={d.dataset_id} style={{ borderBottom: `1px solid ${C.border}22` }}>
                  <td style={{ paddingTop: 8, paddingBottom: 8, paddingRight: 12, paddingLeft: 36, fontSize: 12, color: C.text, fontWeight: 500 }}>
                    {d.upload_name || d.dataset_id}
                  </td>
                  <td style={{ padding: "8px 10px", color: C.muted, fontFamily: "monospace", fontSize: 10 }}>
                    {(d.row_count || 0).toLocaleString()}
                  </td>
                  <td style={{ padding: "8px 10px", color: C.muted, fontFamily: "monospace", fontSize: 10 }}>
                    {(d.parsed_user_count || 0).toLocaleString()}
                  </td>
                  <td style={{ padding: "8px 10px", color: C.muted, fontSize: 10 }}>
                    {d.created_at ? new Date(d.created_at).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
            {/* My Uploads folder */}
            <tr
              onClick={() => setUploadsOpen((p) => !p)}
              style={{ cursor: "pointer", borderBottom: `1px solid ${C.border}33` }}
            >
              <td colSpan={4} style={{ padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: C.muted, fontSize: 11 }}>
                    {uploadsOpen ? "▾" : "▸"}
                  </span>
                  <span style={{ fontSize: 13 }}>📁</span>
                  <span style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>
                    My Uploads
                  </span>
                  <span style={{ fontSize: 10, color: C.muted }}>
                    (0)
                  </span>
                </div>
              </td>
            </tr>
            {uploadsOpen && (
              <tr>
                <td colSpan={4} style={{ padding: "12px 12px", paddingLeft: 36, color: C.muted, fontSize: 11 }}>
                  No files uploaded yet. Click &quot;Upload Files&quot; to add data.
                </td>
              </tr>
            )}
            {datasets.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: "16px 12px", color: C.muted, fontSize: 11 }}>
                  No portfolios uploaded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Drop zone */}
      {showDropZone && (
        <div
          onClick={() => fileInputRef.current?.click()}
          style={{
            marginTop: 16,
            border: `2px dashed ${C.borderLt}`,
            borderRadius: 2,
            padding: "24px 20px",
            textAlign: "center",
            cursor: "pointer",
            background: C.accentBg,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = C.accent + "88";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = C.borderLt;
          }}
        >
          <div style={{ fontSize: 20, marginBottom: 6 }}>↑</div>
          <div style={{ fontSize: 12, color: C.textSec, marginBottom: 4 }}>
            Drop files here to upload
          </div>
          <div style={{ fontSize: 10, color: C.muted }}>
            Supports: .csv, .xlsx
          </div>
        </div>
      )}
    </div>
  );
}
