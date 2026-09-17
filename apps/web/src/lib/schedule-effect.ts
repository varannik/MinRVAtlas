/**
 * Run work after the current commit. React 19's `set-state-in-effect` rule
 * rejects setState in the effect body (including the sync prefix of an async
 * loader). Fetch-on-mount still belongs in an effect; it just cannot land in
 * the same turn as the render that scheduled it.
 */
export function scheduleEffect(task: () => void | Promise<void>): () => void {
  let cancelled = false;
  const timer = setTimeout(() => {
    if (!cancelled) void task();
  }, 0);
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}
