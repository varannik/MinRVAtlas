"use client";

import { useMemo } from "react";
import { Box } from "lucide-react";
import { useNow } from "@/hooks/use-now";
import { formatDay } from "@/lib/mrv/days";
import { pulseReadingsFor, pulseState, type PulseReading, type PulseState } from "@/lib/mrv/pulse";
import type { DailyMetrics, MrvDataset } from "@/lib/mrv/types";
import { siteLayoutFor } from "@/lib/site-layouts";
import { useDashboard } from "@/store/dashboard-store";
import { formatAgo, formatTonnes } from "../format";
import { useStageContext } from "../ledger-context";
import { Sparkline } from "../sparkline";
import { StageCard } from "./stage-card";

/**
 * The site in three numbers: CO₂ stored on the last reported day, then the
 * site's two lead sensors (its 3D model lists them first). Everything else
 * lives in the 3D chain, which the card opens.
 */

const SENSOR_COUNT = 2;
const TREND_DAYS = 30;

const STATE_COLOR: Record<PulseState, string> = {
  ok: "#8B9C44",
  warn: "#E8923A",
  alarm: "#9C3A2F",
};

function readingValue(row: DailyMetrics | undefined, reading: PulseReading): number | null {
  const cell = row?.metrics[reading.metric];
  if (!cell || cell.count === 0) return null;
  return cell[reading.aggregate];
}

function feedBadge(dataset: MrvDataset | null, now: number) {
  if (!dataset || dataset.origin === "none") return { label: "No feed", className: "bg-ink-700 text-mist", live: false };
  if (dataset.origin === "sample") return { label: "Sample feed", className: "bg-canyon/15 text-signal-amber", live: true };
  const fresh = now > 0 && dataset.latestAt != null && now - Date.parse(dataset.latestAt) < 15 * 60_000;
  return fresh
    ? { label: "Live", className: "bg-carbon-400/15 text-carbon-400", live: true }
    : { label: `Last data ${formatAgo(dataset.latestAt, now)}`, className: "bg-ink-700 text-mist", live: false };
}

export function PulseCard() {
  const { project, ledger } = useStageContext();
  const { dataset, daily, spec } = ledger;
  const openSite = useDashboard((state) => state.openSite);
  const now = useNow(30_000);
  const layout = siteLayoutFor(project.id);
  const sensors = useMemo(() => pulseReadingsFor(project.id, spec).slice(0, SENSOR_COUNT), [project.id, spec]);

  const latestRow = dataset?.days[dataset.days.length - 1];
  const lastPoint = [...daily].reverse().find((point) => point.value != null || point.proxy != null);
  const trend = daily.slice(-TREND_DAYS).map((point) => point.value ?? point.proxy);
  const net = lastPoint?.value != null;

  return (
    <StageCard
      side="right"
      eyebrow="Site pulse"
      badge={{ ...feedBadge(dataset, now), title: dataset?.note }}
      title={layout?.name ?? project.name}
      subtitle={`${project.region}, ${project.country}`}
      hero={{
        label: `CO₂ stored${lastPoint ? ` · ${formatDay(lastPoint.day)}` : ""}`,
        value: formatTonnes(lastPoint?.value ?? lastPoint?.proxy ?? null),
        unit: "t",
        caption: !lastPoint
          ? "Waiting for the first stream rows"
          : `${net ? "Net removal that day" : "Gross — net awaits inputs"} · ${TREND_DAYS}-day trend`,
      }}
      visual={<Sparkline values={trend} width={300} height={44} color="#6C7A31" fluid />}
      metrics={sensors.map((reading) => {
        const value = readingValue(latestRow, reading);
        return {
          label: reading.label,
          value: value == null ? "—" : value.toLocaleString("en-GB", { maximumFractionDigits: reading.decimals, minimumFractionDigits: reading.decimals }),
          unit: reading.unit,
          hint: reading.place,
          color: value == null ? "#D2C8B0" : STATE_COLOR[pulseState(reading, value)],
        };
      })}
      preview={
        layout ? (
          <span className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-105" style={{ backgroundImage: `url(${layout.photo.src})` }} />
        ) : (
          <span className="absolute inset-0 grid place-items-center text-white/30">
            <Box className="size-8" />
          </span>
        )
      }
      cta={
        layout
          ? { label: "Open 3D chain", detail: `${layout.objects.length} objects · ${layout.flows.length} flows${layout.subsurface ? " · subsurface" : ""}` }
          : { label: "No 3D chain yet", detail: "Add a site layout to build the digital twin" }
      }
      onOpen={layout ? openSite : undefined}
    />
  );
}
