"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Safari before 16.4 only has the prefixed API. */
type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => void;
};
type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => void };

function subscribe(onChange: () => void) {
  document.addEventListener("fullscreenchange", onChange);
  document.addEventListener("webkitfullscreenchange", onChange);
  return () => {
    document.removeEventListener("fullscreenchange", onChange);
    document.removeEventListener("webkitfullscreenchange", onChange);
  };
}

function current(): Element | null {
  const doc = document as FullscreenDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

function enabled(): boolean {
  const doc = document as FullscreenDocument;
  return Boolean(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
}

const never = () => () => undefined;

/**
 * Show one element on the whole screen, and come back. Esc leaves full screen
 * too (the browser does that), and the page is where it was.
 * `supported` is false where the browser cannot (an iPhone, or a frame without
 * allowfullscreen), so the button can stay hidden.
 */
export function useFullscreen(element: HTMLElement | null) {
  const active = useSyncExternalStore(subscribe, current, () => null);
  const supported = useSyncExternalStore(never, enabled, () => false);
  const on = Boolean(element) && active === element;

  const toggle = useCallback(() => {
    if (!element) return;
    const doc = document as FullscreenDocument;
    if (current()) {
      const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen;
      void Promise.resolve(exit?.call(doc)).catch(() => undefined);
      return;
    }
    const target = element as FullscreenElement;
    const request = target.requestFullscreen ?? target.webkitRequestFullscreen;
    void Promise.resolve(request?.call(target)).catch(() => undefined);
  }, [element]);

  return { on, supported, toggle };
}
