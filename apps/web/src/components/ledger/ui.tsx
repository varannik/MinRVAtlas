import type { ReactNode } from "react";

export const fieldClass =
  "w-full rounded-xl border border-line bg-ink-800 px-3 py-2 text-sm text-frost outline-none focus:border-carbon-400/60";

export const buttonClass =
  "rounded-xl bg-carbon-400 px-3 py-2 text-sm font-medium text-ink-950 disabled:cursor-not-allowed disabled:opacity-40";

export const quietButtonClass =
  "rounded-xl border border-line px-3 py-2 text-sm text-mist hover:text-frost disabled:opacity-40";

export function Banner({
  kind,
  children,
}: {
  kind: "info" | "error" | "ok";
  children: ReactNode;
}) {
  const tone =
    kind === "error"
      ? "border-signal-rose/40 text-signal-rose"
      : kind === "ok"
        ? "border-carbon-400/40 text-carbon-400"
        : "border-line text-mist";
  return (
    <div className={`rounded-2xl border bg-ink-900 px-4 py-3 text-sm ${tone}`}>{children}</div>
  );
}

export function Panel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-ink-900 p-4">
      <h2 className="mb-3 text-sm font-semibold text-frost">{title}</h2>
      {children}
    </section>
  );
}
