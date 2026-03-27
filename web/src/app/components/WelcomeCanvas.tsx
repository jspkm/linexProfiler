"use client";

import { type View } from "./theme";

interface WelcomeCanvasProps {
  goTo: (view: View) => void;
}

export default function WelcomeCanvas({ goTo: _goTo }: WelcomeCanvasProps) {
  return <div style={{ height: "100%", overflow: "auto" }} />;
}
