"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { motion, useReducedMotion } from "motion/react";
import { ArrowUpRight } from "lucide-react";

import { LandingSignIn } from "./landing-sign-in";

const GlassAbstract = dynamic(
  () => import("./glass-abstract").then((mod) => mod.GlassAbstract),
  {
    ssr: false,
    loading: () => <div className="h-full w-full bg-transparent" />,
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
  const [loginOpen, setLoginOpen] = useState(Boolean(error));

  return (
    <main className="fixed inset-0 overflow-hidden bg-rock text-calcite">
      <div className="landing-stage pointer-events-none absolute inset-0">
        <div className="landing-soil absolute inset-0" aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/textures/mineral-crackle.jpg"
            alt=""
            className="landing-soil-photo"
            draggable={false}
          />
          <div className="landing-soil-tint" />
          <div className="landing-soil-grime" />
        </div>
        <motion.div
          className="landing-spline absolute inset-0 origin-center"
          animate={
            reduceMotion
              ? undefined
              : loginOpen
                ? { scale: 1.04 }
                : { scale: 1 }
          }
          transition={{ duration: 1.35, ease: EASE }}
        >
          <GlassAbstract centered={loginOpen} instant={Boolean(reduceMotion)} />
        </motion.div>
      </div>
      <div className="landing-veil pointer-events-none absolute inset-0 z-[2]" />

      <motion.section
        initial={reduceMotion ? false : { opacity: 0, x: -18 }}
        animate={{ opacity: loginOpen ? 0 : 1, x: loginOpen ? -24 : 0 }}
        transition={{ duration: 0.85, ease: EASE }}
        className="pointer-events-none absolute top-1/2 left-6 z-10 w-[min(38rem,86vw)] -translate-y-1/2 sm:left-10 lg:left-16"
      >
        <p className="text-[11px] font-semibold tracking-[0.36em] text-olivine uppercase">
          From Carbon Removal to Certified Credits.
        </p>
        <h1 className="font-display mt-4 text-[18vw] leading-[0.78] tracking-[-0.05em] text-calcite sm:text-[6.6rem] lg:text-[8.4rem]">
          Min<span className="italic text-olivine">RV</span>
        </h1>
        <p className="mt-6 max-w-sm text-sm leading-relaxed text-calcite/80 sm:text-[1.05rem]">
          Digital MRV for Suppliers: quality intelligence on project evidence,
          a clear path to registry submission — across every registry we
          run.
        </p>
        {cognito || devAllowed ? (
          <button
            type="button"
            data-front="Log in"
            data-back="Remove Co2"
            aria-label="Log in"
            onClick={() => setLoginOpen(true)}
            className={`btn-flip pointer-events-auto mt-8${loginOpen ? " is-flipped" : ""}`}
          />
        ) : (
          <p className="mt-8 text-[11px] text-calcite/70">Cognito is not configured</p>
        )}
        <a
          href="https://www.4401.earth/"
          target="_blank"
          rel="noopener noreferrer"
          className="pointer-events-auto mt-6 inline-flex items-center gap-1 text-[11px] font-medium tracking-[0.18em] text-sand/90 uppercase transition-colors hover:text-calcite"
        >
          44.01 Digitalisation team
          <ArrowUpRight className="size-3.5" />
        </a>
      </motion.section>

      <LandingSignIn
        open={loginOpen}
        from={from}
        error={error}
        cognito={cognito}
        devAllowed={devAllowed}
        devEmail={devEmail}
        onClose={() => setLoginOpen(false)}
      />
    </main>
  );
}
