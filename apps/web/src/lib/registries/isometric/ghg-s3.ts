import "server-only";

import { assembleWideCsv, type StreamAttributes, type StreamObservation } from "@/lib/stream-coverage";

export function assemblePeriodCsv(
  observations: StreamObservation[],
  attributes: StreamAttributes,
  from: string,
  to: string,
): string {
  return assembleWideCsv(observations, attributes, from, to);
}
