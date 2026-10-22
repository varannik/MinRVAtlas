import "server-only";

import { REGISTRY_BASE_URL } from "@/lib/registries/isometric/api";
import type { OrgCredentials, RegistryEnvironment } from "@/lib/registries/types";
import { LedgerFailure } from "@/lib/ledger/errors";
import { isometricId } from "@/lib/ledger/validate";
import type {
  CreditBatchStatus,
  MutationResult,
  NormalizedCreditBalance,
  NormalizedCreditBatch,
  NormalizedOrder,
  NormalizedOrganisation,
  NormalizedTransaction,
  OrderStatus,
  Page,
  PageInfo,
  StripeCheckout,
  StripeConfig,
} from "@/lib/ledger/types";

type PageQuery = { first: number; after: string | null };

type Quantity = { credit_kgs?: number };
type NamedOrg = { id?: string; name?: string; domain?: string | null };

const NO_STORE = { "cache-control": "no-store" };

function registryMessage(status: number, text: string): string {
  try {
    const body = JSON.parse(text) as {
      detail?: unknown;
      message?: unknown;
    };
    if (typeof body.message === "string" && body.message.trim()) return body.message;
    if (typeof body.detail === "string" && body.detail.trim()) return body.detail;
    if (Array.isArray(body.detail)) {
      const parts = body.detail
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object" && "msg" in item) {
            const msg = (item as { msg?: unknown }).msg;
            return typeof msg === "string" ? msg : "";
          }
          return "";
        })
        .filter(Boolean);
      if (parts.length > 0) return parts.join("; ");
    }
  } catch {
    // The registry sometimes returns plain text.
  }
  const trimmed = text.trim();
  return trimmed.slice(0, 500) || `The registry returned HTTP ${status}.`;
}

async function registryRequest(
  environment: RegistryEnvironment,
  credentials: OrgCredentials,
  path: string,
  init?: {
    method?: "GET" | "POST";
    query?: Record<string, string | undefined>;
    body?: unknown;
  },
): Promise<unknown> {
  const url = new URL(`${REGISTRY_BASE_URL[environment]}${path}`);
  for (const [key, value] of Object.entries(init?.query ?? {})) {
    if (value) url.searchParams.set(key, value);
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method: init?.method ?? "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${credentials.accessToken}`,
        "x-client-secret": credentials.clientSecret,
        ...(init?.body ? { "content-type": "application/json" } : {}),
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new LedgerFailure(
      502,
      "registry_unavailable",
      "The registry could not be reached.",
    );
  }

  const text = await response.text();
  if (response.status === 401) {
    throw new LedgerFailure(
      502,
      "registry_unauthorized",
      "The registry rejected the platform credentials.",
    );
  }
  if (!response.ok) {
    const message = registryMessage(response.status, text);
    if (response.status === 404) {
      throw new LedgerFailure(404, "not_found", message);
    }
    if (response.status === 422) {
      throw new LedgerFailure(422, "registry_validation", message);
    }
    if (response.status === 403) {
      throw new LedgerFailure(403, "registry_forbidden", message);
    }
    throw new LedgerFailure(
      502,
      "registry_error",
      message,
    );
  }
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new LedgerFailure(502, "registry_error", "The registry returned an unreadable response.");
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LedgerFailure(502, "registry_error", `The registry returned an unexpected ${label}.`);
  }
  return value as Record<string, unknown>;
}

function kg(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const amount = (value as Quantity).credit_kgs;
  return typeof amount === "number" && Number.isFinite(amount) ? amount : null;
}

