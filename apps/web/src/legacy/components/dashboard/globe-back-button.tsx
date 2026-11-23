"use client";

import { useId } from "react";
import { ArrowLeft } from "lucide-react";

export function Globe3DMark() {
  const id = useId();
  const ball = `${id}-ball`;
  const shade = `${id}-shade`;
  const shine = `${id}-shine`;
  const land = `${id}-land`;

  return (
    <span
      className="relative grid size-8 place-items-center"
      style={{ perspective: "72px" }}
      aria-hidden
    >
      <svg
        viewBox="0 0 32 32"
        className="size-8 drop-shadow-[1px_3px_3px_rgba(7,8,8,0.28)]"
        style={{ transform: "rotateX(14deg) rotateY(-24deg)" }}
      >
        <defs>
          <radialGradient id={ball} cx="34%" cy="28%" r="72%">
            <stop offset="0%" stopColor="#eef2c4" />
            <stop offset="38%" stopColor="#9aaa4e" />
            <stop offset="78%" stopColor="#4d5a24" />
            <stop offset="100%" stopColor="#2c3414" />
          </radialGradient>
          <radialGradient id={shade} cx="70%" cy="78%" r="55%">
            <stop offset="0%" stopColor="#070808" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#070808" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={shine} cx="30%" cy="22%" r="42%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.72" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <clipPath id={land}>
            <circle cx="16" cy="16" r="11.2" />
          </clipPath>
        </defs>
        <ellipse cx="17.2" cy="18.4" rx="11.4" ry="3.2" fill="#070808" opacity="0.18" />
        <circle cx="16" cy="16" r="11.2" fill={`url(#${ball})`} />
        <g
          clipPath={`url(#${land})`}
          fill="#3d4a1c"
          fillOpacity="0.55"
          stroke="#2a3314"
          strokeWidth="0.35"
        >
          <path d="M10.2 9.4c1.6-.4 3.1.3 4.4 1.2 1.1.8 2.4.6 3.5.1 1.4-.6 2.8.2 3.6 1.4.7 1.1.4 2.5-.4 3.4-.9 1-1 2.4-.3 3.5.6.9.6 2.1-.1 2.9-1.1 1.2-2.9 1.2-4.2.3-1.2-.8-2.7-.9-4-.3-1.4.7-3.1.2-4-1.1-.8-1.1-.5-2.6.5-3.5.9-.8 1-2.1.4-3.2-.7-1.2-.4-2.8.6-3.7z" />
          <path d="M20.8 20.2c1.2.2 2.4 1 2.8 2.1.3.9-.2 1.9-1 2.3-1.1.6-2.4.1-3.1-.8-.6-.8-.4-1.9.3-2.5.3-.3.7-.8 1-.1z" />
        </g>
        <ellipse
          cx="16"
          cy="16"
          rx="5.1"
          ry="11.2"
          fill="none"
          stroke="#070808"
          strokeOpacity="0.22"
          strokeWidth="0.9"
        />
        <ellipse
          cx="16"
          cy="16"
          rx="11.2"
          ry="4.1"
          fill="none"
          stroke="#070808"
          strokeOpacity="0.22"
          strokeWidth="0.9"
        />
        <ellipse
          cx="16"
          cy="16"
          rx="11.2"
          ry="8.2"
          fill="none"
          stroke="#070808"
          strokeOpacity="0.12"
          strokeWidth="0.7"
        />
        <circle cx="16" cy="16" r="11.2" fill={`url(#${shade})`} />
        <circle cx="16" cy="16" r="11.2" fill={`url(#${shine})`} />
        <circle
          cx="16"
          cy="16"
          r="11.2"
          fill="none"
          stroke="#eadac7"
          strokeOpacity="0.45"
          strokeWidth="0.8"
        />
      </svg>
      <span className="absolute -bottom-0.5 -left-0.5 grid size-3.5 place-items-center rounded-full bg-white ring-1 ring-line">
        <svg viewBox="0 0 12 12" className="size-2.5" aria-hidden>
          <path
            d="M7.2 2.2 3.4 6l3.8 3.8"
            fill="none"
            stroke="#070808"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </span>
  );
}

export function GlobeBackButton({
  onClick,
  toRequirements,
}: {
  onClick: () => void;
  toRequirements: boolean;
}) {
  const label = toRequirements ? "Back to requirements" : "Back to world map";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="glass pointer-events-auto relative z-40 grid size-12 shrink-0 place-items-center rounded-2xl text-frost transition-transform hover:bg-white hover:scale-[1.04]"
    >
      {toRequirements ? <ArrowLeft className="size-5" /> : <Globe3DMark />}
    </button>
  );
}
