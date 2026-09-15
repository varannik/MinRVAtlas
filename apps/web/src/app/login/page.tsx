import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { getCognitoConfig } from "@/lib/auth/cognito-config";
import {
  isDevAuthAllowed,
  SESSION_COOKIE,
  safeReturnPath,
  sessionSecret,
  unsealSession,
} from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; from?: string }>;
}) {
  const { error, from } = await searchParams;
  const host = (await headers()).get("host")?.split(":")[0] ?? "";
  const existing = await unsealSession(
    (await cookies()).get(SESSION_COOKIE)?.value,
    sessionSecret(),
  );
  if (existing) {
    redirect(safeReturnPath(from));
  }
  const cognito = getCognitoConfig();
  const devAllowed = isDevAuthAllowed(host) && Boolean(process.env.AUTH_DEV_USER?.trim());
  const devEmail = process.env.AUTH_DEV_USER?.trim();
  const nextQuery = from ? `&from=${encodeURIComponent(from)}` : "";

  return (
    <main className="grid h-full place-items-center px-6">
      <div className="glass w-full max-w-md rounded-3xl p-8">
        <p className="text-[10px] font-semibold tracking-[0.2em] text-mist uppercase">
          3DMinRV
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-mist">
          Operator access to the control room and Quality Console. Invite only.
        </p>

        {error ? (
          <p className="mt-4 rounded-2xl bg-signal-rose/10 px-3 py-2 text-sm text-signal-rose">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col gap-3">
          {cognito ? (
            <a
              href={`/auth/login${from ? `?from=${encodeURIComponent(from)}` : ""}`}
              className="grid h-12 place-items-center rounded-2xl bg-carbon-400 text-sm font-semibold text-off-white"
            >
              Continue with Cognito
            </a>
          ) : null}
          {devAllowed ? (
            <a
              href={`/auth/login?dev=1${nextQuery}`}
              className="grid h-12 place-items-center rounded-2xl ring-1 ring-line text-sm font-semibold text-frost"
            >
              Continue as {devEmail}
            </a>
          ) : null}
          {!cognito && !devAllowed ? (
            <p className="text-sm text-mist">
              Cognito is not in this environment yet. On localhost set{" "}
              <code className="text-frost">AUTH_DEV_USER</code> after the identity
              stack is defined, or wait for <code className="text-frost">make deploy</code>.
            </p>
          ) : null}
        </div>
      </div>
    </main>
  );
}
