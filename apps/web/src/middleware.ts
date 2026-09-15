import { NextResponse, type NextRequest } from "next/server";

import {
  SESSION_COOKIE,
  isPublicAuthPath,
  requestOrigin,
  sessionSecret,
  unsealSession,
} from "@/lib/auth/session";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicAuthPath(pathname)) {
    return NextResponse.next();
  }

  const session = await unsealSession(
    request.cookies.get(SESSION_COOKIE)?.value,
    sessionSecret(),
  );
  if (session) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "cache-control": "private, no-store" } },
    );
  }

  const login = new URL("/login", requestOrigin(request));
  if (pathname !== "/") {
    login.searchParams.set("from", pathname);
  }
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
