import "dotenv/config";
import { buildApp, ensureTables } from "./app.js";
import * as webhookRegistration from "./services/webhookRegistration.js";

const port = parseInt(process.env.PORT ?? "3000", 10);

const app = await buildApp();

try {
  ensureTables();
  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`Bay19 API running on http://localhost:${port}`);

  // Fire-and-forget: webhook registration runs in the background after listen.
  // Errors are caught internally and surfaced via /api/webhooks/status.
  void webhookRegistration.init();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
