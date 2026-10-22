import { LedgerFailure } from "@/lib/ledger/errors";
import * as ledger from "@/lib/ledger/service";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" };

function json(data: unknown, status = 200) {
  return Response.json(
    status >= 400 ? data : { success: true, data },
    { status, headers: NO_STORE },
  );
}

function failure(error: unknown) {
  if (error instanceof LedgerFailure) {
    return Response.json(
      { success: false, message: error.message, code: error.code },
      { status: error.status, headers: NO_STORE },
    );
  }
  console.error(error);
  return Response.json(
    { success: false, message: "Ledger request failed.", code: "internal" },
    { status: 500, headers: NO_STORE },
  );
}

function resourceId(value: string | undefined, label: string): string {
  if (!value || !/^[A-Za-z0-9_]+$/.test(value)) {
    throw new LedgerFailure(422, "validation", `${label} is not a registry id.`);
  }
  return value;
}

async function dispatch(request: Request, path: string[]) {
  const url = new URL(request.url);
  const [registry, resource, id, nested] = path;

  if (path.length === 1 && path[0] === "connected" && request.method === "GET") {
    return json(await ledger.readConnection());
  }
  if (path.length === 1 && path[0] === "summary" && request.method === "GET") {
    return json(await ledger.readSummary(url));
  }

  if (!registry || !resource) {
    throw new LedgerFailure(404, "not_found", "Ledger route not found.");
  }
  ledger.guardRegistry(registry);

  if (request.method === "GET" && path.length === 2 && resource === "balance") {
    return json(await ledger.readBalance());
  }
  if (request.method === "GET" && path.length === 2 && resource === "batches") {
    return json(await ledger.readBatches(url));
  }
  if (request.method === "GET" && path.length === 2 && resource === "orders") {
    return json(await ledger.readOrders(url));
  }
  if (request.method === "GET" && path.length === 2 && resource === "transferees") {
    return json(await ledger.readTransferees(url));
  }
  if (request.method === "GET" && path.length === 2 && resource === "beneficiaries") {
    return json(await ledger.readBeneficiaries(url));
  }
  if (request.method === "GET" && path.length === 2 && resource === "deliveries") {
    return json(await ledger.readDeliveries(url));
  }
  if (request.method === "POST" && path.length === 2 && resource === "deliveries") {
    return json(await ledger.deliver(request));
  }
  if (request.method === "GET" && path.length === 2 && resource === "transfers") {
    return json(await ledger.readTransfers(url));
  }
  if (request.method === "POST" && path.length === 2 && resource === "transfers") {
    return json(await ledger.transfer(request));
  }
  if (request.method === "GET" && path.length === 2 && resource === "retirements") {
    return json(await ledger.readRetirements(url));
  }
  if (request.method === "POST" && path.length === 2 && resource === "retirements") {
    return json(await ledger.retire(request));
  }
  if (request.method === "GET" && path.length === 3 && resource === "stripe" && id === "config") {
    return json(await ledger.readStripe());
  }
  if (request.method === "POST" && path.length === 3 && resource === "stripe" && id === "checkout") {
    return json(await ledger.checkout(request));
  }
  if (request.method === "GET" && path.length === 3 && resource === "credit-batches") {
    return json(await ledger.readCreditBatch(resourceId(id, "batchId")));
  }
  if (request.method === "GET" && path.length === 3 && resource === "deliveries") {
    return json(await ledger.readDelivery(resourceId(id, "deliveryId")));
  }
  if (request.method === "GET" && path.length === 3 && resource === "transfers") {
    return json(await ledger.readTransfer(resourceId(id, "transferId")));
  }
  if (request.method === "GET" && path.length === 3 && resource === "retirements") {
    return json(await ledger.readRetirement(resourceId(id, "retirementId")));
  }
  if (
    request.method === "GET" &&
    path.length === 4 &&
    nested === "credit-batches"
  ) {
    const itemId = resourceId(id, "id");
    if (resource === "deliveries") return json(await ledger.readDeliveryBatches(itemId, url));
    if (resource === "transfers") return json(await ledger.readTransferBatches(itemId, url));
    if (resource === "retirements") return json(await ledger.readRetirementBatches(itemId, url));
  }

  throw new LedgerFailure(404, "not_found", "Ledger route not found.");
}

async function handle(request: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  try {
    const { path = [] } = await ctx.params;
    return await dispatch(request, path);
  } catch (error) {
    return failure(error);
  }
}

export function GET(request: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  return handle(request, ctx);
}

export function POST(request: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  return handle(request, ctx);
}
