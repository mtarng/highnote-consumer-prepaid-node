import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { resetDatabase, seedTestUser, signTestToken } from "../test/helpers.js";
import type { FastifyInstance } from "fastify";

const mockAccountHolderGet = vi.fn();
const mockAddNonVerified = vi.fn();
const mockCreateOneTime = vi.fn();

vi.mock("../services/highnote.js", () => ({
  environment: "test",
  cardProductId: "",
  highnote: {
    accountHolders: { get: mockAccountHolderGet },
    externalAccounts: { addNonVerified: mockAddNonVerified },
    ach: { createOneTimeTransfer: mockCreateOneTime },
  },
}));

let app: FastifyInstance;

const OWN_AH = "ah_own";

beforeAll(async () => {
  const { setupApp } = await import("../test/helpers.js");
  app = await setupApp();
});

beforeEach(async () => {
  await resetDatabase();
  mockAccountHolderGet.mockReset();
  mockAddNonVerified.mockReset();
  mockCreateOneTime.mockReset();
});

async function bearerFor(accountHolderId: string | null) {
  const { user } = await seedTestUser({
    accountHolderId,
    email: `u-${Date.now()}-${Math.random()}@example.com`,
  });
  return signTestToken({
    userId: user.id,
    email: user.email,
    accountHolderId,
  });
}

describe("POST /api/external-accounts/non-verified", () => {
  it("returns 403 when body accountHolderId is not the caller's", async () => {
    const token = await bearerFor(OWN_AH);

    const res = await app.inject({
      method: "POST",
      url: "/api/external-accounts/non-verified",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        accountHolderId: "ah_someone_else",
        routingNumber: "021000021",
        accountNumber: "1234567890",
        bankAccountType: "SAVINGS",
      },
    });

    expect(res.statusCode).toBe(403);
    expect(mockAddNonVerified).not.toHaveBeenCalled();
  });

  it("returns 401 without a bearer token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/external-accounts/non-verified",
      payload: {
        accountHolderId: OWN_AH,
        routingNumber: "021000021",
        accountNumber: "1234567890",
        bankAccountType: "SAVINGS",
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("primes the resource cache with the new external account ID", async () => {
    // Behavioral assertion: after adding an external account, the caller can
    // immediately use the new ID in an ACH transfer without a 403. Proves
    // `addExternalAccountToResourceCache` actually populates the cache.
    const token = await bearerFor(OWN_AH);

    mockAccountHolderGet.mockResolvedValue({
      id: OWN_AH,
      financialAccounts: { edges: [{ node: { id: "fa_own", paymentCards: { edges: [] } } }] },
      externalFinancialAccounts: { edges: [] },
    });
    mockAddNonVerified.mockResolvedValue({ id: "ext_new" });
    mockCreateOneTime.mockResolvedValue({ id: "transfer_1" });

    // 1) Warm the resource cache via an ACH request (fa_own → fa_own is
    //    fine here as the gate only needs both IDs to be owned).
    const warm = await app.inject({
      method: "POST",
      url: "/api/ach/schedule-one-time",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        fromFinancialAccountId: "fa_own",
        toFinancialAccountId: "fa_own",
        amount: 1,
        companyEntryDescription: "TEST",
        individualName: "Test User",
      },
    });
    expect(warm.statusCode).toBe(200);

    // 2) Add a new external account.
    const add = await app.inject({
      method: "POST",
      url: "/api/external-accounts/non-verified",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        accountHolderId: OWN_AH,
        routingNumber: "021000021",
        accountNumber: "1234567890",
        bankAccountType: "SAVINGS",
      },
    });
    expect(add.statusCode).toBe(200);

    // 3) Immediately use the new external ID in an ACH request — must NOT
    //    re-fetch the holder (cache still warm) and must NOT 403.
    mockAccountHolderGet.mockClear();
    const use = await app.inject({
      method: "POST",
      url: "/api/ach/schedule-one-time",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        fromFinancialAccountId: "fa_own",
        toFinancialAccountId: "ext_new",
        amount: 5,
        companyEntryDescription: "TEST",
        individualName: "Test User",
      },
    });
    expect(use.statusCode).toBe(200);
    expect(mockAccountHolderGet).not.toHaveBeenCalled();
  });
});
