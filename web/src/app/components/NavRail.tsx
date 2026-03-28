"use client";

import { useState } from "react";
import { C, type View } from "./theme";

interface NavRailProps {
  view: View;
  setView: (v: View) => void;
}

const items: { id: View; icon: string; label: string }[] = [
  { id: "terminal", icon: "⌂", label: "Home" },
  { id: "workflow", icon: "◇", label: "Workflow" },
  { id: "dataroom", icon: "📁", label: "Dataroom" },
];

export default function NavRail({ view, setView }: NavRailProps) {
  const [logoHover, setLogoHover] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  return (
    <div
      style={{
        width: 44,
        background: "rgba(8,11,10,0.95)",
        borderRight: `1px solid ${C.border}`,
        padding: "14px 5px",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        gap: 2,
        position: "relative",
        zIndex: 10,
      }}
    >
      {/* LX Logo with hover label */}
      <div
        onMouseEnter={() => setLogoHover(true)}
        onMouseLeave={() => setLogoHover(false)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 14,
          cursor: "default",
          position: "relative",
          overflow: "visible",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/favicon.svg"
          alt="LX"
          style={{
            width: 28,
            height: 28,
            flexShrink: 0,
            borderRadius: 4,
          }}
        />
        {logoHover && (
          <div
            style={{
              position: "absolute",
              left: "calc(100% + 8px)",
              top: "50%",
              transform: "translateY(-50%)",
              whiteSpace: "nowrap",
              zIndex: 1001,
              background: C.bg,
              display: "flex",
              alignItems: "center",
              height: 28,
              padding: "0 12px",
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: C.accent,
                letterSpacing: "0.08em",
              }}
            >
              LINEX Terminal
            </span>
          </div>
        )}
      </div>

      {/* Nav Items */}
      {items.map((it) => (
        <div
          key={it.id}
          onClick={() => setView(it.id)}
          onMouseEnter={() => setHoveredItem(it.id)}
          onMouseLeave={() => setHoveredItem(null)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "8px 4px",
            borderRadius: 2,
            cursor: "pointer",
            fontSize: 14,
            position: "relative",
            background: view === it.id ? "rgba(113,124,119,0.24)" : "transparent",
            border: view === it.id ? `1px solid ${C.accent}55` : "1px solid transparent",
            color: view === it.id ? C.text : C.muted,
          }}
        >
          {it.icon}
          {hoveredItem === it.id && (
            <div
              style={{
                position: "absolute",
                left: "calc(100% + 8px)",
                top: "50%",
                transform: "translateY(-50%)",
                whiteSpace: "nowrap",
                zIndex: 1001,
                background: C.bg,
                height: 28,
                display: "flex",
                alignItems: "center",
                padding: "0 12px",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: C.textSec,
                  letterSpacing: "0.06em",
                }}
              >
                {it.label}
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