function requiredKg(value: unknown, label: string): number {
  const amount = kg(value);
  if (amount == null) {
    throw new LedgerFailure(502, "registry_error", `The registry omitted ${label}.`);
  }
  return amount;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function organisation(value: unknown): NormalizedOrganisation | null {
  if (!value || typeof value !== "object") return null;
  const row = value as NamedOrg;
  if (!row.id || !row.name) return null;
  return { id: row.id, name: row.name, domain: row.domain ?? null };
}

function pageInfo(value: unknown): PageInfo {
  const row = asRecord(value, "page");
  return {
    hasNextPage: row.has_next_page === true,
    endCursor: text(row.end_cursor),
    hasPreviousPage: row.has_previous_page === true,
    startCursor: text(row.start_cursor),
  };
}

function page<T>(value: unknown, mapNode: (node: unknown) => T): Page<T> {
  const row = asRecord(value, "list");
  const nodes = Array.isArray(row.nodes) ? row.nodes.map(mapNode) : [];
  return {
    nodes,
    totalCount: typeof row.total_count === "number" ? row.total_count : nodes.length,
    pageInfo: pageInfo(row.page_info),
  };
}

function pageQuery(query: PageQuery): Record<string, string | undefined> {
  return {
    first: String(query.first),
    after: query.after ?? undefined,
  };
}

const BATCH_STATUS: Record<string, CreditBatchStatus> = {
  active: "ACTIVE",
  retired: "RETIRED",
  split: "SPLIT",
};

const ORDER_STATUS: Record<string, OrderStatus> = {
  placed: "PLACED",
  in_progress: "IN_PROGRESS",
  completed: "COMPLETED",
};

function batchStatus(value: unknown): CreditBatchStatus {
  const status = BATCH_STATUS[String(value)];
  if (!status) {
    throw new LedgerFailure(502, "registry_error", "The registry returned an unknown batch status.");
  }
  return status;
}

function orderStatus(value: unknown): OrderStatus {
  const status = ORDER_STATUS[String(value)];
  if (!status) {
    throw new LedgerFailure(502, "registry_error", "The registry returned an unknown order status.");
  }
  return status;
}

function creditBatch(value: unknown): NormalizedCreditBatch {
  const row = asRecord(value, "credit batch");
  const owner = organisation(row.owner);
  return {
    id: text(row.id) ?? "",
    serialNumber: text(row.serial_number) ?? "",
    status: batchStatus(row.status),
    sizeKg: requiredKg(row.size, "the batch size"),
    projectId: text(row.project_id) ?? "",
    issuedAt: text(row.issued_at) ?? "",
    ownerId: owner?.id ?? "",
    ownerName: owner?.name ?? "",
  };
}

function balance(value: unknown): NormalizedCreditBalance {
  const row = asRecord(value, "balance");
  const total = asRecord(row.total, "balance total");
  const projects = Array.isArray(row.project_balances) ? row.project_balances : [];
  return {
    activeKg: requiredKg(total.active_credits_total, "the active total"),
    retiredKg: requiredKg(total.retired_credits_total, "the retired total"),
    projects: projects.map((entry) => {
      const project = asRecord(entry, "project balance");
      const projectTotal = asRecord(project.total, "project total");
      return {
        projectId: text(project.project_id) ?? "",
        activeKg: requiredKg(projectTotal.active_credits_total, "a project active total"),
        retiredKg: requiredKg(projectTotal.retired_credits_total, "a project retired total"),
      };
    }),
  };
}

function order(value: unknown): NormalizedOrder {
  const row = asRecord(value, "order");
  const buyer = organisation(row.buyer_organisation);
  const orderedKg = requiredKg(row.credits_ordered, "credits ordered");
  const deliveredKg = requiredKg(row.credits_delivered, "credits delivered");
  return {
    id: text(row.id) ?? "",
    status: orderStatus(row.status),
    buyerName: buyer?.name ?? "",
    orderedKg,
    deliveredKg,
    remainingKg: Math.max(0, orderedKg - deliveredKg),
  };
}

function transaction(
  value: unknown,
  fields: {
    at: string;
    counterparty: string;
    quantity: string;
  },
): NormalizedTransaction {
  const row = asRecord(value, "transaction");
  const party = organisation(row[fields.counterparty]);
  return {
    id: text(row.id) ?? "",
    at: text(row[fields.at]) ?? "",
    quantityKg: kg(row[fields.quantity]),
    url: text(row.url),
    notes: text(row.notes),
    counterparty: party?.name ?? null,
  };
}

function mutation(value: unknown): MutationResult {
  const row = asRecord(value, "transaction");
  const id = text(row.id);
  if (!id) {
    throw new LedgerFailure(502, "registry_error", "The registry did not return a transaction id.");
  }
  return { id, url: text(row.url) };
}

const callerCache = new Map<
  string,
  { at: number; organisationId: string; supplierId: string | null }
>();

/** Organisation and supplier for the access token already used by the Isometric connection. */
export async function readCallerIdentity(
  environment: RegistryEnvironment,
  credentials: OrgCredentials,
): Promise<{ organisationId: string; supplierId: string | null }> {
  const cacheKey = `${environment}:${credentials.accessToken.slice(-16)}`;
  const cached = callerCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) {
    return { organisationId: cached.organisationId, supplierId: cached.supplierId };
  }

  const orgBody = await registryRequest(environment, credentials, "/organisation");
  const org = organisation(orgBody);
  if (!org || !isometricId("org", org.id)) {
    throw new LedgerFailure(
      502,
      "registry_error",
      "The registry did not return the organisation for this Isometric connection.",
    );
  }

  let supplierId: string | null = null;
  try {
    const supplierBody = await registryRequest(environment, credentials, "/supplier");
    const supplier = text(asRecord(supplierBody, "supplier").id);
    if (supplier && isometricId("spl", supplier)) supplierId = supplier;
  } catch (error) {
    if (!(error instanceof LedgerFailure) || (error.status !== 404 && error.status !== 403)) {
      throw error;
    }
  }

  callerCache.set(cacheKey, { at: Date.now(), organisationId: org.id, supplierId });
  return { organisationId: org.id, supplierId };
}

