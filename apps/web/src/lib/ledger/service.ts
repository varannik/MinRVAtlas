import "server-only";

import { cookies } from "next/headers";

import {
  SESSION_COOKIE,
  sessionSecret,
  unsealSession,
  type SessionPayload,
} from "@/lib/auth/session";
import { LedgerFailure } from "@/lib/ledger/errors";
import { credentialWindow } from "@/lib/ledger/expiry";
import type {
  CreditBatchQuantity,
  CreditBatchStatus,
  LedgerConnection,
  LedgerRegistry,
  LedgerSummary,
  MutationResult,
  NormalizedCreditBalance,
  NormalizedCreditBatch,
  NormalizedOrder,
  NormalizedOrganisation,
  NormalizedTransaction,
  Page,
  RetirementPurpose,
  StripeCheckout,
  StripeConfig,
} from "@/lib/ledger/types";
import {
  isometricId,
  notesMessage,
  overQuantityMessage,
  purposesMessage,
  quantityLinesMessage,
} from "@/lib/ledger/validate";
import { findConnection } from "@/lib/registries/connections";
import { resolveOrgCredentials } from "@/lib/registries/server";
import type { OrgCredentials, RegistryEnvironment } from "@/lib/registries/types";
import * as isometric from "@/lib/registries/isometric/ledger";

const WRITE_ROLES = new Set(["platform_admin", "tenant_admin", "operator"]);

export const ISOMETRIC_CAPABILITIES = [
  "balance",
  "batches",
  "orders",
  "deliver",
  "transfer",
  "retire",
  "activity",
  "buy",
] as const;

type LedgerContext = {
  session: SessionPayload;
  environment: RegistryEnvironment;
  credentials: OrgCredentials;
  organisationId: string;
  supplierId: string | null;
};

type PageQuery = { first: number; after: string | null };

const EMPTY_PAGE = {
  nodes: [],
  totalCount: 0,
  pageInfo: {
    hasNextPage: false,
    endCursor: null,
    hasPreviousPage: false,
    startCursor: null,
  },
};

function requireSession(session: SessionPayload | null): SessionPayload {
  if (!session) {
    throw new LedgerFailure(401, "unauthorized", "Sign in to open the ledger.");
  }
  return session;
}

export async function ledgerSession(): Promise<SessionPayload> {
  const jar = await cookies();
  const session = await unsealSession(jar.get(SESSION_COOKIE)?.value, sessionSecret());
  return requireSession(session);
}

function canWrite(session: SessionPayload): boolean {
  return WRITE_ROLES.has(session.role);
}

function requireWriter(session: SessionPayload) {
  if (!canWrite(session)) {
    throw new LedgerFailure(403, "forbidden", "This role can view the ledger but cannot change it.");
  }
}

function connectionFor(session: SessionPayload) {
  return findConnection(session.tenantId, "Isometric") ?? null;
}

export async function readConnection(): Promise<LedgerConnection> {
  const session = await ledgerSession();
  const connection = connectionFor(session);
  const credentials = connection ? resolveOrgCredentials(connection) : null;
  const dates = credentials
    ? credentialWindow(credentials.accessToken, process.env.ISOMETRIC_CREDENTIAL_ISSUED_AT)
    : { issuedAt: null, expiresAt: null };
  const expiresAtMs = dates.expiresAt ? new Date(dates.expiresAt).getTime() : Number.NaN;
  const connected = Boolean(connection && credentials);
  let organisationReady = false;
  let supplierReady = false;
  let message = connected ? null : "Isometric credentials are not configured for this workspace.";
  if (connection && credentials) {
    try {
      const caller = await isometric.readCallerIdentity(connection.environment, credentials);
      organisationReady = true;
      supplierReady = Boolean(caller.supplierId);
    } catch (error) {
      message =
        error instanceof LedgerFailure
          ? error.message
          : "The Isometric connection could not be read.";
    }
  }
  return {
    registry: "isometric",
    connected,
    environment: connection?.environment ?? null,
    canWrite: connected && organisationReady && canWrite(session),
    capabilities: connected && organisationReady ? [...ISOMETRIC_CAPABILITIES] : [],
    organisationReady,
    supplierReady,
    credentialIssuedAt: dates.issuedAt,
    credentialExpiresAt: dates.expiresAt,
    credentialExpiresSoon:
      Number.isFinite(expiresAtMs) && expiresAtMs - Date.now() < 60 * 24 * 60 * 60 * 1000,
    message,
  };
}

