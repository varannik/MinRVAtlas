"use client";

import { motion, useReducedMotion } from "motion/react";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
  title?: string;
}

/**
 * A glass segmented control: a recessed track with a white thumb that slides to
 * the chosen option. Used for registry filters across the app.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  thumbId,
}: {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group. */
  label: string;
  /** Unique per control on a page, so thumbs do not fly between controls. */
  thumbId: string;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="glass-well grid gap-1 rounded-full p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={option.disabled}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={`relative h-8 truncate rounded-full px-2 text-[12px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olivine-500 disabled:cursor-not-allowed disabled:opacity-45 ${
              active ? "text-earth" : "text-strata-700 enabled:hover:text-earth"
            }`}
          >
            {active ? (
              <motion.span
                layoutId={thumbId}
                aria-hidden
                className="glass-thumb absolute inset-0 rounded-full"
                transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 40 }}
              />
            ) : null}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
