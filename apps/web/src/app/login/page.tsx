import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { MinrvLanding } from "@/components/landing/minrv-landing";
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

  return (
    <MinrvLanding
      cognito={Boolean(cognito)}
      from={from}
      error={error}
      devAllowed={devAllowed}
      devEmail={devEmail}
    />
  );
}
