import { useState, useRef, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listCardProducts,
  createApplication,
  getApplication,
  getMe,
  issueFinancialAccount,
  provision,
  startDocumentSession,
  getDocumentToken,
  type CardProduct,
  type Application,
  type MeResponse,
} from "../api/client";
import { initializeDocumentUploadSdk } from "@highnoteplatform/document-upload";
import { NavBar } from "../components/NavBar";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { ErrorMessage } from "../components/ErrorMessage";
import { EmptyState } from "../components/EmptyState";
import { useEnvironment } from "../context/EnvironmentContext";

type ApplyStep = "select" | "applying" | "document_upload" | "document_submitted" | "approved" | "issuing" | "done" | "processing";

const WORKFLOW_LABELS: Record<string, string> = {
  IDENTITY: "Identity Verification",
  RISK: "Risk Assessment",
  BUSINESS_RULE_VALIDATION: "Business Rules",
  CREDIT_UNDERWRITING: "Credit Underwriting",
  CREATE_VPA_BUYER: "Visa Provisioning",
  EXTERNAL_BANK_ONBOARDING: "Bank Onboarding",
  OFFER_MANAGEMENT: "Offer Management",
};

// The Highnote document-upload SDK renders option labels as the raw enum value
// (e.g. "DRIVERS_LICENSE") suffixed with "(Recommended)" when applicable. Map
// to friendly names; unknown enums fall back to a generic Title Case formatter.
const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  DRIVERS_LICENSE: "Driver's License",
  LEASE_AGREEMENT: "Lease Agreement",
  UTILITY_BILL: "Utility Bill",
  PASSPORT: "Passport",
  STATE_ID: "State ID",
};

