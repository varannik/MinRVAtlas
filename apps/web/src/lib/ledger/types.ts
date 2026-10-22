export type LedgerRegistry = "isometric" | "puro" | "verra";

export type CreditBatchStatus = "ACTIVE" | "RETIRED" | "SPLIT";

export type OrderStatus = "PLACED" | "IN_PROGRESS" | "COMPLETED";

export type RetirementPurpose =
  | "corporate_targets"
  | "public_environmental_claims"
  | "insetting"
  | "regulatory_requirement"
  | "other";

export type PageInfo = {
  hasNextPage: boolean;
  endCursor: string | null;
  hasPreviousPage: boolean;
  startCursor: string | null;
};

export type Page<T> = {
  nodes: T[];
  totalCount: number;
  pageInfo: PageInfo;
};

export type NormalizedCreditBalance = {
  activeKg: number;
  retiredKg: number;
  projects: Array<{
    projectId: string;
    activeKg: number;
    retiredKg: number;
  }>;
};

export type NormalizedCreditBatch = {
  id: string;
  serialNumber: string;
  status: CreditBatchStatus;
  sizeKg: number;
  projectId: string;
  issuedAt: string;
  ownerId: string;
  ownerName: string;
};

export type NormalizedOrder = {
  id: string;
  status: OrderStatus;
  buyerName: string;
  orderedKg: number;
  deliveredKg: number;
  remainingKg: number;
};

export type NormalizedOrganisation = {
  id: string;
  name: string;
  domain: string | null;
};

export type NormalizedTransaction = {
  id: string;
  at: string;
  quantityKg: number | null;
  url: string | null;
  notes: string | null;
  counterparty: string | null;
};

export type CreditBatchQuantity = {
  credit_batch_id: string;
  credit_quantity_kg: number;
};

export type LedgerConnection = {
  registry: "isometric";
  connected: boolean;
  environment: "sandbox" | "production" | null;
  canWrite: boolean;
  capabilities: string[];
  organisationReady: boolean;
  supplierReady: boolean;
  credentialIssuedAt: string | null;
  credentialExpiresAt: string | null;
  credentialExpiresSoon: boolean;
  message: string | null;
};

export type LedgerSummaryEntry = {
  registry: LedgerRegistry;
  label: string;
  enabled: boolean;
  connected: boolean;
  balance: NormalizedCreditBalance | null;
  message: string | null;
};

export type LedgerSummary = {
  registry: LedgerRegistry | "all";
  summed: false;
  entries: LedgerSummaryEntry[];
};

export type MutationResult = {
  id: string;
  url: string | null;
};

export type StripeConfig = {
  currency: string | null;
  creditPricePerTonne: string | null;
  verificationPricePerTonne: string | null;
  termsUrl: string;
};

export type StripeCheckout = {
  redirectUrl: string;
};
