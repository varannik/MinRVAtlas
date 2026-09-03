const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const plain = new Intl.NumberFormat("en-US");

export function formatCompact(value: number): string {
  return compact.format(value);
}

export function formatNumber(value: number): string {
  return plain.format(value);
}

export function formatTonnes(value: number): string {
  return `${compact.format(value)} tCO₂e`;
}

export function formatArea(hectares: number): string {
  if (hectares === 0) return "Facility site";
  if (hectares < 100) return `${plain.format(hectares)} ha`;
  return `${compact.format(hectares)} ha`;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Manual formatting keeps server and client markup identical. */
export function formatIsoDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day} ${MONTHS[Number(month) - 1]} ${year}`;
}

export function formatSync(minutes: number): string {
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}
