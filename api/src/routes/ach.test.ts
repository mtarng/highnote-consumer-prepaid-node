import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { resetDatabase, seedTestUser, signTestToken } from "../test/helpers.js";
import type { FastifyInstance } from "fastify";

const mockAccountHolderGet = vi.fn();
const mockFinancialAccountGet = vi.fn();
const mockInitiateTransfer = vi.fn();
const mockCreateOneTime = vi.fn();
const mockCreateRecurring = vi.fn();
const mockCancelTransfer = vi.fn();

vi.mock("../services/highnote.js", () => ({
  environment: "test",
  cardProductId: "",
  highnote: {
    accountHolders: { get: mockAccountHolderGet },
    financialAccounts: { get: mockFinancialAccountGet },
    ach: {
      initiateTransfer: mockInitiateTransfer,
      createOneTimeTransfer: mockCreateOneTime,
      createRecurringTransfer: mockCreateRecurring,
      cancelTransfer: mockCancelTransfer,
    },
  },
}));

let app: FastifyInstance;

const OWN_AH = "ah_own";
const OWN_FA = "fa_own";
const OWN_EXT = "ext_own";
const FOREIGN_ID = "ext_someone_else";

beforeAll(async () => {
  const { setupApp } = await import("../test/helpers.js");
  app = await setupApp();
});

beforeEach(async () => {
  await resetDatabase();
  mockAccountHolderGet.mockReset();
  mockFinancialAccountGet.mockReset();
  mockInitiateTransfer.mockReset();
  mockCreateOneTime.mockReset();
  mockCreateRecurring.mockReset();
  mockCancelTransfer.mockReset();

  // Default: caller owns OWN_FA (financial) and OWN_EXT (external).
  mockAccountHolderGet.mockResolvedValue({
    id: OWN_AH,
    financialAccounts: {
      edges: [{ node: { id: OWN_FA, paymentCards: { edges: [] } } }],
    },
    externalFinancialAccounts: {
      edges: [{ node: { id: OWN_EXT } }],
    },
  });
});

async function makeBearer(accountHolderId: string | null = OWN_AH) {
  const { user } = await seedTestUser({
    email: `u-${Date.now()}-${Math.random()}@example.com`,
    accountHolderId,
  });
  return signTestToken({
    userId: user.id,
    email: user.email,
    accountHolderId,
  });
}

describe("POST /api/ach/transfer (initiate)", () => {
  it("allows the transfer when both endpoints are owned", async () => {
    const token = await makeBearer();
    mockInitiateTransfer.mockResolvedValue({ id: "tx_1" });

    const res = await app.inject({
      method: "POST",
      url: "/api/ach/transfer",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        fromFinancialAccountId: OWN_FA,
        toFinancialAccountId: OWN_EXT,
        amount: 10,
        purpose: "DEPOSIT",
        companyEntryDescription: "TEST",
        individualName: "Test User",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockInitiateTransfer).toHaveBeenCalledOnce();
  });

  it("returns 403 when fromFinancialAccountId is not owned", async () => {
    const token = await makeBearer();

    const res = await app.inject({
      method: "POST",
      url: "/api/ach/transfer",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        fromFinancialAccountId: FOREIGN_ID,
        toFinancialAccountId: OWN_EXT,
        amount: 10,
        purpose: "DEPOSIT",
        companyEntryDescription: "TEST",
        individualName: "Test User",
      },
    });

    expect(res.statusCode).toBe(403);
    expect(mockInitiateTransfer).not.toHaveBeenCalled();
  });

  it("returns 403 when toFinancialAccountId is not owned", async () => {
    const token = await makeBearer();

    const res = await app.inject({
      method: "POST",
      url: "/api/ach/transfer",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        fromFinancialAccountId: OWN_FA,
        toFinancialAccountId: FOREIGN_ID,
        amount: 10,
        purpose: "DEPOSIT",
        companyEntryDescription: "TEST",
        individualName: "Test User",
      },
    });

    expect(res.statusCode).toBe(403);
    expect(mockInitiateTransfer).not.toHaveBeenCalled();
  });

  it("returns 401 without a bearer token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/ach/transfer",
      payload: {
        fromFinancialAccountId: OWN_FA,
        toFinancialAccountId: OWN_EXT,
        amount: 10,
        purpose: "DEPOSIT",
        companyEntryDescription: "TEST",
        individualName: "Test User",
      },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /api/ach/cancel", () => {
  it("returns 403 for a scheduledTransferId not in any user financial account's incomingScheduledTransfers", async () => {
    const token = await makeBearer();
    mockFinancialAccountGet.mockResolvedValue({
      id: OWN_FA,
      incomingScheduledTransfers: { edges: [] },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/ach/cancel",
      headers: { authorization: `Bearer ${token}` },
      payload: { scheduledTransferId: "sch_foreign" },
    });

    expect(res.statusCode).toBe(403);
    expect(mockCancelTransfer).not.toHaveBeenCalled();
  });

  it("allows cancel when the scheduledTransferId is incoming to an owned account", async () => {
    const token = await makeBearer();
    mockFinancialAccountGet.mockResolvedValue({
      id: OWN_FA,
      incomingScheduledTransfers: { edges: [{ node: { id: "sch_mine" } }] },
    });
    mockCancelTransfer.mockResolvedValue({ id: "sch_mine", status: "CANCELLED" });

    const res = await app.inject({
      method: "POST",
      url: "/api/ach/cancel",
      headers: { authorization: `Bearer ${token}` },
      payload: { scheduledTransferId: "sch_mine" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockCancelTransfer).toHaveBeenCalledOnce();
  });
});