async function context(): Promise<LedgerContext> {
  const session = await ledgerSession();
  const connection = connectionFor(session);
  const credentials = connection ? resolveOrgCredentials(connection) : null;
  if (!connection || !credentials) {
    throw new LedgerFailure(
      422,
      "not_connected",
      "Isometric credentials are not configured for this workspace.",
    );
  }
  const caller = await isometric.readCallerIdentity(connection.environment, credentials);
  return {
    session,
    environment: connection.environment,
    credentials,
    organisationId: caller.organisationId,
    supplierId: caller.supplierId,
  };
}

function requireSupplier(ctx: LedgerContext): string {
  if (!ctx.supplierId) {
    throw new LedgerFailure(
      422,
      "not_connected",
      "This Isometric connection is not a supplier, so this action is unavailable.",
    );
  }
  return ctx.supplierId;
}

function requireIsometric(registry: string): "isometric" {
  if (registry === "puro" || registry === "verra") {
    throw new LedgerFailure(
      422,
      "registry_unavailable",
      "This registry is not connected. Inventory stays on Isometric.",
    );
  }
  if (registry !== "isometric") {
    throw new LedgerFailure(422, "validation", "Choose isometric, puro, or verra.");
  }
  return "isometric";
}

export function readPageQuery(url: URL): PageQuery {
  const raw = url.searchParams.get("first");
  const first = raw == null || raw === "" ? 20 : Number(raw);
  if (!Number.isInteger(first) || first < 1 || first > 50) {
    throw new LedgerFailure(422, "validation", "first must be an integer from 1 to 50.");
  }
  const after = url.searchParams.get("after");
  return { first, after: after || null };
}

function batchStatus(url: URL): CreditBatchStatus | null {
  const status = url.searchParams.get("status");
  if (!status) return null;
  if (status === "ACTIVE" || status === "RETIRED" || status === "SPLIT") return status;
  throw new LedgerFailure(422, "validation", "status must be ACTIVE, RETIRED, or SPLIT.");
}

function projectFilter(url: URL): string | null {
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return null;
  if (!/^prj_[A-Za-z0-9]{16,33}$/.test(projectId)) {
    throw new LedgerFailure(422, "validation", "projectId must be an Isometric project id.");
  }
  return projectId;
}

function cleanNotes(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw new LedgerFailure(422, "validation", "Notes must be text.");
  }
  const message = notesMessage(value);
  if (message) throw new LedgerFailure(422, "validation", message);
  const notes = value.trim();
  return notes || null;
}

function cleanLines(value: unknown): CreditBatchQuantity[] {
  if (!Array.isArray(value)) {
    throw new LedgerFailure(422, "validation", "credit_batch_quantities must be a list.");
  }
  const lines = value.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new LedgerFailure(422, "validation", "Each batch quantity needs an id and kilograms.");
    }
    const row = entry as { credit_batch_id?: unknown; credit_quantity_kg?: unknown };
    return {
      credit_batch_id: String(row.credit_batch_id ?? ""),
      credit_quantity_kg: Number(row.credit_quantity_kg),
    };
  });
  const message = quantityLinesMessage(lines);
  if (message) throw new LedgerFailure(422, "validation", message);
  return lines;
}

async function assertActiveLines(ctx: LedgerContext, lines: CreditBatchQuantity[]) {
  const checked: Array<{ credit_quantity_kg: number; availableKg: number }> = [];
  for (const line of lines) {
    const batch = await isometric.readBatch(ctx.environment, ctx.credentials, line.credit_batch_id);
    if (batch.status !== "ACTIVE") {
      throw new LedgerFailure(422, "validation", "Only active batches can be delivered, transferred, or retired.");
    }
    if (batch.ownerId && batch.ownerId !== ctx.organisationId) {
      throw new LedgerFailure(422, "validation", "A selected batch is not owned by the connected organisation.");
    }
    checked.push({
      credit_quantity_kg: line.credit_quantity_kg,
      availableKg: batch.sizeKg,
    });
  }
  const message = overQuantityMessage({ lines: checked });
  if (message) throw new LedgerFailure(422, "validation", message);
}

function audit(entry: Record<string, unknown>) {
  try {
    console.info(JSON.stringify({ source: "ledger", ...entry }));
  } catch {
    // A log failure must not undo a registry write that already succeeded.
  }
}

