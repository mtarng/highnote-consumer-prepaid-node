import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { randomUUID } from "crypto";
import { highnote } from "../services/highnote.js";
import { HighnoteUserError, HighnoteAccessDeniedError } from "@highnote-oss/nodejs-sdk";
import { InitiateAchTransferBodySchema, CreateOneTimeAchTransferBodySchema, CreateRecurringAchTransferBodySchema, CancelScheduledTransferBodySchema } from "../types.js";
import { getUserResourceIds, getUserAccountHolderId } from "../middleware/auth.js";

function handleError(err: unknown, reply: any) {
  if (err instanceof HighnoteUserError) {
    console.error("Highnote UserError:", JSON.stringify(err.fieldErrors, null, 2));
    return reply.status(400).send({ error: "Highnote validation error", fieldErrors: err.fieldErrors });
  }
  if (err instanceof HighnoteAccessDeniedError) {
    return reply.status(403).send({ error: "Access denied", message: err.message });
  }
  throw err;
}

function toAmount(dollars: number) {
  return { value: Math.round(dollars * 100), currencyCode: "USD" as any };
}

/** True only if both ACH transfer endpoints belong to the authenticated user. */
async function ownsBothEndpoints(
  request: FastifyRequest,
  fromId: string,
  toId: string,
): Promise<boolean> {
  const { financialAccountIds, externalAccountIds } = await getUserResourceIds(request);
  const owned = new Set([...financialAccountIds, ...externalAccountIds]);
  return owned.has(fromId) && owned.has(toId);
}

/**
 * True if the scheduled transfer is incoming to one of the user's financial
 * accounts. The SDK exposes no scheduled-transfer getter, so ownership is
 * resolved by scanning the user's own accounts.
 */
async function ownsScheduledTransfer(
  request: FastifyRequest,
  scheduledTransferId: string,
): Promise<boolean> {
  const { financialAccountIds } = await getUserResourceIds(request);
  for (const faId of financialAccountIds) {
    const account = (await highnote.financialAccounts.get(faId)) as {
      incomingScheduledTransfers?: { edges?: Array<{ node?: { id: string } | null } | null> };
    };
    const edges = account.incomingScheduledTransfers?.edges ?? [];
    if (edges.some((e) => e?.node?.id === scheduledTransferId)) return true;
  }
  return false;
}

export async function achTransferRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.post("/api/ach/transfer", {
    schema: {
      tags: ["ACH"],
      description: "Initiate an originated ACH transfer (pull or push)",
      body: InitiateAchTransferBodySchema,
    },
  }, async (request, reply) => {
    try {
      const { fromFinancialAccountId, toFinancialAccountId, amount, purpose, companyEntryDescription, individualName } = request.body;
      if (!(await ownsBothEndpoints(request, fromFinancialAccountId, toFinancialAccountId))) {
        return reply.status(403).send({ error: "One or more accounts do not belong to this user" });
      }
      const result = await highnote.ach.initiateTransfer({
        fromFinancialAccountId,
        toFinancialAccountId,
        amount: toAmount(amount),
        purpose: purpose as any,
        companyEntryDescription: companyEntryDescription!,
        individualName: individualName!,
        idempotencyKey: randomUUID(),
        transferAgreementConsent: {
          authorizedPersonId: getUserAccountHolderId(request),
          consentTimestamp: new Date().toISOString(),
          template: {
            consentTemplateId: "ach_transfer_consent_v1",
            consentTemplateVersion: "1.0",
          },
        },
      });
      return result;
    } catch (err) {
      return handleError(err, reply);
    }
  });

  typedApp.post("/api/ach/schedule-one-time", {
    schema: {
      tags: ["ACH"],
      description: "Schedule a one-time ACH transfer",
      body: CreateOneTimeAchTransferBodySchema,
    },
  }, async (request, reply) => {
    try {
      const { fromFinancialAccountId, toFinancialAccountId, amount, scheduledDate, companyEntryDescription, individualName } = request.body;
      if (!(await ownsBothEndpoints(request, fromFinancialAccountId, toFinancialAccountId))) {
        return reply.status(403).send({ error: "One or more accounts do not belong to this user" });
      }
      const result = await highnote.ach.createOneTimeTransfer({
        descriptor: {
          companyEntryDescription: companyEntryDescription!,
          individualName: individualName!,
        },
        fromFinancialAccountId,
        toFinancialAccountId,
        transferAmountStrategy: {
          transferAmount: toAmount(amount),
        },
        ...(scheduledDate ? { transferDateStrategy: { transferDate: scheduledDate } } : {}),
        transferAgreementConsent: {
          authorizedPersonId: getUserAccountHolderId(request),
          consentTimestamp: new Date().toISOString(),
          template: {
            consentTemplateId: "ach_transfer_consent_v1",
            consentTemplateVersion: "1.0",
          },
        },
      });
      return result;
    } catch (err) {
      return handleError(err, reply);
    }
  });

  typedApp.post("/api/ach/schedule-recurring", {
    schema: {
      tags: ["ACH"],
      description: "Schedule a recurring monthly ACH transfer",
      body: CreateRecurringAchTransferBodySchema,
    },
  }, async (request, reply) => {
    try {
      const { fromFinancialAccountId, toFinancialAccountId, amount, dayOfMonth, companyEntryDescription, individualName } = request.body;
      if (!(await ownsBothEndpoints(request, fromFinancialAccountId, toFinancialAccountId))) {
        return reply.status(403).send({ error: "One or more accounts do not belong to this user" });
      }
      const result = await highnote.ach.createRecurringTransfer({
        descriptor: {
          companyEntryDescription: companyEntryDescription!,
          individualName: individualName!,
        },
        fromFinancialAccountId,
        toFinancialAccountId,
        frequency: "MONTHLY" as any,
        transferAmountStrategy: {
          transferAmount: toAmount(amount),
        },
        transferDayStrategy: { transferDayOfMonth: dayOfMonth },
        transferAgreementConsent: {
          authorizedPersonId: getUserAccountHolderId(request),
          consentTimestamp: new Date().toISOString(),
          template: {
            consentTemplateId: "ach_transfer_consent_v1",
            consentTemplateVersion: "1.0",
          },
        },
      });
      return result;
    } catch (err) {
      return handleError(err, reply);
    }
  });

  typedApp.post("/api/ach/cancel", {
    schema: {
      tags: ["ACH"],
      description: "Cancel a scheduled ACH transfer",
      body: CancelScheduledTransferBodySchema,
    },
  }, async (request, reply) => {
    try {
      const { scheduledTransferId } = request.body;
      if (!(await ownsScheduledTransfer(request, scheduledTransferId))) {
        return reply.status(403).send({ error: "Scheduled transfer does not belong to this user" });
      }
      const result = await highnote.ach.cancelTransfer({ scheduledTransferId });
      return result;
    } catch (err) {
      return handleError(err, reply);
    }
  });
}
