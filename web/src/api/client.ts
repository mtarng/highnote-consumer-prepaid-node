const BASE_URL = import.meta.env.VITE_API_URL || "";

interface FieldError {
  code?: string;
  description?: string;
  errorPath?: string[];
}

interface ApiError {
  error?: string;
  message?: string;
  fieldErrors?: FieldError[];
}

class ApiRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

function getToken(): string | null {
  return localStorage.getItem("auth_token");
}

export async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) || {}),
  };

  // Only set Content-Type for requests with a body
  if (options.body) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    // Auto-logout on 401 — stale/expired token. Signal the reason so the login
    // page can explain what happened instead of redirecting silently.
    if (response.status === 401 && !path.startsWith("/api/auth")) {
      localStorage.removeItem("auth_token");
      localStorage.removeItem("auth_user");
      if (!window.location.pathname.startsWith("/login")) {
        window.location.href = "/login?reason=session-expired";
      }
      throw new ApiRequestError("Session expired", 401);
    }

    let errorMessage =
      response.status === 429
        ? "Too many requests — please retry in a moment."
        : `Request failed with status ${response.status}`;
    try {
      const errorBody = (await response.json()) as ApiError;
      const headline = errorBody.error || errorBody.message || errorMessage;
      if (response.status === 429) {
        // Rate limits get a friendly, actionable message rather than a raw error code.
        errorMessage = errorBody.message || errorMessage;
      } else if (errorBody.fieldErrors?.length) {
        const details = errorBody.fieldErrors
          .map((fe) => `${fe.code}: ${fe.description}`)
          .join("\n");
        errorMessage = `${headline}\n${details}`;
      } else {
        errorMessage = headline;
      }
    } catch {
      // ignore parse errors
    }
    throw new ApiRequestError(errorMessage, response.status);
  }

  return response.json() as Promise<T>;
}

// --- Config ---

export interface AppConfig {
  environment: "test" | "live";
}

export function getConfig(): Promise<AppConfig> {
  return request<AppConfig>("/api/config");
}

// --- Auth ---

export interface AuthResponse {
  token: string;
  user: {
    id: number;
    email: string;
    accountHolderId: string | null;
  };
}

