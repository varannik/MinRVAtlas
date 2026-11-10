"use client";

import { useId } from "react";

/** Tiny line chart; gaps (null) break the line instead of joining it. */
export function Sparkline({
  values,
  width = 120,
  height = 32,
  color = "#070808",
  fill = true,
  fluid = false,
  className,
}: {
  values: (number | null)[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
  /** Stretch to the container's width; drawn in a `width`-wide box. */
  fluid?: boolean;
  className?: string;
}) {
  const id = useId();
  const present = values.filter((value): value is number => value != null);
  if (present.length < 2) {
    return <svg width={width} height={height} className={className} aria-hidden />;
  }
  const min = Math.min(...present);
  const max = Math.max(...present);
  const span = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const px = (index: number) => index * step;
  const py = (value: number) => height - 2 - ((value - min) / span) * (height - 4);

  const segments: string[] = [];
  let current = "";
  values.forEach((value, index) => {
    if (value == null) {
      if (current) segments.push(current);
      current = "";
      return;
    }
    current += `${current ? "L" : "M"} ${px(index).toFixed(1)} ${py(value).toFixed(1)} `;
  });
  if (current) segments.push(current);
  const line = segments.join(" ");

  const first = values.findIndex((value) => value != null);
  let last = values.length - 1;
  while (last > 0 && values[last] == null) last -= 1;
  const area = `${line} L ${px(last).toFixed(1)} ${height} L ${px(first).toFixed(1)} ${height} Z`;

  return (
    <svg
      width={fluid ? "100%" : width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={fluid ? "none" : undefined}
      className={className}
      aria-hidden
    >
      {fill ? (
        <>
          <defs>
            <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${id})`} />
        </>
      ) : null}
      <path d={line} fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {fluid ? null : <circle cx={px(last)} cy={py(values[last] as number)} r="2" fill={color} />}
    </svg>
  );
}