export async function readSummary(url: URL): Promise<LedgerSummary> {
  const requested = url.searchParams.get("registry") ?? "isometric";
  if (requested !== "all" && requested !== "isometric" && requested !== "puro" && requested !== "verra") {
    throw new LedgerFailure(422, "validation", "registry must be isometric, puro, verra, or all.");
  }
  const connection = await readConnection();
  const disabled = (registry: LedgerRegistry, label: string) => ({
    registry,
    label,
    enabled: false,
    connected: false,
    balance: null,
    message: "This registry is not connected.",
  });

  let isometricBalance: NormalizedCreditBalance | null = null;
  let isometricMessage = connection.message;
  if (connection.connected && connection.organisationReady) {
    try {
      const ctx = await context();
      isometricBalance = await isometric.readBalance(
        ctx.environment,
        ctx.credentials,
        ctx.organisationId,
      );
      isometricMessage = null;
    } catch (error) {
      isometricMessage =
        error instanceof LedgerFailure
          ? error.message
          : "The Isometric balance could not be read.";
    }
  } else if (connection.connected && !isometricMessage) {
    isometricMessage = "The Isometric organisation for this connection could not be read.";
  }

  const isometricEntry = {
    registry: "isometric" as const,
    label: "Isometric",
    enabled: true,
    connected: connection.connected,
    balance: isometricBalance,
    message: isometricMessage,
  };

  if (requested === "isometric") {
    return { registry: "isometric", summed: false, entries: [isometricEntry] };
  }
  if (requested === "puro") {
    return { registry: "puro", summed: false, entries: [disabled("puro", "Puro")] };
  }
  if (requested === "verra") {
    return { registry: "verra", summed: false, entries: [disabled("verra", "Verra")] };
  }
  return {
    registry: "all",
    summed: false,
    entries: [isometricEntry, disabled("puro", "Puro"), disabled("verra", "Verra")],
  };
}

export async function readBalance(): Promise<NormalizedCreditBalance> {
  const ctx = await context();
  return isometric.readBalance(ctx.environment, ctx.credentials, ctx.organisationId);
}

export async function readBatches(url: URL): Promise<Page<NormalizedCreditBatch>> {
  const ctx = await context();
  return isometric.readBatches(ctx.environment, ctx.credentials, ctx.organisationId, {
    ...readPageQuery(url),
    status: batchStatus(url),
    projectId: projectFilter(url),
  });
}

export async function readOrders(url: URL): Promise<Page<NormalizedOrder>> {
  const ctx = await context();
  return isometric.readOrders(
    ctx.environment,
    ctx.credentials,
    ctx.organisationId,
    readPageQuery(url),
  );
}

export async function readTransferees(url: URL): Promise<Page<NormalizedOrganisation>> {
  const ctx = await context();
  return isometric.readTransferees(ctx.environment, ctx.credentials, readPageQuery(url));
}

export async function readBeneficiaries(url: URL): Promise<Page<NormalizedOrganisation>> {
  const ctx = await context();
  return isometric.readBeneficiaries(ctx.environment, ctx.credentials, readPageQuery(url));
}

export async function readDeliveries(url: URL): Promise<Page<NormalizedTransaction>> {
  const ctx = await context();
  if (!ctx.supplierId) return EMPTY_PAGE;
  return isometric.readDeliveries(
    ctx.environment,
    ctx.credentials,
    ctx.supplierId,
    readPageQuery(url),
  );
}

export async function readDelivery(deliveryId: string): Promise<NormalizedTransaction> {
  const ctx = await context();
  return isometric.readDelivery(ctx.environment, ctx.credentials, deliveryId);
}

export async function readDeliveryBatches(
  deliveryId: string,
  url: URL,
): Promise<Page<NormalizedCreditBatch>> {
  const ctx = await context();
  return isometric.readTransactionBatches(
    ctx.environment,
    ctx.credentials,
    `/deliveries/${deliveryId}/credit_batches`,
    readPageQuery(url),
  );
}

export async function readTransfers(url: URL): Promise<Page<NormalizedTransaction>> {
  const ctx = await context();
  return isometric.readTransfers(
    ctx.environment,
    ctx.credentials,
    ctx.organisationId,
    readPageQuery(url),
  );
}

export async function readTransfer(transferId: string): Promise<NormalizedTransaction> {
  const ctx = await context();
  return isometric.readTransfer(ctx.environment, ctx.credentials, transferId);
}

