/** Registry quantities are integer kilograms. One credit is 1,000 kg. */
export function kgToTonnes(kg: number): number {
  return kg / 1000;
}

export function formatTonnes(kg: number): string {
  return kgToTonnes(kg).toLocaleString("en-GB", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

/**
 * Tonnes typed in the UI become integer kilograms.
 * Three decimal places is the registry's credit precision.
 */
export function tonnesInputToKg(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,3})?$/.test(trimmed)) return null;
  const kg = Math.round(Number(trimmed) * 1000);
  if (!Number.isSafeInteger(kg) || kg < 1) return null;
  return kg;
}