export async function readBalance(
  environment: RegistryEnvironment,
  credentials: OrgCredentials,
  organisationId: string,
): Promise<NormalizedCreditBalance> {
  const body = await registryRequest(
    environment,
    credentials,
    `/organisations/${organisationId}/credit_balance`,
  );
  return balance(body);
}

export async function readBatches(
  environment: RegistryEnvironment,
  credentials: OrgCredentials,
  organisationId: string,
  query: PageQuery & { status?: CreditBatchStatus | null; projectId?: string | null },
): Promise<Page<NormalizedCreditBatch>> {
  const body = await registryRequest(
    environment,
    credentials,
    `/organisations/${organisationId}/credit_batches`,
    {
      query: {
        ...pageQuery(query),
        status: query.status?.toLowerCase(),
        project_id: query.projectId ?? undefined,
      },
    },
  );
  return page(body, creditBatch);
}

export async function readBatch(
  environment: RegistryEnvironment,
  credentials: OrgCredentials,
  batchId: string,
): Promise<NormalizedCreditBatch> {
  const body = await registryRequest(environment, credentials, `/credit_batches/${batchId}`);
  return creditBatch(body);
}

export async function readOrders(
  environment: RegistryEnvironment,
  credentials: OrgCredentials,
  organisationId: string,
  query: PageQuery,
): Promise<Page<NormalizedOrder>> {
  const body = await registryRequest(
    environment,
    credentials,
    `/organisations/${organisationId}/orders`,
    { query: pageQuery(query) },
  );
  return page(body, order);
}

export async function readOrder(
  environment: RegistryEnvironment,
  credentials: OrgCredentials,
  orderId: string,
): Promise<NormalizedOrder> {
  const body = await registryRequest(environment, credentials, `/orders/${orderId}`);
  return order(body);
}