export function signup(email: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function login(email: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export interface PiiData {
  givenName: string;
  familyName: string;
  dateOfBirth: string;
  email?: string;
  phoneNumber?: string;
  phoneCountryCode?: string;
  streetAddress: string;
  extendedAddress?: string;
  locality: string;
  region: string;
  postalCode: string;
  ssn?: string;
}

export interface OnboardResponse {
  token: string;
  user: {
    id: number;
    email: string;
    accountHolderId: string;
  };
}

export function onboard(piiData: PiiData): Promise<OnboardResponse> {
  return request<OnboardResponse>("/api/onboard", {
    method: "POST",
    body: JSON.stringify(piiData),
  });
}

// --- Me (account holder with nested resources) ---

export interface PaymentCard {
  id: string;
  last4?: string;
  status: string;
  formFactor?: string;
  network?: string;
  expirationDate?: string;
}

export interface LedgerAmount {
  value: number;
  currencyCode: string;
}

export interface Ledger {
  id: string;
  name: string;
  creditBalance: LedgerAmount;
  debitBalance: LedgerAmount;
}

export interface FinancialAccount {
  id: string;
  name: string;
  accountStatus: string;
  externalId?: string;
  createdAt?: string;
  ledgers?: Ledger[];
  paymentCards?: {
    edges: Array<{ node: PaymentCard }>;
  };
}

export interface VerificationResult {
  code: string;
  description?: string;
}

export interface ApplicationWorkflow {
  executionOrder?: number;
  status?: string;
  workflowType?: string;
}

export interface RequiredDocument {
  status?: string;
  documentUploadSession?: {
    id: string;
    status: string;
  };
}

export interface ApplicationSnapshot {
  currentVerification?: {
    status?: string;
    reason?: string;
    results?: VerificationResult[];
    requiredDocuments?: (RequiredDocument | null)[];
  };
}

export interface CardProductApplication {
  id: string;
  applicationState?: { status: string };
  applicationWorkflows?: ApplicationWorkflow[];
  accountHolderSnapshot?: ApplicationSnapshot;
  cardProduct?: { id: string; name: string };
  createdAt?: string;
  decisionedAt?: string;
}

export interface ExternalBankAccountDetail {
  id: string;
  last4?: string;
  routingNumber?: string;
  type?: string;
}

export interface ExternalAccount {
  __typename: string;
  id: string;
  name?: string;
  accountStatus?: string;
  createdAt?: string;
  externalBankAccountDetails?: ExternalBankAccountDetail;
}

export interface AccountHolder {
  id: string;
  externalId?: string;
  createdAt?: string;
  email?: string;
  name?: { givenName: string; familyName: string };
  dateOfBirth?: string;
  billingAddress?: {
    streetAddress: string;
    extendedAddress?: string;
    locality: string;
    region: string;
    postalCode: string;
    countryCodeAlpha3: string;
  };
  cardProductApplications?: {
    edges: Array<{ node: CardProductApplication }>;
  };
  financialAccounts?: {
    edges: Array<{ node: FinancialAccount }>;
  };
  externalFinancialAccounts?: {
    edges: Array<{ node: ExternalAccount }>;
  };
}

export interface MeResponse {
  user: { id: number; email: string };
  accountHolder: AccountHolder | null;
}

export function getMe(): Promise<MeResponse> {
  return request<MeResponse>("/api/me");
}

// --- Card Products ---

export interface CardProduct {
  id: string;
  name: string;
  vertical?: string;
  usage?: string;
  commercial?: boolean;
}

export async function listCardProducts(): Promise<CardProduct[]> {
  const res = await request<{ data: CardProduct[] }>("/api/card-products");
  return res.data;
}

// --- Applications ---

export interface Application {
  id: string;
  applicationState?: { status: string };
  applicationWorkflows?: ApplicationWorkflow[];
  accountHolderSnapshot?: ApplicationSnapshot;
  cardProduct?: { id: string; name: string };
  createdAt?: string;
}

export function createApplication(cardProductId: string): Promise<Application> {
  return request<Application>("/api/applications", {
    method: "POST",
    body: JSON.stringify({ cardProductId }),
  });
}

export function getApplication(id: string): Promise<Application> {
  return request<Application>(`/api/applications/${id}`);
}

// --- Provisioning ---

export interface ProvisionResponse {
  id: string;
  outcome?: { status: string };
  workflowActions?: Array<{
    action?: string;
    outcome?: { status?: string };
  }>;
  accountHolder?: { id: string };
}

export function provision(
  cardProductId: string,
  financialAccountName?: string
): Promise<ProvisionResponse> {
  return request<ProvisionResponse>("/api/provision", {
    method: "POST",
    body: JSON.stringify({ cardProductId, financialAccountName }),
  });
}

// --- Financial Accounts ---

export function issueFinancialAccount(
  applicationId: string,
  name: string
): Promise<FinancialAccount> {
  return request<FinancialAccount>("/api/financial-accounts", {
    method: "POST",
    body: JSON.stringify({ applicationId, name }),
  });
}

export function getFinancialAccount(id: string): Promise<FinancialAccount> {
  return request<FinancialAccount>(`/api/financial-accounts/${id}`);
}

// --- Cards ---

export function issueCard(financialAccountId: string): Promise<PaymentCard> {
  return request<PaymentCard>("/api/cards", {
    method: "POST",
    body: JSON.stringify({ financialAccountId }),
  });
}

export function activateCard(id: string): Promise<PaymentCard> {
  return request<PaymentCard>(`/api/cards/${id}/activate`, { method: "POST" });
}

export function suspendCard(id: string): Promise<PaymentCard> {
  return request<PaymentCard>(`/api/cards/${id}/suspend`, { method: "POST" });
}

export function closeCard(id: string): Promise<PaymentCard> {
  return request<PaymentCard>(`/api/cards/${id}/close`, { method: "POST" });
}

export type ReissueCardReason = "LOST" | "EXPIRED" | "OTHER" | "STOLEN";

export interface ReissueCardInput {
  reason: ReissueCardReason;
  cardLostDate?: string;
  activateOnCreate?: boolean;
  financialAccountId?: string;
  copyNumber?: boolean;
  copyPin?: boolean;
}

export function reissueCard(id: string, input: ReissueCardInput): Promise<PaymentCard> {
  return request<PaymentCard>(`/api/cards/${id}/reissue`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// --- Client Tokens ---

export interface ClientTokenResponse {
  value: string;
  expirationDate: string;
}

export function getPinToken(cardId: string): Promise<ClientTokenResponse> {
  return request<ClientTokenResponse>(`/api/cards/${cardId}/pin-token`, {
    method: "POST",
  });
}

export function getViewerToken(cardId: string): Promise<ClientTokenResponse> {
  return request<ClientTokenResponse>(`/api/cards/${cardId}/viewer-token`, {
    method: "POST",
  });
}

// --- Financial Account Activities ---

export interface ActivityAmount {
  value: number;
  currencyCode: string;
}

export interface TransactionEventDetail {
  __typename: string;
  id: string;
  responseCode?: string;
  transactionProcessingType?: string;
  approvedAmount?: { value: number; currencyCode: string };
  merchantDetails?: {
    name?: string;
    categoryCode?: string;
    description?: string;
  };
  paymentCard?: { id: string; last4?: string };
  createdAt?: string;
}

export interface ActivitySource {
  __typename: string;
  id: string;
  transactionEvents?: TransactionEventDetail[];
}

export interface FinancialAccountActivity {
  createdAt?: string;
  updatedAt?: string;
  isComplete?: boolean;
  pendingAmount?: ActivityAmount;
  postedAmount?: ActivityAmount;
  sign?: "POSITIVE" | "NEGATIVE";
  source?: ActivitySource;
}

export async function listActivities(financialAccountId: string, pageSize?: number): Promise<FinancialAccountActivity[]> {
  const params = new URLSearchParams({ financialAccountId });
  if (pageSize) params.set("pageSize", String(pageSize));
  const res = await request<{ data: FinancialAccountActivity[] }>(`/api/transactions?${params}`);
  return res.data;
}

// --- Wire Transfers (Review Workflow Events) ---

export interface WireTransferAmount {
  value: number;
  currencyCode: string;
}

export interface WireTransfer {
  __typename: "WireTransfer";
  id: string;
  amount: WireTransferAmount;
  memo?: string;
  status: string;
  statusReason?: string;
  type: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewWorkflowEvent {
  id: string;
  reviewState: string;
  createdAt: string;
  updatedAt: string;
  transfer?: WireTransfer;
}

export async function listWireTransfers(financialAccountId: string): Promise<ReviewWorkflowEvent[]> {
  const res = await request<{ data: ReviewWorkflowEvent[] }>(`/api/financial-accounts/${financialAccountId}/wire-transfers`);
  return res.data;
}

// --- Document Upload ---

export interface DocumentUploadSession {
  id: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
}

export function startDocumentSession(applicationId: string): Promise<DocumentUploadSession> {
  return request<DocumentUploadSession>(`/api/applications/${applicationId}/document-session`, {
    method: "POST",
  });
}

export function getDocumentToken(applicationId: string, documentUploadSessionId: string): Promise<ClientTokenResponse> {
  return request<ClientTokenResponse>(`/api/applications/${applicationId}/document-token`, {
    method: "POST",
    body: JSON.stringify({ documentUploadSessionId }),
  });
}

// --- Physical Card Order ---

export interface OrderPhysicalCardInput {
  nameOnCard: string;
  recipientGivenName: string;
  recipientFamilyName: string;
  streetAddress: string;
  extendedAddress?: string;
  locality: string;
  region: string;
  postalCode: string;
  countryCodeAlpha3?: string;
}

export function orderPhysicalCard(cardId: string, input: OrderPhysicalCardInput) {
  return request<any>(`/api/cards/${cardId}/order-physical`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// --- Financial Account Actions ---

export function suspendFinancialAccount(id: string, memo: string, suspensionReason: string) {
  return request(`/api/financial-accounts/${id}/suspend`, {
    method: "POST",
    body: JSON.stringify({ memo, suspensionReason }),
  });
}

export function unsuspendFinancialAccount(id: string, memo: string) {
  return request(`/api/financial-accounts/${id}/unsuspend`, {
    method: "POST",
    body: JSON.stringify({ memo }),
  });
}

// --- External Bank Accounts ---

export function addNonVerifiedBankAccount(input: {
  accountHolderId: string;
  routingNumber: string;
  accountNumber: string;
  bankAccountType: string;
  name?: string;
}) {
  return request<any>("/api/external-accounts/non-verified", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function addPlaidBankAccount(input: {
  accountHolderId: string;
  processorToken: string;
}) {
  return request<any>("/api/external-accounts/plaid", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function addFinicityBankAccount(input: {
  accountHolderId: string;
  name: string;
  bankAccountType: string;
  receiptId: string;
  customerId: string;
}) {
  return request<any>("/api/external-accounts/finicity", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// --- ATM Locator ---

export interface ATMLocation {
  name?: string;
  description?: string;
  address?: {
    streetAddress?: string;
    extendedAddress?: string;
    locality?: string;
    region?: string;
    postalCode?: string;
    countryCodeAlpha3?: string;
  };
  coordinates?: { latitude: string; longitude: string };
  distance?: { length: number; unit: string };
  features?: string[];
  logo?: { brand?: string };
}

export async function findATMLocations(cardId: string, latitude: string, longitude: string, radiusMiles?: number): Promise<ATMLocation[]> {
  const res = await request<{ data: ATMLocation[] }>("/api/atm/find", {
    method: "POST",
    body: JSON.stringify({ cardId, latitude, longitude, radiusMiles }),
  });
  return res.data;
}

// --- Scheduled Transfers ---

export interface ScheduledTransfer {
  __typename: string;
  id: string;
  createdAt?: string;
  updatedAt?: string;
  status?: string;
  scheduledTransferDate?: string;
  frequency?: string;
  descriptor?: {
    companyEntryDescription?: string;
    individualName?: string;
  };
  transferAmount?: {
    amount?: {
      value: number;
      currencyCode: string;
    };
  };
}

export async function listScheduledTransfers(financialAccountId: string): Promise<ScheduledTransfer[]> {
  const res = await request<{ data: ScheduledTransfer[] }>(`/api/financial-accounts/${financialAccountId}/scheduled-transfers`);
  return res.data;
}

// --- ACH Transfers ---

export function createOneTimeAchTransfer(input: {
  fromFinancialAccountId: string;
  toFinancialAccountId: string;
  amount: number;
  scheduledDate?: string;
}) {
  return request<any>("/api/ach/schedule-one-time", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function cancelAchTransfer(scheduledTransferId: string) {
  return request<any>("/api/ach/cancel", {
    method: "POST",
    body: JSON.stringify({ scheduledTransferId }),
  });
}

export function createRecurringAchTransfer(input: {
  fromFinancialAccountId: string;
  toFinancialAccountId: string;
  amount: number;
  dayOfMonth: number;
}) {
  return request<any>("/api/ach/schedule-recurring", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function initiateAchTransfer(input: {
  fromFinancialAccountId: string;
  toFinancialAccountId: string;
  amount: number;
  purpose: "DEPOSIT" | "WITHDRAWAL";
  companyEntryDescription?: string;
  individualName?: string;
}) {
  return request<any>("/api/ach/transfer", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
