import type { ReactNode } from "react";

/** Ledger form and message styles, on the shared glass system (globals.css). */

export const fieldClass =
  "w-full rounded-xl border border-strata-300/80 bg-white/75 px-3 py-2 text-sm text-earth outline-none transition-[border-color,box-shadow] placeholder:text-strata-600 focus:border-olivine-500 focus:shadow-[0_0_0_3px_rgba(139,156,68,0.25)] disabled:opacity-50";

export const buttonClass =
  "btn-primary h-10 rounded-full px-5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olivine-500 disabled:cursor-not-allowed disabled:opacity-40";

export const quietButtonClass =
  "btn-glass h-10 rounded-full px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olivine-500 disabled:cursor-not-allowed disabled:opacity-40";

/** Labels above fields. */
export const labelClass = "block text-[11.5px] font-medium text-strata-700";

/** Ticks and radios in the accent colour. */
export const checkClass = "size-4 shrink-0 accent-olivine-700";

export function Banner({
  kind,
  children,
}: {
  kind: "info" | "error" | "ok";
  children: ReactNode;
}) {
  const tone =
    kind === "error"
      ? "bg-jasper-tint text-jasper"
      : kind === "ok"
        ? "bg-olivine-100 text-olivine-800"
        : "glass-card text-strata-700";
  return (
    <div role={kind === "error" ? "alert" : undefined} className={`rounded-2xl px-4 py-3 text-sm ${tone}`}>
      {children}
    </div>
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
    <section className="glass-card rounded-2xl p-5">
      <h2 className="mb-3 text-sm font-semibold text-earth">{title}</h2>
      {children}
    </section>
  );
}
