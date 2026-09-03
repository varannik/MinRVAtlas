"use client";

import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-frost">
          {title}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-mist">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Button({
  children,
  onClick,
  type = "button",
  tone = "default",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  tone?: "default" | "primary" | "danger";
  disabled?: boolean;
}) {
  const tones = {
    default:
      "border-line bg-ink-800 text-frost hover:bg-ink-700",
    primary:
      "border-carbon-400 bg-carbon-400 text-off-white hover:opacity-90",
    danger:
      "border-signal-rose/40 bg-signal-rose/10 text-signal-rose hover:bg-signal-rose/20",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

export function Banner({
  kind,
  children,
}: {
  kind: "error" | "ok" | "info";
  children: ReactNode;
}) {
  const cls =
    kind === "error"
      ? "border-signal-rose/40 bg-signal-rose/10 text-signal-rose"
      : kind === "ok"
        ? "border-carbon-400/40 bg-carbon-400/10 text-carbon-400"
        : "border-line bg-ink-800 text-mist";
  return (
    <div className={`mb-4 rounded-xl border px-3 py-2 text-sm ${cls}`}>
      {children}
    </div>
  );
}

export function Pill({
  children,
  tone = "mist",
}: {
  children: ReactNode;
  tone?: "mist" | "ok" | "warn" | "bad" | "sky";
}) {
  const tones = {
    mist: "bg-ink-700 text-mist",
    ok: "bg-carbon-400/15 text-carbon-400",
    warn: "bg-signal-amber/15 text-signal-amber",
    bad: "bg-signal-rose/15 text-signal-rose",
    sky: "bg-signal-sky/15 text-signal-sky",
  };
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function severityTone(
  severity: string,
): "ok" | "warn" | "bad" | "mist" | "sky" {
  const value = severity.toLowerCase();
  if (value === "critical" || value === "failed" || value === "high") {
    return "bad";
  }
  if (value === "medium" || value === "warning") return "warn";
  if (value === "passed" || value === "completed" || value === "low") {
    return "ok";
  }
  if (value === "info") return "sky";
  return "mist";
}

export function DataTable({
  columns,
  rows,
  empty,
}: {
  columns: string[];
  rows: ReactNode[][];
  empty: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-ink-800 px-4 py-10 text-center text-sm text-mist">
        {empty}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-line">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <thead className="bg-ink-900 text-[10px] tracking-[0.12em] text-mist uppercase">
          <tr>
            {columns.map((column) => (
              <th key={column} className="px-3 py-2.5 font-semibold">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, index) => (
            <tr
              key={index}
              className="border-t border-line/80 odd:bg-ink-900/40"
            >
              {cells.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-2.5 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-semibold tracking-[0.12em] text-mist uppercase">
        {label}
      </span>
      {children}
    </label>
  );
}

export const inputClass =
  "w-full rounded-xl border border-line bg-ink-800 px-3 py-2 text-sm text-frost outline-none focus:border-carbon-400/50";

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-rock/40"
        onClick={onClose}
      />
      <div className="relative z-10 max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-ink-800 p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-frost">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line px-2 py-0.5 text-mist hover:text-frost"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
