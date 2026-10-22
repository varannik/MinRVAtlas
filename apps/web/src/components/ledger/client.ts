export async function ledgerRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as {
    success?: boolean;
    data?: T;
    message?: string;
    error?: string;
    code?: string;
  } | null;
  if (!response.ok || !body?.success) {
    const error = new Error(body?.message || body?.error || "Ledger request failed.") as Error & {
      status?: number;
      code?: string;
    };
    error.status = response.status;
    error.code = body?.code;
    throw error;
  }
  return body.data as T;
}