async function readOrganisations(
  environment: RegistryEnvironment,
  credentials: OrgCredentials,
  path: "/transferees" | "/beneficiaries",
  query: PageQuery,
): Promise<Page<NormalizedOrganisation>> {
  const body = await registryRequest(environment, credentials, path, {
    query: pageQuery(query),
  });
  return page(body, (node) => {
    const org = organisation(node);
    if (!org) {
      throw new LedgerFailure(502, "registry_error", "The registry returned an organisation without a name.");
    }
    return org;
  });
}

export function readTransferees(
  environment: RegistryEnvironment,
  credentials: OrgCredentials,
  query: PageQuery,
): Promise<Page<NormalizedOrganisation>> {
  return readOrganisations(environment, credentials, "/transferees", query);
}

export function readBeneficiaries(
  environment: RegistryEnvironment,
  credentials: OrgCredentials,
  query: PageQuery,
): Promise<Page<NormalizedOrganisation>> {
  return readOrganisations(environment, credentials, "/beneficiaries", query);
}

export async function organisationIsListed(
  environment: RegistryEnvironment,
  credentials: OrgCredentials,
  path: "/transferees" | "/beneficiaries",
  organisationId: string,
): Promise<boolean> {
  let after: string | null = null;
  for (let pageNumber = 0; pageNumber < 5; pageNumber += 1) {
    const listed = await readOrganisations(environment, credentials, path, {
      first: 50,
      after,
    });
    if (listed.nodes.some((org) => org.id === organisationId)) return true;
    if (!listed.pageInfo.hasNextPage || !listed.pageInfo.endCursor) return false;
    after = listed.pageInfo.endCursor;
  }
  return false;
}

export async function readDeliveries(
  environment: RegistryEnvironment,
  credentials: OrgCredentials,
  supplierId: string,
  query: PageQuery,
): Promise<Page<NormalizedTransaction>> {
  const body = await registryRequest(environment, credentials, "/deliveries", {
    query: { ...pageQuery(query), from_supplier_id: supplierId },
  });
  return page(body, (node) =>
    transaction(node, {
      at: "delivered_at",
      counterparty: "to_organisation",
      quantity: "credit_batch_size_total",
    }),
  );
}

export async function readTransfers(
  environment: RegistryEnvironment,
  credentials: OrgCredentials,
  organisationId: string,
  query: PageQuery,
): Promise<Page<NormalizedTransaction>> {
  const body = await registryRequest(environment, credentials, "/transfers", {
    query: { ...pageQuery(query), from_organisation_id: organisationId },
  });
  return page(body, (node) =>
    transaction(node, {
      at: "transferred_at",
      counterparty: "to_organisation",
      quantity: "credit_batch_size_total",
    }),
  );
}

export async function readRetirements(
  environment: RegistryEnvironment,
  credentials: OrgCredentials,
  organisationId: string,
  query: PageQuery,
): Promise<Page<NormalizedTransaction>> {
  const body = await registryRequest(environment, credentials, "/retirements", {
    query: { ...pageQuery(query), owner_org_id: organisationId },
  });
  return page(body, (node) =>
    transaction(node, {
      at: "retired_at",
      counterparty: "beneficiary",
      quantity: "credit_batch_size_total",
    }),
  );
}

async function readOne(
  environment: RegistryEnvironment,
  credentials: OrgCredentials,
  path: string,
  fields: { at: string; counterparty: string; quantity: string },
): Promise<NormalizedTransaction> {
  const body = await registryRequest(environment, credentials, path);
  return transaction(body, fields);
}

export function readDelivery(
  environment: RegistryEnvironment,
  credentials: OrgCredentials,
  deliveryId: string,
): Promise<NormalizedTransaction> {
  return readOne(environment, credentials, `/deliveries/${deliveryId}`, {
    at: "delivered_at",
    counterparty: "to_organisation",
    quantity: "credit_batch_size_total",
  });
}

