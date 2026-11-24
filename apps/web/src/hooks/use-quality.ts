"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { FindingStatus, QualityView } from "@/lib/quality/types";

/**
 * The data quality engine's findings for one project (/api/data-quality/<id>).
 * Starts a run when the data has moved past the last one, follows a run while it
 * goes, and records people's decisions. Kept in memory only.
 */

type Payload = QualityView & { stale?: boolean; error?: string };

export interface QualityState {
  status: "loading" | "ready" | "error";
  view: QualityView | null;
  error?: string;
  /** The finding a decision is being saved for. */
  saving: string | null;
  decide: (findingId: string, decision: FindingStatus, reason: string) => Promise<string | null>;
  rerun: () => Promise<void>;
}

const POLL_MS = 4000;
const POLL_FOR_MS = 10 * 60 * 1000;

async function call(url: string, init?: RequestInit): Promise<Payload> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const body = (await response.json().catch(() => ({}))) as Payload;
  if (!response.ok) throw new Error(body.error ?? `The quality engine answered ${response.status}.`);
  return body;
}

export function useQuality(projectId: string | null): QualityState {
  const [state, setState] = useState<{ status: QualityState["status"]; view: QualityView | null; error?: string }>({ status: "loading", view: null });
  const [saving, setSaving] = useState<string | null>(null);
  const asked = useRef<string | null>(null);
  const url = projectId ? `/api/data-quality/${encodeURIComponent(projectId)}` : null;

  const show = useCallback((payload: Payload) => setState({ status: "ready", view: payload }), []);

  // Load, and start a run once when the data has moved on.
  useEffect(() => {
    if (!url) return;
    let live = true;
    setState({ status: "loading", view: null });
    call(url)
      .then(async (payload) => {
        if (!live) return;
        show(payload);
        if (payload.available && payload.stale && asked.current !== url) {
          asked.current = url;
          const started = await call(url, { method: "POST", body: "{}" });
          if (live) show(started);
        }
      })
      .catch((error: Error) => live && setState({ status: "error", view: null, error: error.message }));
    return () => {
      live = false;
    };
  }, [show, url]);

  // Follow a run until it finishes.
  const running = Boolean(state.view?.running);
  useEffect(() => {
    if (!url || !running) return;
    const until = Date.now() + POLL_FOR_MS;
    const timer = setInterval(() => {
      if (Date.now() > until) return clearInterval(timer);
      call(url)
        .then(show)
        .catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, show, url]);

  const decide = useCallback(
    async (findingId: string, decision: FindingStatus, reason: string) => {
      if (!url) return "No project.";
      setSaving(findingId);
      try {
        show(await call(`${url}/reviews`, { method: "POST", body: JSON.stringify({ findingId, decision, reason }) }));
        return null;
      } catch (error) {
        return (error as Error).message;
      } finally {
        setSaving(null);
      }
    },
    [show, url],
  );

  const rerun = useCallback(async () => {
    if (!url) return;
    try {
      show(await call(url, { method: "POST", body: JSON.stringify({ force: true }) }));
    } catch (error) {
      setState((current) => ({ ...current, error: (error as Error).message }));
    }
  }, [show, url]);

  return { ...state, saving, decide, rerun };
}