export async function readTransferBatches(
  transferId: string,
  url: URL,
): Promise<Page<NormalizedCreditBatch>> {
  const ctx = await context();
  return isometric.readTransactionBatches(
    ctx.environment,
    ctx.credentials,
    `/transfers/${transferId}/credit_batches`,
    readPageQuery(url),
  );
}

export async function readRetirements(url: URL): Promise<Page<NormalizedTransaction>> {
  const ctx = await context();
  return isometric.readRetirements(
    ctx.environment,
    ctx.credentials,
    ctx.organisationId,
    readPageQuery(url),
  );
}

export async function readRetirement(retirementId: string): Promise<NormalizedTransaction> {
  const ctx = await context();
  return isometric.readRetirement(ctx.environment, ctx.credentials, retirementId);
}

export async function readRetirementBatches(
  retirementId: string,
  url: URL,
): Promise<Page<NormalizedCreditBatch>> {
  const ctx = await context();
  return isometric.readTransactionBatches(
    ctx.environment,
    ctx.credentials,
    `/retirements/${retirementId}/credit_batches`,
    readPageQuery(url),
  );
}

export async function readCreditBatch(batchId: string): Promise<NormalizedCreditBatch> {
  if (!isometricId("ctb", batchId)) {
    throw new LedgerFailure(422, "validation", "batchId must be an Isometric credit batch id.");
  }
  const ctx = await context();
  return isometric.readBatch(ctx.environment, ctx.credentials, batchId);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new LedgerFailure(422, "validation", "The request body must be JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new LedgerFailure(422, "validation", "The request body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

export async function deliver(request: Request): Promise<MutationResult> {
  requireWriter(await ledgerSession());
  const ctx = await context();
  const body = await readJson(request);
  const orderId = String(body.order_id ?? "");
  if (!isometricId("ord", orderId)) {
    throw new LedgerFailure(422, "validation", "order_id must be an Isometric order id.");
  }
  const lines = cleanLines(body.credit_batch_quantities);
  const notes = cleanNotes(body.notes);
  const order = await isometric.readOrder(ctx.environment, ctx.credentials, orderId);
  if (order.status !== "PLACED" && order.status !== "IN_PROGRESS") {
    throw new LedgerFailure(422, "validation", "Credits can only be delivered against a placed or in-progress order.");
  }
  await assertActiveLines(ctx, lines);
  const limit = overQuantityMessage({
    lines: lines.map((line) => ({ ...line, availableKg: Number.MAX_SAFE_INTEGER })),
    limitKg: order.remainingKg,
    limitLabel: "The total is larger than the order remainder.",
  });
  if (limit) throw new LedgerFailure(422, "validation", limit);
  const result = await isometric.createDelivery(ctx.environment, ctx.credentials, {
    order_id: orderId,
    notes,
    credit_batch_quantities: lines,
  });
  audit({
    action: "credit.delivery",
    actor: ctx.session.sub,
    role: ctx.session.role,
    tenantId: ctx.session.tenantId,
    registryId: result.id,
    orderId,
  });
  return result;
}

export async function transfer(request: Request): Promise<MutationResult> {
  requireWriter(await ledgerSession());
  const ctx = await context();
  const body = await readJson(request);
  const toOrganisationId = String(body.to_organisation_id ?? "");
  if (!isometricId("org", toOrganisationId)) {
    throw new LedgerFailure(422, "validation", "Choose a recipient organisation from the registry list.");
  }
  const listed = await isometric.organisationIsListed(
    ctx.environment,
    ctx.credentials,
    "/transferees",
    toOrganisationId,
  );
  if (!listed) {
    throw new LedgerFailure(422, "validation", "Choose a recipient organisation from the registry list.");
  }
  const lines = cleanLines(body.credit_batch_quantities);
  const notes = cleanNotes(body.notes);
  await assertActiveLines(ctx, lines);
  const result = await isometric.createTransfer(ctx.environment, ctx.credentials, {
    from_organisation_id: ctx.organisationId,
    to_organisation_id: toOrganisationId,
    supplier_id: requireSupplier(ctx),
    notes,
    credit_batch_quantities: lines,
  });
  audit({
    action: "credit.transfer",
    actor: ctx.session.sub,
    role: ctx.session.role,
    tenantId: ctx.session.tenantId,
    registryId: result.id,
    toOrganisationId,
  });
  return result;
}

export async function retire(request: Request): Promise<MutationResult> {
  requireWriter(await ledgerSession());
  const ctx = await context();
  const body = await readJson(request);
  const purposes = Array.isArray(body.retirement_purposes)
    ? body.retirement_purposes.map((purpose) => String(purpose))
    : [];
  const purposeError = purposesMessage(purposes);
  if (purposeError) throw new LedgerFailure(422, "validation", purposeError);
  const requestedBeneficiary =
    body.beneficiary_organisation_id == null || body.beneficiary_organisation_id === ""
      ? ctx.organisationId
      : String(body.beneficiary_organisation_id);
  if (!isometricId("org", requestedBeneficiary)) {
    throw new LedgerFailure(422, "validation", "Choose a beneficiary from the registry list.");
  }
  if (requestedBeneficiary !== ctx.organisationId) {
    const listed = await isometric.organisationIsListed(
      ctx.environment,
      ctx.credentials,
      "/beneficiaries",
      requestedBeneficiary,
    );
    if (!listed) {
      throw new LedgerFailure(422, "validation", "Choose a beneficiary from the registry list.");
    }
  }
  const lines = cleanLines(body.credit_batch_quantities);
  const notes = cleanNotes(body.notes);
  await assertActiveLines(ctx, lines);
  const result = await isometric.createRetirement(ctx.environment, ctx.credentials, {
    owner_organisation_id: ctx.organisationId,
    beneficiary_organisation_id: requestedBeneficiary,
    supplier_id: requireSupplier(ctx),
    retirement_purposes: purposes as RetirementPurpose[],
    notes,
    credit_batch_quantities: lines,
  });
  audit({
    action: "credit.retirement",
    actor: ctx.session.sub,
    role: ctx.session.role,
    tenantId: ctx.session.tenantId,
    registryId: result.id,
    beneficiaryOrganisationId: requestedBeneficiary,
  });
  return result;
}

export async function readStripe(): Promise<StripeConfig> {
  const ctx = await context();
  if (!ISOMETRIC_CAPABILITIES.includes("buy")) {
    throw new LedgerFailure(422, "registry_unavailable", "This registry does not list credit checkout.");
  }
  return isometric.readStripeConfig(ctx.environment, ctx.credentials);
}

function publicOrigin(request: Request): string {
  const host = (
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    ""
  )
    .split(",")[0]
    ?.trim();
  if (!host) {
    throw new LedgerFailure(422, "validation", "Checkout needs a public host for its return URLs.");
  }
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = forwarded || (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function checkout(request: Request): Promise<StripeCheckout> {
  requireWriter(await ledgerSession());
  const ctx = await context();
  const body = await readJson(request);
  const quantity = Number(body.quantity_kg);
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new LedgerFailure(422, "validation", "quantity_kg must be a positive whole number of kilograms.");
  }
  const frequency = body.frequency;
  if (frequency !== "one_time" && frequency !== "monthly" && frequency !== "yearly") {
    throw new LedgerFailure(422, "validation", "frequency must be one_time, monthly, or yearly.");
  }
  if (body.isometric_terms_and_conditions_accepted !== true) {
    throw new LedgerFailure(422, "validation", "Accept the Isometric terms before checkout.");
  }
  if (body.supplier_terms_and_conditions_accepted !== true) {
    throw new LedgerFailure(422, "validation", "Accept the supplier terms before checkout.");
  }
  const email = body.customer_email == null || body.customer_email === ""
    ? null
    : String(body.customer_email).trim();
  if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) {
    throw new LedgerFailure(422, "validation", "customer_email must be an email address.");
  }
  const origin = publicOrigin(request);
  const result = await isometric.createStripeCheckout(ctx.environment, ctx.credentials, {
    quantity_kg: quantity,
    frequency,
    isometric_terms_and_conditions_accepted: true,
    supplier_terms_and_conditions_accepted: true,
    customer_email: email,
    success_url: `${origin}/ledger?tab=buy-success&registry=isometric`,
    cancel_url: `${origin}/ledger?tab=buy-cancel&registry=isometric`,
  });
  audit({
    action: "credit.stripe_checkout",
    actor: ctx.session.sub,
    role: ctx.session.role,
    tenantId: ctx.session.tenantId,
  });
  return result;
}

export function guardRegistry(registry: string) {
  return requireIsometric(registry);
}
