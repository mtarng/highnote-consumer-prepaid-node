import { describe, it, expect, beforeAll, vi } from "vitest";
import { seedTestUser, signTestToken } from "../test/helpers.js";
import type { FastifyInstance } from "fastify";

vi.mock("../services/highnote.js", () => ({
  environment: "test",
  cardProductId: "",
  highnote: { webhooks: { add: vi.fn() } },
}));

let app: FastifyInstance;
let bearer: string;

beforeAll(async () => {
  const { setupApp } = await import("../test/helpers.js");
  app = await setupApp();
  const { user } = await seedTestUser();
  bearer = signTestToken({
    userId: user.id,
    email: user.email,
    accountHolderId: null,
  });
});

describe("POST /api/webhooks (receiver)", () => {
  it("returns 503 when no signing secret is in memory", async () => {
    // No `webhookRegistration.init()` was called in tests — `getSecret()`
    // is null, so the receiver MUST reject rather than silently accept
    // unverifiable events.
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks",
      payload: { id: "evt_1", name: "TEST_EVENT" },
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: /signing key/i });
  });

  it("returns 400 for an empty body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks",
      // Empty payload — handler bails before signature check.
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /api/webhooks/register", () => {
  it("returns 400 when body provided but no WEBHOOK_PUBLIC_URL is configured", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/register",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      },
      payload: {
        name: "test-target",
        subscriptions: ["ACCOUNT_HOLDER_CREATED"],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: /no public webhook url configured/i,
    });
  });

  it("ignores X-Forwarded-Host (no header-derived URL path)", async () => {
    // Even with an attacker-controlled X-Forwarded-Host, the public URL is
    // resolved purely from server env (WEBHOOK_PUBLIC_URL / RENDER_EXTERNAL_URL).
    // The 400 still fires when env is unset — proves the resolver does not
    // fall through to request headers.
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/register",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
        "x-forwarded-host": "evil.example.com",
        host: "evil.example.com",
      },
      payload: {
        name: "test-target",
        subscriptions: ["ACCOUNT_HOLDER_CREATED"],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: /no public webhook url configured/i,
    });
  });

  it("returns 401 without a bearer token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/register",
      payload: { name: "x", subscriptions: ["ACCOUNT_HOLDER_CREATED"] },
    });
    expect(res.statusCode).toBe(401);
  });
});
