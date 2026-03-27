"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { C } from "./theme";

interface DropdownOption {
  value: string;
  label: string;
  description?: string;
}

interface DropdownProps {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  title?: string;
  className?: string;
  mono?: boolean;
}

export default function Dropdown({ value, options, onChange, title, className = "", mono }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={title}
        className={`w-full flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-xs text-left truncate ${mono ? "font-mono" : ""}`}
        style={{ borderColor: C.border, background: C.surface, color: C.textSec }}
      >
        <span className="truncate">{selected?.label || value || "—"}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
      </button>

      {open && (
        <div
          className="absolute left-0 top-[calc(100%+4px)] z-50 w-full min-w-50 rounded-md border py-1 shadow-lg overflow-auto max-h-[280px]"
          style={{ borderColor: C.border, background: C.panel }}
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-xs hover:bg-[${C.surfaceLt}] transition-colors ${mono ? "font-mono" : ""}`}
              style={{
                color: opt.value === value ? C.text : C.textSec,
                background: opt.value === value ? C.surface : "transparent",
              }}
              onMouseEnter={(e) => { if (opt.value !== value) e.currentTarget.style.background = C.surfaceLt; }}
              onMouseLeave={(e) => { if (opt.value !== value) e.currentTarget.style.background = "transparent"; }}
            >
              <div className="font-semibold truncate">{opt.label}</div>
              {opt.description && (
                <div className="mt-0.5 text-[10px] opacity-60 leading-snug">{opt.description}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