export function readTransfer(
  environment: RegistryEnvironment,
  credentials: OrgCredentials,
  transferId: string,
): Promise<NormalizedTransaction> {
  return readOne(environment, credentials, `/transfers/${transferId}`, {
    at: "transferred_at",
    counterparty: "to_organisation",
    quantity: "credit_batch_size_total",
  });
}

export function readRetirement(
  environment: RegistryEnvironment,
  credentials: OrgCredentials,
  retirementId: string,
): Promise<NormalizedTransaction> {
  return readOne(environment, credentials, `/retirements/${retirementId}`, {
    at: "retired_at",
    counterparty: "beneficiary",
    quantity: "credit_batch_size_total",
  });
}

export async function readTransactionBatches(
  environment: RegistryEnvironment,
  credentials: OrgCredentials,
  path: string,
  query: PageQuery,
): Promise<Page<NormalizedCreditBatch>> {
  const body = await registryRequest(environment, credentials, path, {
    query: pageQuery(query),
  });
  return page(body, creditBatch);
}

export async function createDelivery(
  environment: RegistryEnvironment,
  credentials: OrgCredentials,
  body: {
    order_id: string;
    notes: string | null;
    credit_batch_quantities: Array<{ credit_batch_id: string; credit_quantity_kg: number }>;
  },
): Promise<MutationResult> {
  const response = await registryRequest(environment, credentials, "/deliveries", {
    method: "POST",
    body,
  });
  return mutation(response);
}

export async function createTransfer(
  environment: RegistryEnvironment,
  credentials: OrgCredentials,
  body: {
    from_organisation_id: string;
    to_organisation_id: string;
    supplier_id: string;
    notes: string | null;
    credit_batch_quantities: Array<{ credit_batch_id: string; credit_quantity_kg: number }>;
  },
): Promise<MutationResult> {
  const response = await registryRequest(environment, credentials, "/transfers", {
    method: "POST",
    body,
  });
  return mutation(response);
}

export async function createRetirement(
  environment: RegistryEnvironment,
  credentials: OrgCredentials,
  body: {
    owner_organisation_id: string;
    beneficiary_organisation_id: string;
    supplier_id: string;
    retirement_purposes: string[];
    notes: string | null;
    credit_batch_quantities: Array<{ credit_batch_id: string; credit_quantity_kg: number }>;
  },
): Promise<MutationResult> {
  const response = await registryRequest(environment, credentials, "/retirements", {
    method: "POST",
    body,
  });
  return mutation(response);
}

export async function readStripeConfig(
  environment: RegistryEnvironment,
  credentials: OrgCredentials,
): Promise<StripeConfig> {
  const body = await registryRequest(environment, credentials, "/stripe/configuration");
  const row = asRecord(body, "stripe configuration");
  const termsUrl = text(row.isometric_terms_and_conditions_url);
  if (!termsUrl) {
    throw new LedgerFailure(502, "registry_error", "The registry did not return checkout terms.");
  }
  return {
    currency: text(row.currency),
    creditPricePerTonne: text(row.credit_product_price_per_tonne),
    verificationPricePerTonne: text(row.verification_product_price_per_tonne),
    termsUrl,
  };
}

export async function createStripeCheckout(
  environment: RegistryEnvironment,
  credentials: OrgCredentials,
  body: {
    quantity_kg: number;
    frequency: "one_time" | "monthly" | "yearly";
    isometric_terms_and_conditions_accepted: true;
    supplier_terms_and_conditions_accepted: true;
    customer_email: string | null;
    success_url: string;
    cancel_url: string;
  },
): Promise<StripeCheckout> {
  const response = await registryRequest(environment, credentials, "/stripe/checkout", {
    method: "POST",
    body,
  });
  const row = asRecord(response, "checkout");
  const redirectUrl = text(row.redirect_url);
  if (!redirectUrl) {
    throw new LedgerFailure(502, "registry_error", "The registry did not return a checkout link.");
  }
  return { redirectUrl };
}

export { NO_STORE };