function humanizeEnumLabel(raw: string): string {
  if (DOCUMENT_TYPE_LABELS[raw]) return DOCUMENT_TYPE_LABELS[raw];
  // The SDK occasionally feeds the option label through its own humanizer
  // before we see it (e.g. "utility bill" with lowercase b after the
  // dropdown is rebuilt mid-session). Normalize the separators first so a
  // mid-pass UPPERCASE_ENUM and an already-humanized "lowercase phrase"
  // both end up Title Cased.
  const normalized = raw.toLowerCase().split(/[_\s]+/).filter(Boolean);
  return normalized.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

// Sentinel value for the "Select a document type" placeholder we inject at
// the top of the SDK dropdown. The SDK reads `select.options[selectedIndex].value`
// when Upload is clicked — a sentinel string makes the placeholder
// distinguishable both for the click guard below and from any real document
// enum the SDK might add in future.
const DOC_TYPE_PLACEHOLDER_VALUE = "__doc_type_placeholder__";

function humanizeSdkLabels(root: ParentNode): void {
  const select = root.querySelector("#document-sdk-type");
  if (!(select instanceof HTMLSelectElement)) return;
  for (const opt of Array.from(select.options)) {
    if (opt.value === DOC_TYPE_PLACEHOLDER_VALUE) continue;
    const recommended = /\(\s*recommended\s*\)/i.test(opt.text);
    const stripped = opt.text.replace(/\s*\(\s*recommended\s*\)\s*$/i, "").trim();
    const humanized = humanizeEnumLabel(stripped);
    const next = recommended ? `${humanized} — Recommended` : humanized;
    if (opt.text !== next) opt.text = next;
  }
}

function ensureDocumentTypePlaceholder(root: ParentNode): void {
  const select = root.querySelector("#document-sdk-type");
  if (!(select instanceof HTMLSelectElement)) return;
  const exists = Array.from(select.options).some(
    (o) => o.value === DOC_TYPE_PLACEHOLDER_VALUE,
  );
  if (exists) return;
  const placeholder = document.createElement("option");
  placeholder.value = DOC_TYPE_PLACEHOLDER_VALUE;
  placeholder.text = "Select a document type";
  placeholder.disabled = true;
  placeholder.hidden = true;
  select.insertBefore(placeholder, select.firstChild);
  placeholder.selected = true;
}

export function ApplyPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { isTestEnv } = useEnvironment();
  const [step, setStep] = useState<ApplyStep>("select");
  const [error, setError] = useState<string | null>(null);
  const [application, setApplication] = useState<Application | null>(null);
  const [accountName, setAccountName] = useState("My Card Account");
  const [selectedProduct, setSelectedProduct] = useState<CardProduct | null>(null);
  const [documentUploading, setDocumentUploading] = useState(false);
  const documentUploadRef = useRef<{ unmount: () => void; endSession: () => Promise<boolean> } | null>(null);
  const sdkObserverRef = useRef<MutationObserver | null>(null);
  const abortRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    abortRef.current = false;
    return () => {
      abortRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      sdkObserverRef.current?.disconnect();
      sdkObserverRef.current = null;
      if (documentUploadRef.current) {
        documentUploadRef.current.unmount();
        documentUploadRef.current = null;
      }
    };
  }, []);

  // Resume an existing application from query param
  useEffect(() => {
    const appId = searchParams.get("applicationId");
    if (appId) {
      setStep("applying");
      pollApplication(appId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    data: products,
    isLoading,
    error: productsError,
  } = useQuery({
    queryKey: ["card-products"],
    queryFn: listCardProducts,
  });

  async function pollApplication(appId: string) {
    try {
      let currentApp = await getApplication(appId);
      if (abortRef.current) return;
      setApplication(currentApp);

      let attempts = 0;
      const status = () => currentApp.applicationState?.status ?? "PENDING";
      const verificationReason = () =>
        currentApp.accountHolderSnapshot?.currentVerification?.reason;

      while (status() !== "APPROVED" && status() !== "DENIED" && attempts < 60) {
        // Check if document upload is required
        if (status() === "IN_REVIEW" && verificationReason() === "DOCUMENT_UPLOAD_REQUIRED") {
          setStep("document_upload");
          return;
        }
        if (abortRef.current) break;
        await new Promise((resolve) => setTimeout(resolve, 5000));
        currentApp = await getApplication(appId);
        if (abortRef.current) break;
        setApplication(currentApp);
        attempts++;
      }

      if (status() === "APPROVED") {
        setStep("approved");
      } else if (status() === "DENIED") {
        setError("Your application was declined.");
        setStep("select");
      } else if (!abortRef.current) {
        setError("Application review is taking longer than expected. Check back from the dashboard.");
        setStep("select");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to check application status");
      setStep("select");
    }
  }

  async function handleApply(product: CardProduct) {
    setSelectedProduct(product);
    setError(null);
    setStep("applying");

    try {
      // Use the provisioning endpoint which orchestrates application + financial account
      const provisionStartTime = Date.now();
      await provision(product.id, accountName);

      // Provisioning is fire-and-forget; poll /api/me to pick up results
      setStep("applying");
      await pollMe(provisionStartTime);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit application");
      setStep("select");
    }
  }

  async function pollMe(provisionStartTime: number) {
    const POLL_INTERVAL = 5_000; // 5 seconds
    const POLL_TIMEOUT = 120_000; // 2 minutes
    const start = Date.now();

    while (Date.now() - start < POLL_TIMEOUT) {
      if (abortRef.current) return;
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
      if (abortRef.current) return;

      // Refetch the "me" query
      const meData = await queryClient.fetchQuery<MeResponse>({
        queryKey: ["me"],
        queryFn: getMe,
        staleTime: 0,
      });

      const apps = meData?.accountHolder?.cardProductApplications?.edges ?? [];
      const accounts = meData?.accountHolder?.financialAccounts?.edges ?? [];

      // Check if a financial account has appeared (provisioning completed)
      if (accounts.length > 0) {
        setStep("done");
        timerRef.current = setTimeout(() => navigate("/"), 1500);
        return;
      }

      // Filter to recent applications (created after provision call) with active statuses
      const recentApps = apps.filter((edge) => {
        const app = edge.node;
        const status = app.applicationState?.status;
        const createdAt = app.createdAt ? new Date(app.createdAt).getTime() : 0;
        return createdAt >= provisionStartTime || status === "PENDING" || status === "IN_REVIEW";
      });

      // Check application status from the me data
      if (recentApps.length > 0) {
        const latestApp = recentApps[recentApps.length - 1].node;
        setApplication(latestApp);
        const appStatus = latestApp.applicationState?.status;

        if (appStatus === "APPROVED") {
          // Application approved but financial account not yet ready, keep polling
          continue;
        } else if (appStatus === "DENIED") {
          setError("Your application was declined.");
          setStep("select");
          return;
        } else if (appStatus === "IN_REVIEW") {
          // Check if document upload is required
          const verification = latestApp.accountHolderSnapshot?.currentVerification;
          if (verification?.reason === "DOCUMENT_UPLOAD_REQUIRED") {
            setStep("document_upload");
            return;
          }
        }
      }
    }

    // Timeout — don't claim success, show neutral processing message
    if (!abortRef.current) {
      setStep("processing");
      timerRef.current = setTimeout(() => navigate("/"), 3000);
    }
  }

  async function handleIssue() {
    if (!application?.id) return;
    setError(null);
    setStep("issuing");

    try {
      const account = await issueFinancialAccount(application.id, accountName);

      queryClient.setQueryData<MeResponse>(["me"], (old) => {
        if (!old?.accountHolder) return old;
        const existingEdges = old.accountHolder.financialAccounts?.edges ?? [];
        return {
          ...old,
          accountHolder: {
            ...old.accountHolder,
            financialAccounts: {
              edges: [...existingEdges, {
                node: {
                  ...account,
                  paymentCards: { edges: [] },
                },
              }],
            },
          },
        };
      });

      setStep("done");
      timerRef.current = setTimeout(() => navigate("/"), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to issue account");
      setStep("approved");
    }
  }

  async function handleDocumentUpload() {
    if (!application?.id || documentUploadRef.current) return;
    const appId = application.id;
    setError(null);
    setDocumentUploading(true);

    try {
      // 1. Start a document upload session
      const session = await startDocumentSession(appId);

      // 2. Get a client token scoped to this session
      const token = await getDocumentToken(appId, session.id);

      // 3. Initialize the document upload SDK iframe
      const component = await initializeDocumentUploadSdk({
        clientToken: token.value,
        documentUploadSessionId: session.id,
        environment: "test",
        documentUploadComponent: {
          selector: "#document-upload-container",
        },
        onError: (error) => {
          setError(`Document upload error: ${error.message ?? error.name}`);
          setDocumentUploading(false);
        },
        onLoad: () => {
          setDocumentUploading(false);
          // The SDK uses our `selector` as the mount point, so its dropdown
          // and upload button are in our DOM. After load we (1) rewrite raw
          // enum option labels to friendly names, (2) inject a non-selectable
          // "Select a document type" placeholder so the user has to make a
          // conscious choice rather than accidentally submitting whatever
          // Highnote happened to return first, and (3) guard the Upload
          // button against the SDK's silent no-op when the placeholder is
          // still selected. A MutationObserver re-applies (1)+(2) if the
          // SDK rebuilds the dropdown later.
          const container = document.getElementById("document-upload-container");
          if (container) {
            // The SDK rebuilds the dropdown + Upload button after each
            // successful upload (it replaces `innerHTML` to reflect newly
            // satisfied document requirements). The new elements lose any
            // listeners attached only at `onLoad`, so we run all
            // enhancements — humanize, placeholder, click guard, change
            // listener — on every mutation. The dataset flags make each
            // attachment idempotent against the current element identity.
            const enhance = () => {
              humanizeSdkLabels(container);
              ensureDocumentTypePlaceholder(container);

              const uploadBtn = container.querySelector("#document-upload-button");
              if (uploadBtn instanceof HTMLElement && !uploadBtn.dataset.placeholderGuard) {
                uploadBtn.dataset.placeholderGuard = "1";
                uploadBtn.addEventListener(
                  "click",
                  (e) => {
                    const sel = container.querySelector("#document-sdk-type");
                    if (
                      sel instanceof HTMLSelectElement &&
                      sel.value === DOC_TYPE_PLACEHOLDER_VALUE
                    ) {
                      e.preventDefault();
                      e.stopImmediatePropagation();
                      setError("Pick a document type before uploading.");
                    }
                  },
                  true,
                );
              }

              // Clear the placeholder error as soon as the user picks a
              // real option — banner otherwise lingers after they've
              // corrected the issue.
              const select = container.querySelector("#document-sdk-type");
              if (select instanceof HTMLSelectElement && !select.dataset.placeholderClear) {
                select.dataset.placeholderClear = "1";
                select.addEventListener("change", () => {
                  if (select.value !== DOC_TYPE_PLACEHOLDER_VALUE) {
                    setError(null);
                  }
                });
              }
            };
            enhance();
            const observer = new MutationObserver(enhance);
            observer.observe(container, { childList: true, subtree: true });
            sdkObserverRef.current = observer;
          }
        },
        onSuccess: () => {
          // Clean up the iframe and show an explicit confirmation step.
          // The SDK widget otherwise just resets, leaving no sign the upload worked.
          sdkObserverRef.current?.disconnect();
          sdkObserverRef.current = null;
          if (documentUploadRef.current) {
            documentUploadRef.current.unmount();
            documentUploadRef.current = null;
          }
          setStep("document_submitted");
        },
      });

      if (component) {
        documentUploadRef.current = component;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start document upload");
      setDocumentUploading(false);
    }
  }

  function renderWorkflowStatuses() {
    const workflows = application?.applicationWorkflows;
    const verification = application?.accountHolderSnapshot?.currentVerification;

    return (
      <div className="mx-auto max-w-md space-y-4">
        <div className="text-center">
          <h3 className="text-lg font-medium text-gray-900">
            Reviewing your application
            {application?.cardProduct?.name ? ` for ${application.cardProduct.name}` : ""}
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            Status: <span className="font-medium">{application?.applicationState?.status ?? "PENDING"}</span>
          </p>
        </div>

        {/* Workflow steps */}
        {workflows && workflows.length > 0 && (
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h4 className="mb-3 text-sm font-medium text-gray-700">Verification Steps</h4>
            <div className="space-y-2">
              {workflows
                .sort((a, b) => (a.executionOrder ?? 0) - (b.executionOrder ?? 0))
                .map((wf, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">
                      {WORKFLOW_LABELS[wf.workflowType ?? ""] ?? wf.workflowType ?? "Unknown"}
                    </span>
                    <StatusBadge status={wf.status ?? "PENDING"} />
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Verification results — TEST ENV ONLY. The per-check codes (e.g.
            ADDRESS_MISMATCH) are operationally useful for the demo but in
            production they tell an applicant using stolen data exactly which
            field to forge next. Gate behind isTestEnv and frame as debug. */}
        {isTestEnv && verification && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-medium text-amber-900">Identity Verification</h4>
                <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
                  Test debug
                </span>
              </div>
              <StatusBadge status={verification.status ?? "PENDING"} />
            </div>
            <p className="mb-2 text-[10px] uppercase tracking-wide text-amber-700">
              Not visible to applicants in production
            </p>
            {verification.reason && (
              <p className="mb-2 text-xs text-amber-900">{verification.reason}</p>
            )}
            {verification.results && verification.results.length > 0 && (
              <div className="space-y-1">
                {verification.results.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span className="font-mono text-amber-700">{r.code}</span>
                    {r.description && <span className="text-amber-900">{r.description}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="text-center">
          <LoadingSpinner message="Checking status..." />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <div className="mx-auto max-w-5xl px-4 py-8">
        <PageHeader title="Apply for a Card" showBack />

        {error && (
          <div className="mb-4">
            <ErrorMessage message={error} onDismiss={() => setError(null)} />
          </div>
        )}

        {step === "select" && (
          <>
            {isLoading && <LoadingSpinner message="Loading card products..." />}
            {productsError && (
              <ErrorMessage
                message={productsError instanceof Error ? productsError.message : "Failed to load products"}
              />
            )}
            {products && products.length === 0 && (
              <EmptyState message="No card products available." />
            )}
            {products && products.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2">
                {products.map((product) => (
                  <div
                    key={product.id}
                    className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
                  >
                    <h3 className="text-lg font-medium text-gray-900">{product.name}</h3>
                    {product.vertical && (
                      <p className="mt-2 text-xs text-gray-400">
                        {product.vertical} &middot; {product.usage}
                      </p>
                    )}
                    <button
                      onClick={() => handleApply(product)}
                      className="mt-4 w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                    >
                      Apply
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {step === "applying" && renderWorkflowStatuses()}

        {step === "document_upload" && (
          <div className="mx-auto max-w-lg">
            {/* Styles for Highnote Document Upload SDK elements */}
            <style>{`
              #inner-document-upload-component {
                font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
              }
              #documents-required {
                margin-bottom: 1.25rem;
              }
              #documents-required h4 {
                font-size: 0.875rem;
                font-weight: 600;
                color: #111827;
                margin: 0 0 0.5rem 0;
              }
              #document-sdk-type {
                width: 100%;
                padding: 0.625rem 0.875rem;
                font-size: 0.875rem;
                color: #374151;
                background: #ffffff;
                border: 1px solid #d1d5db;
                border-radius: 0.5rem;
                outline: none;
                cursor: pointer;
                appearance: auto;
                transition: border-color 0.15s;
              }
              #document-sdk-type:focus {
                border-color: #6366f1;
                box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.15);
              }
              #file-upload-component {
                display: block;
                width: 100%;
                padding: 0.75rem;
                margin-bottom: 1rem;
                font-size: 0.875rem;
                color: #374151;
                background: #f9fafb;
                border: 2px dashed #d1d5db;
                border-radius: 0.5rem;
                cursor: pointer;
                transition: border-color 0.15s, background 0.15s;
              }
              #file-upload-component:hover {
                border-color: #6366f1;
                background: #f5f3ff;
              }
              #file-upload-component::file-selector-button {
                padding: 0.375rem 1rem;
                margin-right: 0.75rem;
                font-size: 0.8125rem;
                font-weight: 500;
                color: #ffffff;
                background: #4f46e5;
                border: none;
                border-radius: 0.375rem;
                cursor: pointer;
                transition: background 0.15s;
              }
              #file-upload-component::file-selector-button:hover {
                background: #4338ca;
              }
              #document-upload-button {
                display: block;
                width: 100%;
                padding: 0.75rem 1.5rem;
                font-size: 0.875rem;
                font-weight: 600;
                color: #ffffff;
                background: #4f46e5;
                border: none;
                border-radius: 0.5rem;
                cursor: pointer;
                transition: background 0.15s, box-shadow 0.15s;
              }
              #document-upload-button:hover {
                background: #4338ca;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
              }
              /* The SDK creates the overlay + spanner up front with their
               * default classes, then swaps them to class="show" while an
               * upload is in flight (see lib/esm/module.js). Style the active
               * .show state, not the default class — otherwise the
               * "Uploading file, please be patient" line is visible before
               * the user has picked a file. */
              .document-onUpload-overlay,
              .document-onUpload-spanner {
                display: none;
              }
              #document-upload-container .show {
                display: flex;
                align-items: center;
                gap: 0.75rem;
                padding: 0.75rem 1rem;
                margin: 0.75rem 0;
                background: #f5f3ff;
                border-radius: 0.5rem;
                border: 1px solid #e0e7ff;
              }
              #document-upload-container .show p {
                font-size: 0.8125rem;
                color: #4338ca;
                margin: 0;
              }
              .document-onUpload-loader {
                width: 1.25rem;
                height: 1.25rem;
                border: 2px solid #e0e7ff;
                border-top-color: #4f46e5;
                border-radius: 50%;
                animation: doc-spin 0.8s linear infinite;
              }
              @keyframes doc-spin {
                to { transform: rotate(360deg); }
              }
              #stagnant-document-upload-component {
                margin-top: 1rem;
              }
            `}</style>
            {/* Header card */}
            <div className="mb-6 rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-6">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100">
                  <svg className="h-5 w-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-base font-semibold text-gray-900">Additional verification needed</h3>
                  <p className="mt-1 text-sm text-gray-600">
                    To complete your application, please upload one of the accepted documents below.
                    Your information is transmitted securely and will only be used for identity verification.
                  </p>
                </div>
              </div>
            </div>

            {/* Upload area */}
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              {/* Upload button (before SDK is loaded) */}
              {!documentUploadRef.current && (
                <div className="flex flex-col items-center px-8 py-12">
                  <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-indigo-50">
                    <svg className="h-8 w-8 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                  </div>
                  <p className="mb-1 text-sm font-medium text-gray-900">Ready to upload</p>
                  <p className="mb-6 text-center text-xs text-gray-400">
                    Accepted formats: PDF, PNG, JPG (max 10 MB)
                  </p>
                  <button
                    type="button"
                    onClick={handleDocumentUpload}
                    disabled={documentUploading}
                    className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-indigo-700 hover:shadow-md disabled:opacity-50"
                  >
                    {documentUploading ? (
                      <span className="flex items-center gap-2">
                        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Preparing upload...
                      </span>
                    ) : "Select & Upload Documents"}
                  </button>
                </div>
              )}

              {/* Step instructions + accepted formats (visible once SDK is mounted) */}
              {documentUploadRef.current && (
                <div className="border-b border-gray-100 px-6 py-3">
                  <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-gray-600">
                    <li className="flex items-center gap-1.5">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-semibold text-indigo-700">1</span>
                      Pick document type
                    </li>
                    <li aria-hidden className="text-gray-300">›</li>
                    <li className="flex items-center gap-1.5">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-semibold text-indigo-700">2</span>
                      Choose file
                    </li>
                    <li aria-hidden className="text-gray-300">›</li>
                    <li className="flex items-center gap-1.5">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-semibold text-indigo-700">3</span>
                      Click Upload
                    </li>
                  </ol>
                  <p className="mt-2 text-xs text-gray-400">
                    Accepted formats: PDF, PNG, JPG (max 10 MB)
                  </p>
                </div>
              )}

              {/* Container where the document upload SDK iframe renders */}
              <div
                id="document-upload-container"
                className="min-h-[240px] px-6 py-4 [&_iframe]:!w-full [&_iframe]:rounded-lg [&_iframe]:border [&_iframe]:border-gray-100"
              />

              {/* Security footer */}
              <div className="border-t border-gray-100 bg-gray-50/50 px-6 py-3">
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  Documents are encrypted and transmitted securely
                </div>
              </div>
            </div>
          </div>
        )}

        {step === "document_submitted" && (
          <div className="mx-auto max-w-md rounded-lg border border-gray-200 bg-white p-8 shadow-sm text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
              <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="mt-3 text-lg font-medium text-gray-900">Document Submitted</h3>
            <p className="mt-1 text-sm text-gray-500">
              Your document was uploaded successfully. Your application is back under review —
              this usually takes a moment.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!application?.id) return;
                  setStep("applying");
                  pollApplication(application.id);
                }}
                className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                Check application status
              </button>
              <button
                type="button"
                onClick={() => navigate("/")}
                className="w-full rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Back to dashboard
              </button>
            </div>
          </div>
        )}

        {step === "approved" && (
          <div className="mx-auto max-w-md rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
            <div className="mb-4 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="mt-3 text-lg font-medium text-gray-900">Application Approved!</h3>
              <p className="mt-1 text-sm text-gray-500">Name your account to get started.</p>
            </div>
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700">Account Name</label>
              <input
                type="text"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <button
              type="button"
              onClick={handleIssue}
              className="mt-4 w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Create Account
            </button>
          </div>
        )}

        {step === "issuing" && <LoadingSpinner message="Creating your account..." />}

        {step === "done" && (
          <div className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
              <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="mt-3 text-lg font-medium text-gray-900">All Set!</h3>
            <p className="mt-1 text-sm text-gray-500">Your account has been created. Redirecting to dashboard...</p>
          </div>
        )}

        {step === "processing" && (
          <div className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-yellow-100">
              <svg className="h-6 w-6 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="mt-3 text-lg font-medium text-gray-900">Still Processing</h3>
            <p className="mt-1 text-sm text-gray-500">We're still processing your application. Check back from the dashboard.</p>
          </div>
        )}
      </div>
    </div>
  );
}
