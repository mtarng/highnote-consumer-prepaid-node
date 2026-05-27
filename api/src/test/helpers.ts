import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";

/**
 * Test helpers shared across route test files.
 *
 * Conventions:
 * - Each test file mocks `../services/highnote.js` with vi.mock so route
 *   handlers see a stubbed Highnote SDK.
 * - Each test file imports `buildApp` AFTER its vi.mock declarations.
 * - The DB is in-memory and shared across tests in a single file; use
 *   `resetDatabase()` in `beforeEach` to start clean.
 */

const JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret-please-do-not-use-in-prod";

export function signTestToken(opts: {
  userId: number;
  email: string;
  accountHolderId?: string | null;
}): string {
  return jwt.sign(
    {
      userId: opts.userId,
      email: opts.email,
      accountHolderId: opts.accountHolderId ?? null,
    },
    JWT_SECRET,
    { algorithm: "HS256", expiresIn: "1h" },
  );
}

export async function seedTestUser(opts?: {
  email?: string;
  password?: string;
  accountHolderId?: string | null;
}) {
  const { db, schema } = await import("../db/index.js");
  const email = opts?.email ?? `test-${Date.now()}-${Math.random()}@example.com`;
  const password = opts?.password ?? "correct horse battery staple";
  const passwordHash = await bcrypt.hash(password, 4);

  const [user] = await db
    .insert(schema.users)
    .values({
      email,
      passwordHash,
      accountHolderId: opts?.accountHolderId ?? null,
    })
    .returning();

  return { user, email, password };
}

export async function resetDatabase() {
  const { sqlite } = await import("../db/index.js");
  sqlite.exec("DELETE FROM users; DELETE FROM webhook_events;");
}

export async function authHeaderFor(opts: {
  userId: number;
  email: string;
  accountHolderId?: string | null;
}) {
  return { authorization: `Bearer ${signTestToken(opts)}` };
}

export async function setupApp() {
  const { buildApp, ensureTables } = await import("../app.js");
  ensureTables();
  const app = await buildApp();
  await app.ready();
  return app;
}

export async function setUserAccountHolder(userId: number, accountHolderId: string) {
  const { db, schema } = await import("../db/index.js");
  await db
    .update(schema.users)
    .set({ accountHolderId })
    .where(eq(schema.users.id, userId));
}
