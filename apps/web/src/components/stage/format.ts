const whole = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const one = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 });

/** Tonnes for headlines: "12,480", "1.2M". */
export function formatTonnes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return compact.format(value);
  if (abs >= 100) return whole.format(value);
  return one.format(value);
}

/** Any calculated quantity, with digits that suit its size. */
export function formatQuantity(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs === 0) return "0";
  if (abs >= 1_000_000) return compact.format(value);
  if (abs >= 100) return whole.format(value);
  if (abs >= 1) return one.format(value);
  if (abs >= 0.01) return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  if (abs >= 0.000001) return String(Number(value.toPrecision(3)));
  return value.toExponential(2);
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** "2 min ago", "3 h ago", "4 d ago". */
export function formatAgo(iso: string | undefined, now: number): string {
  if (!iso) return "never";
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return "unknown";
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}
