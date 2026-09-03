import { spawnSync } from "node:child_process";

const TRANSIENT = [
  "ETIMEDOUT",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "ECONNREFUSED",
  "socket hang up",
  "TimeoutError",
  "RequestTimeout",
  "NetworkingError",
  "UnknownEndpoint",
  "Throttling",
  "TooManyRequestsException",
  "SlowDown",
  "Service Unavailable",
  "connection reset",
  "Client network socket disconnected",
  "Could not connect to the endpoint",
  "TLS connection was reset",
  "Killed by signal",
];

const TRANSIENT_CODE = /\b(429|503)\b/;

const FATAL = [
  "AccessDenied",
  "UnauthorizedOperation",
  "ExpiredToken",
  "InvalidClientTokenId",
  "Could not load credentials",
  "SignatureDoesNotMatch",
  // Substring of ENOTFOUND otherwise treats missing ECR tags as a network blip.
  "ImageNotFoundException",
];

export function isTransient(text: string): boolean {
  const lower = text.toLowerCase();
  if (FATAL.some((f) => text.includes(f))) {
    return false;
  }
  return (
    TRANSIENT.some((t) => lower.includes(t.toLowerCase())) || TRANSIENT_CODE.test(text)
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function backoffMs(attempt: number, base = 20_000, cap = 180_000): number {
  return Math.min(cap, base * 2 ** attempt);
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function run(
  command: string,
  args: string[],
  opts: { cwd?: string; inherit?: boolean; env?: NodeJS.ProcessEnv } = {},
): RunResult {
  const result = spawnSync(command, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    encoding: "utf-8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: opts.inherit ? "inherit" : "pipe",
  });
  const signalNote = result.signal ? `\nKilled by signal ${result.signal}` : "";
  return {
    code: result.status ?? 1,
    stdout: result.stdout?.toString() ?? "",
    stderr: `${result.stderr?.toString() ?? ""}${signalNote}`,
  };
}

export async function runWithRetry(
  command: string,
  args: string[],
  opts: {
    cwd?: string;
    inherit?: boolean;
    env?: NodeJS.ProcessEnv;
    attempts?: number;
    label?: string;
    okCodes?: number[];
  } = {},
): Promise<RunResult> {
  const attempts = opts.attempts ?? 8;
  const label = opts.label ?? `${command} ${args[0] ?? ""}`;
  const okCodes = new Set(opts.okCodes ?? [0]);
  let last: RunResult = { code: 1, stdout: "", stderr: "not started" };

  for (let i = 0; i < attempts; i++) {
    last = run(command, args, opts);
    if (okCodes.has(last.code)) {
      return last;
    }
    const blob = `${last.stdout}\n${last.stderr}`;
    if (!isTransient(blob)) {
      return last;
    }
    const wait = backoffMs(i);
    console.warn(
      `[retry] ${label} failed (attempt ${i + 1}/${attempts}, code ${last.code}). Waiting ${Math.round(wait / 1000)}s…`,
    );
    await sleep(wait);
  }
  return last;
}

export async function awsJson<T>(
  args: string[],
  opts: { allowNotFound?: boolean } = {},
): Promise<T | undefined> {
  const result = await runWithRetry("aws", [...args, "--output", "json"], {
    label: `aws ${args.slice(0, 2).join(" ")}`,
    attempts: 6,
  });
  const blob = `${result.stdout}\n${result.stderr}`;
  if (result.code !== 0) {
    if (
      opts.allowNotFound &&
      /not found|does not exist|NoSuchEntity|ValidationError|ResourceNotFoundException/i.test(
        blob,
      )
    ) {
      return undefined;
    }
    throw new Error(`aws ${args.join(" ")} failed (${result.code}): ${blob.slice(0, 2000)}`);
  }
  const text = result.stdout.trim();
  if (!text) {
    return undefined;
  }
  return JSON.parse(text) as T;
}
