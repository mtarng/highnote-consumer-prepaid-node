import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { seedTestUser, resetDatabase } from "../test/helpers.js";
import type { FastifyInstance } from "fastify";

vi.mock("../services/highnote.js", () => ({
  environment: "test",
  cardProductId: "",
  highnote: { accountHolders: { createUSPerson: vi.fn() } },
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { setupApp } = await import("../test/helpers.js");
  app = await setupApp();
});

beforeEach(async () => {
  await resetDatabase();
});

describe("POST /api/auth/login", () => {
  it("returns 401 for wrong password", async () => {
    const { email } = await seedTestUser({ password: "the-real-password" });

    const start = Date.now();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password: "wrong-password" },
      remoteAddress: "10.1.0.1",
    });
    const elapsed = Date.now() - start;

    expect(res.statusCode).toBe(401);
    // bcrypt with cost 4 (test helper) still adds meaningful work; the real
    // route uses cost 12. Sanity check that compare actually ran.
    expect(elapsed).toBeGreaterThan(2);
  });

  it("returns 401 for unknown email AND still runs bcrypt (constant-time-ish)", async () => {
    const start = Date.now();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "no-such-user@example.com", password: "anything" },
      remoteAddress: "10.1.0.2",
    });
    const elapsed = Date.now() - start;

    expect(res.statusCode).toBe(401);
    // The dummy hash in routes/auth.ts is cost 12 — much slower than the
    // ~ms variance of "user not found, return 401". 50ms is a generous
    // floor that should reliably distinguish "bcrypt ran" from "early return".
    expect(elapsed).toBeGreaterThan(50);
  });

  it("returns a token on correct credentials", async () => {
    const { email, password } = await seedTestUser();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password },
      remoteAddress: "10.1.0.3",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { token: string; user: { email: string } };
    expect(body.token).toMatch(/^eyJ/);
    expect(body.user.email).toBe(email);
  });

  it("rate-limits to 5 logins per minute (6th attempt returns 429)", async () => {
    const { email } = await seedTestUser({ password: "the-real-password" });
    // Dedicated IP for this test so the bucket starts empty.
    const ip = "10.99.0.1";

    for (let i = 0; i < 5; i += 1) {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email, password: "wrong" },
        remoteAddress: ip,
      });
      expect(res.statusCode).toBe(401);
    }

    const sixth = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password: "wrong" },
      remoteAddress: ip,
    });
    expect(sixth.statusCode).toBe(429);
  });
});
