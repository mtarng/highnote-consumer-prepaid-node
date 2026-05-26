import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";
import { highnote } from "../services/highnote.js";

const JWT_SECRET = process.env.JWT_SECRET ?? (() => {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "JWT_SECRET is required when NODE_ENV=production (any hosted instance " +
        "of this demo). On Render it is auto-generated; set it explicitly on " +
        "other hosts. See SECURITY.md for what \"production\" means here.",
    );
  }
  // Local dev: per-process random secret. Tokens invalidate on restart.
  return randomBytes(32).toString("hex");
})();

export interface AuthUser {
  id: number;
  email: string;
  accountHolderId: string | null;
}

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser;
  }
}

/** Verify the JWT and attach `request.user` from claims (no DB lookup). */
async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return reply.status(401).send({ error: "Missing or invalid Authorization header" });
  }

  const token = authHeader.slice(7);

  let payload: { userId: number; email: string; accountHolderId: string | null };
  try {
    payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) as typeof payload;
  } catch {
    return reply.status(401).send({ error: "Invalid or expired token" });
  }

  request.user = {
    id: payload.userId,
    email: payload.email,
    accountHolderId: payload.accountHolderId ?? null,
  };
}

/**
 * Register the auth hook globally on the Fastify instance.
 * Skips public paths; all others require a valid JWT.
 */
export function registerAuthHook(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    const url = request.url;
    // Skip auth for non-API routes (static files, SPA fallback in production)
    if (!url.startsWith("/api/")) {
      return;
    }
    if (
      url.startsWith("/api/auth") ||
      url.startsWith("/api/card-products") ||
      url === "/api/config" ||
      (url === "/api/webhooks" && request.method === "POST")
    ) {
      return;
    }
    await authenticate(request, reply);
  });
}

/**
 * Returns the authenticated user's account holder ID, or throws 403.
 */
export function getUserAccountHolderId(request: FastifyRequest): string {
  const id = request.user.accountHolderId;
  if (!id) {
    throw Object.assign(new Error("No account holder linked to this user"), {
      statusCode: 403,
    });
  }
  return id;
}

// Simple in-memory cache to avoid hammering Highnote API on every request
const resourceCache = new Map<string, {
  financialAccountIds: Set<string>;
  cardIds: Set<string>;
  externalAccountIds: Set<string>;
  expiresAt: number;
}>();
const CACHE_TTL_MS = 60_000; // 1 minute

/**
 * Fetches the user's account holder and returns sets of their financial account
 * IDs, card IDs, and external (linked bank) account IDs for ownership checks.
 * Cached per account holder for 1 minute.
 */
export async function getUserResourceIds(request: FastifyRequest): Promise<{
  financialAccountIds: Set<string>;
  cardIds: Set<string>;
  externalAccountIds: Set<string>;
}> {
  const accountHolderId = getUserAccountHolderId(request);

  const cached = resourceCache.get(accountHolderId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  const holder = await highnote.accountHolders.get(accountHolderId);

  const financialAccountIds = new Set<string>();
  const cardIds = new Set<string>();
  const externalAccountIds = new Set<string>();

  const financialAccounts =
    ("financialAccounts" in holder && holder.financialAccounts?.edges) || [];

  for (const edge of financialAccounts) {
    if (!edge?.node) continue;
    financialAccountIds.add(edge.node.id);
    const cards = edge.node.paymentCards?.edges || [];
    for (const cardEdge of cards) {
      if (cardEdge?.node) cardIds.add(cardEdge.node.id);
    }
  }

  const externalAccounts =
    ("externalFinancialAccounts" in holder && holder.externalFinancialAccounts?.edges) || [];

  for (const edge of externalAccounts) {
    if (edge?.node) externalAccountIds.add(edge.node.id);
  }

  const result = {
    financialAccountIds,
    cardIds,
    externalAccountIds,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  resourceCache.set(accountHolderId, result);
  return result;
}

/** Invalidate the resource cache for a user (call after issuing cards/accounts). */
export function invalidateResourceCache(accountHolderId: string): void {
  resourceCache.delete(accountHolderId);
}

/** Add a card ID to the cached set so it's immediately recognized for ownership checks. */
export function addCardToResourceCache(accountHolderId: string, cardId: string): void {
  const cached = resourceCache.get(accountHolderId);
  if (cached && cached.expiresAt > Date.now()) {
    cached.cardIds.add(cardId);
  }
}

/** Add a financial account ID to the cached set. */
export function addAccountToResourceCache(accountHolderId: string, accountId: string): void {
  const cached = resourceCache.get(accountHolderId);
  if (cached && cached.expiresAt > Date.now()) {
    cached.financialAccountIds.add(accountId);
  }
}

/** Add an external (linked bank) account ID to the cached set. */
export function addExternalAccountToResourceCache(accountHolderId: string, externalAccountId: string): void {
  const cached = resourceCache.get(accountHolderId);
  if (cached && cached.expiresAt > Date.now()) {
    cached.externalAccountIds.add(externalAccountId);
  }
}

export { JWT_SECRET };
