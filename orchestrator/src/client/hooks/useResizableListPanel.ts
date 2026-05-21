import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_WIDTH_KEY = "jobops:listPanel:width";
const STORAGE_VISIBLE_KEY = "jobops:listPanel:visible";

export const LIST_PANEL_MIN_WIDTH = 280;
export const LIST_PANEL_MAX_WIDTH = 720;
export const LIST_PANEL_DEFAULT_WIDTH = 400;

const CLICK_DRAG_THRESHOLD_PX = 3;

function clampWidth(value: number): number {
  if (!Number.isFinite(value)) return LIST_PANEL_DEFAULT_WIDTH;
  return Math.min(
    LIST_PANEL_MAX_WIDTH,
    Math.max(LIST_PANEL_MIN_WIDTH, Math.round(value)),
  );
}

function readInitialWidth(): number {
  if (typeof window === "undefined") return LIST_PANEL_DEFAULT_WIDTH;
  const raw = window.localStorage.getItem(STORAGE_WIDTH_KEY);
  if (!raw) return LIST_PANEL_DEFAULT_WIDTH;
  return clampWidth(Number.parseInt(raw, 10));
}

function readInitialVisible(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(STORAGE_VISIBLE_KEY) !== "false";
}

interface UseResizableListPanelResult {
  width: number;
  isVisible: boolean;
  isDragging: boolean;
  toggleVisible: () => void;
  setVisible: (visible: boolean) => void;
  startDrag: (event: React.PointerEvent<HTMLElement>) => void;
}

export function useResizableListPanel(): UseResizableListPanelResult {
  const [width, setWidth] = useState<number>(readInitialWidth);
  const [isVisible, setIsVisible] = useState<boolean>(readInitialVisible);
  const [isDragging, setIsDragging] = useState(false);
  const widthRef = useRef(width);

  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_WIDTH_KEY, String(width));
  }, [width]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_VISIBLE_KEY, String(isVisible));
  }, [isVisible]);

  const toggleVisible = useCallback(() => {
    setIsVisible((prev) => !prev);
  }, []);

  const setVisible = useCallback((value: boolean) => {
    setIsVisible(value);
  }, []);

  const startDrag = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = widthRef.current;
      let moved = false;

      const handleMove = (e: PointerEvent) => {
        const delta = e.clientX - startX;
        if (!moved) {
          if (Math.abs(delta) < CLICK_DRAG_THRESHOLD_PX) return;
          moved = true;
          setIsDragging(true);
          document.body.style.userSelect = "none";
          document.body.style.cursor = "col-resize";
        }
        setWidth(clampWidth(startWidth + delta));
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", handleUp);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        if (moved) setIsDragging(false);
      };

      const handleUp = () => {
        cleanup();
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
      window.addEventListener("pointercancel", handleUp);
    },
    [],
  );

  return {
    width,
    isVisible,
    isDragging,
    toggleVisible,
    setVisible,
    startDrag,
  };
}
