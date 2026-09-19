"use client";

import dynamic from "next/dynamic";
import { motion, useReducedMotion } from "motion/react";
import { ArrowUpRight } from "lucide-react";

const GlassAbstract = dynamic(
  () => import("./glass-abstract").then((mod) => mod.GlassAbstract),
  {
    ssr: false,
    loading: () => <div className="h-full w-full bg-[#0b0b0f]" />,
  },
);

const EASE = [0.22, 1, 0.36, 1] as const;

export function MinrvLanding({
  cognito,
  from,
  error,
  devAllowed,
  devEmail,
}: {
  cognito: boolean;
  from?: string;
  error?: string;
  devAllowed: boolean;
  devEmail?: string;
}) {
  const reduceMotion = useReducedMotion();
  const nextQuery = from ? `&from=${encodeURIComponent(from)}` : "";
  const cognitoHref = `/auth/login${from ? `?from=${encodeURIComponent(from)}` : ""}`;

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#0b0b0f] text-calcite">
      <div className="absolute inset-0">
        <GlassAbstract />
      </div>
      <div className="landing-veil pointer-events-none absolute inset-0" />

      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-end gap-2 px-5 py-4 sm:px-8">
        <div className="pointer-events-auto flex items-center gap-2">
          {error ? (
            <p className="max-w-48 truncate text-[11px] text-[#f0a89a]" title={error}>
              {error}
            </p>
          ) : null}
          {devAllowed ? (
            <a
              href={`/auth/login?dev=1${nextQuery}`}
              className="inline-flex h-8 items-center rounded-full px-3 text-[11px] font-medium text-calcite/80 ring-1 ring-calcite/25"
            >
              {devEmail}
            </a>
          ) : null}
          {cognito ? (
            <a
              href={cognitoHref}
              className="inline-flex h-8 items-center rounded-full bg-calcite px-3.5 text-[12px] font-semibold text-earth"
            >
              Sign in
            </a>
          ) : null}
          {!cognito && !devAllowed ? (
            <p className="text-[11px] text-calcite/70">Cognito is not configured</p>
          ) : null}
        </div>
      </header>

      <motion.section
        initial={reduceMotion ? false : { opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.75, ease: EASE }}
        className="pointer-events-none absolute inset-x-5 bottom-14 z-10 max-w-3xl sm:inset-x-8 sm:bottom-16"
      >
        <p className="text-[11px] font-semibold tracking-[0.32em] text-olivine uppercase">
          Digital MRV · multi-registry
        </p>
        <h1 className="font-display mt-3 text-[22vw] leading-[0.78] tracking-[-0.05em] text-calcite sm:text-[7.5rem] lg:text-[9.5rem]">
          Min<span className="italic text-olivine">RV</span>
        </h1>
        <p className="mt-5 max-w-md text-sm leading-relaxed text-calcite/80 sm:text-base">
          One operator surface for digital MRV — connected across registries,
          from project evidence to issued tonne.
        </p>
        <a
          href="https://www.4401.earth/"
          target="_blank"
          rel="noopener noreferrer"
          className="pointer-events-auto mt-6 inline-flex items-center gap-1 text-[11px] font-medium tracking-wide text-sand/90 transition-colors hover:text-calcite"
        >
          A 44.01 property
          <ArrowUpRight className="size-3.5" />
        </a>
      </motion.section>
    </main>
  );
}
