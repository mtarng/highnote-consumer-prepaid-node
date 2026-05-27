import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import jwt from "jsonwebtoken";
import { resetDatabase, seedTestUser, signTestToken } from "../test/helpers.js";
import type { FastifyInstance } from "fastify";

vi.mock("../services/highnote.js", () => ({
  environment: "test",
  cardProductId: "",
  highnote: {
    accountHolders: { get: vi.fn() },
  },
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { setupApp } = await import("../test/helpers.js");
  app = await setupApp();
});

beforeEach(async () => {
  await resetDatabase();
});

describe("JWT auth middleware", () => {
  it("rejects tokens signed with alg: 'none'", async () => {
    // Hand-craft a JWT with alg=none — no signature.
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ userId: 1, email: "a@b.c", accountHolderId: null }),
    ).toString("base64url");
    const noneToken = `${header}.${payload}.`;

    const res = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { authorization: `Bearer ${noneToken}` },
    });

    expect(res.statusCode).toBe(401);
  });

  it("rejects tokens signed with the wrong algorithm (RS256 vs expected HS256)", async () => {
    // Sign with RS256 using a freshly generated RSA key. The middleware
    // restricts verification to HS256, so this token must be rejected even
    // though it's syntactically a valid JWT.
    const { generateKeyPairSync } = await import("node:crypto");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const wrongAlgToken = jwt.sign(
      { userId: 1, email: "a@b.c", accountHolderId: null },
      privateKey.export({ type: "pkcs1", format: "pem" }),
      { algorithm: "RS256" },
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { authorization: `Bearer ${wrongAlgToken}` },
    });

    expect(res.statusCode).toBe(401);
  });

  it("accepts a valid HS256 token signed with the configured secret", async () => {
    const { user } = await seedTestUser();
    const token = signTestToken({
      userId: user.id,
      email: user.email,
      accountHolderId: null,
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { authorization: `Bearer ${token}` },
    });

    // No accountHolderId on the seeded user, so handler returns 200 with
    // accountHolder: null. The fact that we got past 401 is the assertion.
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 with no Authorization header", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me" });
    expect(res.statusCode).toBe(401);
  });
});
