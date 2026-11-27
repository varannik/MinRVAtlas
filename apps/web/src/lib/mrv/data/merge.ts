import { addDays } from "../days";
import type { MrvDataset } from "../types";

/**
 * A project with loaded monitoring data, shown with its sample history before the
 * first loaded day: the sample's days, its periods that end before then, and its
 * dated values cut off the day before. From the first loaded day on, only loaded
 * data counts, so no sample number reaches a loaded period's calculation. The data
 * quality engine reads the stream alone and never sees the sample.
 *
 * Pure: the loader hands it both datasets.
 */
export function withSampleBefore(loaded: MrvDataset, sample: MrvDataset | null): MrvDataset {
  if (!sample || !loaded.range) return loaded;
  const first = loaded.range.start;
  const dayBefore = addDays(first, -1);
  const days = sample.days.filter((row) => row.day < first);
  if (!days.length) return loaded;
  const fixed = sample.fixed
    .filter((value) => !value.validFrom || value.validFrom < first)
    .map((value) => ({ ...value, validTo: !value.validTo || value.validTo > dayBefore ? dayBefore : value.validTo, source: `${value.source} (sample)` }));
  const blocks = sample.blocks.filter((block) => block.range.end < first);
  return {
    ...loaded,
    range: { start: days[0].day, end: loaded.range.end },
    days: [...days, ...loaded.days],
    fixed: [...fixed, ...loaded.fixed],
    blocks: [...blocks, ...loaded.blocks],
    // Every day before the first loaded one is the sample's, even one it has no rows for.
    sampleUntil: dayBefore,
    note: [`Sample history until ${dayBefore}; loaded data from ${first}.`, loaded.note].filter(Boolean).join(" "),
  };
}
