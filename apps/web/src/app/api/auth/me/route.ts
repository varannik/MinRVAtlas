import { cookies } from "next/headers";

import { publicSession, SESSION_COOKIE, sessionSecret, unsealSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const jar = await cookies();
  const session = await unsealSession(jar.get(SESSION_COOKIE)?.value, sessionSecret());
  if (!session) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "cache-control": "private, no-store" } },
    );
  }
  return Response.json(publicSession(session), {
    headers: { "cache-control": "private, no-store" },
  });
}
