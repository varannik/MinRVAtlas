import type { NextRequest } from "next/server";

import { proxySentinel } from "@/lib/sentinel/proxy";

/**
 * Allowlisted BFF onto Data Sentinel FastAPI.
 * The browser never holds SENTINEL_SERVICE_TOKEN or Isometric secrets.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  return proxySentinel(request);
}

export async function HEAD(request: NextRequest) {
  return proxySentinel(request);
}

export async function POST(request: NextRequest) {
  return proxySentinel(request);
}

export async function PUT(request: NextRequest) {
  return proxySentinel(request);
}

export async function PATCH(request: NextRequest) {
  return proxySentinel(request);
}

export async function DELETE(request: NextRequest) {
  return proxySentinel(request);
}
