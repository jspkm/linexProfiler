import { useState, useEffect, useRef, useCallback } from "react";

export function useSplitPane() {
  const [splitRatio, setSplitRatio] = useState(50);
  const [isResizingSplit, setIsResizingSplit] = useState(false);
  const [isDesktopViewport, setIsDesktopViewport] = useState(false);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(min-width: 768px)");
    const syncViewport = () => setIsDesktopViewport(media.matches);
    syncViewport();
    media.addEventListener("change", syncViewport);
    return () => media.removeEventListener("change", syncViewport);
  }, []);

  useEffect(() => {
    if (isDesktopViewport) return;
    // Reset split state when viewport shrinks to mobile — intentional synchronous update
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsResizingSplit(false);
    setSplitRatio(50);
  }, [isDesktopViewport]);

  useEffect(() => {
    if (!isResizingSplit || !isDesktopViewport) return;

    const onMouseMove = (event: MouseEvent) => {
      const container = splitContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) return;
      const pct = ((event.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.min(75, Math.max(25, pct));
      setSplitRatio(clamped);
    };

    const onMouseUp = () => setIsResizingSplit(false);

    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isDesktopViewport, isResizingSplit]);

  const startSplitResize = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!isDesktopViewport) return;
    event.preventDefault();
    setIsResizingSplit(true);
  }, [isDesktopViewport]);

  return {
    splitRatio,
    isResizingSplit,
    isDesktopViewport,
    splitContainerRef,
    startSplitResize,
  };
}
