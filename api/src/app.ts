import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
} from "fastify-type-provider-zod";
import fastifyCors from "@fastify/cors";
import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import fastifyStatic from "@fastify/static";
import fastifyRawBody from "fastify-raw-body";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sqlite } from "./db/index.js";
import { registerAuthHook } from "./middleware/auth.js";
import { authRoutes, onboardRoute } from "./routes/auth.js";
import { cardProductRoutes } from "./routes/cardProducts.js";
import { meRoute } from "./routes/me.js";
import { applicationRoutes } from "./routes/applications.js";
import { financialAccountRoutes } from "./routes/financialAccounts.js";
import { cardRoutes } from "./routes/cards.js";
import { transactionRoutes } from "./routes/transactions.js";
import { clientTokenRoutes } from "./routes/clientTokens.js";
import { provisioningRoutes } from "./routes/provisioning.js";
import { simulateRoutes } from "./routes/simulate.js";
import { externalAccountRoutes } from "./routes/externalAccounts.js";
import { achTransferRoutes } from "./routes/ach.js";
import { atmRoutes } from "./routes/atm.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { environment } from "./services/highnote.js";

// Detect a Highnote/GraphQL rate-limit error. The SDK surfaces these as a raw
// graphql-request ClientError (no typed error class), so without this they would
// fall through to a generic HTTP 500.
function isRateLimitError(err: any): boolean {
  if (err?.response?.status === 429) return true;
  // Fallback for SDK errors that don't surface the HTTP status — match
  // Highnote's specific rate-limit phrasing, not the generic words "rate limit".
  const message = String(err?.message ?? "");
  return /usage limit exceeded|request complexity points/i.test(message);
}

function rateLimitRetryAfter(err: any): number {
  const raw = err?.response?.extensions?.rateLimit?.retryAfter;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : 10;
}

