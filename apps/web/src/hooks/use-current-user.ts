"use client";

import { useEffect, useState } from "react";

export type CurrentUser = {
  email: string;
  name?: string;
  tenantId: string;
  role: string;
};

let cached: CurrentUser | null = null;

/** The signed-in user from the session cookie (read once per page load). */
export function useCurrentUser(): CurrentUser | null {
  const [user, setUser] = useState<CurrentUser | null>(cached);

  useEffect(() => {
    if (cached) return;
    const controller = new AbortController();
    fetch("/api/auth/me", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: CurrentUser | null) => {
        if (!payload) return;
        cached = payload;
        setUser(payload);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  return user;
}
