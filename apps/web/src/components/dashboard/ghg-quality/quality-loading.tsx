export function QualityLoading() {
  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col items-center justify-center px-8 text-center">
      <span className="size-2.5 animate-pulse rounded-full bg-carbon-400" />
      <p className="mt-3 max-w-lg text-[13px] font-semibold text-frost">
        Running data quality, anomaly, and registry checks…
      </p>
      <p className="mt-2 max-w-md text-[11px] leading-relaxed text-mist">
        One pipeline job. The steps below are a review walk through the same
        result — this screen stays here until Sentinel finishes.
      </p>
    </div>
  );
}