export function ensureTables(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      account_holder_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS webhook_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT UNIQUE,
      event_type TEXT NOT NULL,
      is_replay INTEGER NOT NULL DEFAULT 0,
      payload TEXT NOT NULL,
      received_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

/**
 * Build the Fastify app with all routes, plugins, and hooks registered.
 * Does NOT call `app.listen()` or kick off webhook registration — both are
 * the caller's responsibility (see `index.ts`). Tests use `app.inject()` to
 * drive the app in-process without binding a socket.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

  // CORS — the frontend dev server runs cross-origin in development. In
  // production the SPA is served same-origin by this server, so CORS stays
  // disabled unless a cross-origin frontend is explicitly configured.
  const corsOrigin =
    process.env.NODE_ENV === "production"
      ? (process.env.CORS_ORIGIN ?? false)
      : (process.env.CORS_ORIGIN ?? "http://localhost:5173");
  await app.register(fastifyCors, { origin: corsOrigin });

  // Security headers. The CSP allow-list is the minimum needed by the embedded
  // Highnote SDKs (card-viewer / secure-inputs / document-upload all source
  // iframes from cdn.highnote.com and XHR to api.us[.test].highnote.com), the
  // Leaflet basemap tiles (*.basemaps.cartocdn.com), and Google Fonts.
  //
  // `*.highnote.com` is broader than the exact origins observed in the SDK
  // (cdn., api.us., api.us.test.) but tolerates the SDK adding new
  // subdomains in future minor releases without breaking the page. Narrow it
  // if you'd rather pin.
  //
  // Set `CSP_REPORT_ONLY=true` to soak-test changes before enforcing — the
  // browser logs violations to the console instead of blocking them. In dev
  // (`NODE_ENV !== "production"`) the SPA is served by Vite, not this server,
  // so the policy only matters in deployed environments.
  const cspReportOnly = process.env.CSP_REPORT_ONLY === "true";
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      useDefaults: true,
      reportOnly: cspReportOnly,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        // Tailwind v4 injects utility classes as inline <style> blocks at
        // runtime; without 'unsafe-inline' the page renders unstyled.
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "img-src": ["'self'", "data:", "https://*.basemaps.cartocdn.com"],
        "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
        // Highnote SDK iframes (card-viewer / secure-inputs / document-upload).
        "frame-src": ["'self'", "https://*.highnote.com"],
        // SPA → same-origin /api; Highnote SDKs → api.us[.test].highnote.com.
        "connect-src": ["'self'", "https://*.highnote.com"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
      },
    },
  });

  // Rate limiting — opt-in per route (see auth routes), not global, so normal
  // SPA API traffic is unaffected.
  await app.register(fastifyRateLimit, { global: false });

  // Raw body access for webhook signature verification
  await app.register(fastifyRawBody, { field: "rawBody", encoding: "utf8", runFirst: true });

  // Zod validation & serialization
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Global error handler — translates upstream rate limits into a real 429 with a
  // Retry-After header instead of leaking them to the client as a 500.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (isRateLimitError(error)) {
      const retryAfter = rateLimitRetryAfter(error);
      return reply
        .status(429)
        .header("Retry-After", String(retryAfter))
        .send({
          error: "Rate limited",
          message: "The Highnote API rate limit was reached. Please retry shortly.",
          retryAfter,
        });
    }
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    // Server faults are error-level; client faults (validation, etc.) are warn-level noise.
    if (statusCode >= 500) request.log.error(error);
    else request.log.warn(error);
    return reply.status(statusCode).send({
      error: error.name || "Error",
      message: error.message,
      ...(error.validation ? { fieldErrors: error.validation } : {}),
    });
  });

  // OpenAPI spec generation
  await app.register(fastifySwagger, {
    transform: jsonSchemaTransform,
    openapi: {
      info: {
        title: "Bay19 API",
        description: "Consumer prepaid debit card management API powered by the Highnote SDK",
        version: "1.0.0",
      },
      servers: [{ url: "http://localhost:3000" }],
      tags: [
        { name: "Auth", description: "User authentication, onboarding, and account holder creation" },
        { name: "Card Products", description: "Browse available card products" },
        { name: "Applications", description: "Card product applications" },
        { name: "Financial Accounts", description: "Issue and manage financial accounts" },
        { name: "Cards", description: "Issue and manage payment cards" },
        { name: "Transactions", description: "View transaction history" },
        { name: "Provisioning", description: "Provision account holders (application + financial account)" },
        { name: "Client Tokens", description: "Generate scoped client tokens" },
        { name: "Simulation", description: "Test environment simulation tools (test env only)" },
        { name: "Webhooks", description: "Webhook receiver, event viewer, and registration" },
      ],
    },
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: "/docs",
  });

  // Health check
  app.get("/health", async () => ({ status: "ok" }));

  // Environment config (public)
  app.get("/api/config", async () => ({ environment }));

  // Public routes (no auth required) — register BEFORE the auth plugin
  await app.register(authRoutes);
  await app.register(cardProductRoutes);
  await app.register(webhookRoutes);

  // Auth middleware — global hook, skips public paths
  registerAuthHook(app);

  // Protected route modules
  await app.register(onboardRoute);
  await app.register(meRoute);
  await app.register(applicationRoutes);
  await app.register(financialAccountRoutes);
  await app.register(cardRoutes);
  await app.register(transactionRoutes);
  await app.register(clientTokenRoutes);
  await app.register(provisioningRoutes);
  await app.register(externalAccountRoutes);
  await app.register(achTransferRoutes);
  await app.register(atmRoutes);

  // Simulation routes — only registered in test environment
  if (environment === "test") {
    await app.register(simulateRoutes);
  }

  // Serve frontend static files in production
  if (process.env.NODE_ENV === "production") {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    await app.register(fastifyStatic, {
      root: join(__dirname, "..", "public"),
      prefix: "/",
      wildcard: false,
    });

    // SPA fallback — serve index.html for non-API routes
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.status(404).send({ error: "Not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}
