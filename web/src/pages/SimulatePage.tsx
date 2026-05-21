import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { getMe } from "../api/client";
import { useEnvironment } from "../context/EnvironmentContext";
import { NavBar } from "../components/NavBar";
import { PageHeader } from "../components/PageHeader";
import * as sim from "../api/simulate";

type Tab = "transactions" | "deposits" | "applications" | "ach" | "physicalCards" | "accounts";

const TABS: { id: Tab; label: string }[] = [
  { id: "transactions", label: "Transactions" },
  { id: "deposits", label: "Deposits" },
  { id: "applications", label: "Applications" },
  { id: "ach", label: "ACH" },
  { id: "physicalCards", label: "Physical Cards" },
  { id: "accounts", label: "Accounts" },
];

function ResultDisplay({
  result,
  error,
  onDismissResult,
  onDismissError,
}: {
  result: any;
  error: string | null;
  onDismissResult: () => void;
  onDismissError: () => void;
}) {
  return (
    <>
      {result && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-green-800">Success</p>
            <button onClick={onDismissResult} className="text-green-600 hover:text-green-800 text-lg leading-none">&times;</button>
          </div>
          <pre className="mt-2 max-h-60 overflow-auto text-xs text-green-700 whitespace-pre-wrap">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-red-800">Error</p>
            <button onClick={onDismissError} className="text-red-600 hover:text-red-800 text-lg leading-none">&times;</button>
          </div>
          <p className="mt-1 text-sm text-red-600 whitespace-pre-line">{error}</p>
        </div>
      )}
    </>
  );
}

const inputCls =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";
const selectCls =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";
const btnCls =
  "rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed";
const labelCls = "block text-xs font-medium text-gray-700 mb-1";
const sectionTitleCls = "text-sm font-semibold text-gray-800 mb-3";
const dividerCls = "my-5 border-t border-gray-200";

export function SimulatePage() {
  const { isTestEnv, isLoading: envLoading } = useEnvironment();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>("transactions");
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollUntil, setPollUntil] = useState(0);

  const { data: meData } = useQuery({ queryKey: ["me"], queryFn: getMe });

  const accounts =
    meData?.accountHolder?.financialAccounts?.edges?.map((e) => e.node) ?? [];
  const allCards = accounts.flatMap(
    (a) => a.paymentCards?.edges?.map((e) => e.node) ?? []
  );
  const activeCards = allCards.filter((c) => c.status === "ACTIVE");
  const applications =
    meData?.accountHolder?.cardProductApplications?.edges?.map((e) => e.node) ?? [];

  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => setResult(null), 30_000);
    return () => clearTimeout(timer);
  }, [result]);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 30_000);
    return () => clearTimeout(timer);
  }, [error]);

  function startPolling() {
    setPollUntil(Date.now() + 30_000);
  }

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["me"] });
    void queryClient.invalidateQueries({ queryKey: ["activities"] });
    void queryClient.invalidateQueries({ queryKey: ["scheduled-transfers"] });
  }

  async function runAction(fn: () => Promise<any>) {
    setResult(null);
    setError(null);
    try {
      const res = await fn();
      setResult(res);
      invalidate();
      startPolling();
    } catch (err: any) {
      setError(err.message ?? "Unknown error");
    }
  }

  function handleTabChange(tab: Tab) {
    setActiveTab(tab);
    setResult(null);
    setError(null);
  }

  if (!envLoading && !isTestEnv) {
    navigate("/");
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      {Date.now() < pollUntil && (
        <div className="h-1 w-full overflow-hidden bg-indigo-100">
          <div className="h-full w-1/3 bg-indigo-500 rounded-full" style={{ animation: 'slideRight 1.5s ease-in-out infinite' }} />
          <style>{`@keyframes slideRight { 0% { transform: translateX(-100%); } 100% { transform: translateX(400%); } }`}</style>
        </div>
      )}
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <PageHeader
            title="Simulation Console"
            subtitle="Trigger test events against your sandbox environment"
          />
          <span className="shrink-0 rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white tracking-wide">
            TEST ENVIRONMENT
          </span>
        </div>

        {/* Tab bar */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="-mb-px flex gap-6 overflow-x-auto">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`whitespace-nowrap pb-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? "border-indigo-500 text-indigo-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab content */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6">
          {activeTab === "transactions" && (
            <TransactionsTab
              activeCards={activeCards}
              runAction={runAction}
              result={result}
              error={error}
              onDismissResult={() => setResult(null)}
              onDismissError={() => setError(null)}
            />
          )}
          {activeTab === "deposits" && (
            <DepositsTab
              accounts={accounts}
              runAction={runAction}
              result={result}
              error={error}
              onDismissResult={() => setResult(null)}
              onDismissError={() => setError(null)}
            />
          )}
          {activeTab === "applications" && (
            <ApplicationsTab
              applications={applications}
              accountHolderId={meData?.accountHolder?.id}
              runAction={runAction}
              result={result}
              error={error}
              onDismissResult={() => setResult(null)}
              onDismissError={() => setError(null)}
            />
          )}
          {activeTab === "ach" && (
            <AchTab
              accounts={accounts}
              runAction={runAction}
              result={result}
              error={error}
              onDismissResult={() => setResult(null)}
              onDismissError={() => setError(null)}
            />
          )}
          {activeTab === "physicalCards" && (
            <PhysicalCardsTab
              runAction={runAction}
              result={result}
              error={error}
              onDismissResult={() => setResult(null)}
              onDismissError={() => setError(null)}
            />
          )}
          {activeTab === "accounts" && (
            <AccountsTab
              accounts={accounts}
              runAction={runAction}
              result={result}
              error={error}
              onDismissResult={() => setResult(null)}
              onDismissError={() => setError(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transactions Tab
// ---------------------------------------------------------------------------

function TransactionsTab({
  activeCards,
  runAction,
  result,
  error,
  onDismissResult,
  onDismissError,
}: {
  activeCards: any[];
  runAction: (fn: () => Promise<any>) => Promise<void>;
  result: any;
  error: string | null;
  onDismissResult: () => void;
  onDismissError: () => void;
}) {
  const [cardId, setCardId] = useState(activeCards[0]?.id ?? "");
  const [authAmount, setAuthAmount] = useState("");
  const [merchantName, setMerchantName] = useState("");
  const [categoryCode, setCategoryCode] = useState("");

  const [txId, setTxId] = useState("");
  const [clearAmount, setClearAmount] = useState("");

  const [adjustTxId, setAdjustTxId] = useState("");
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustType, setAdjustType] = useState("ADJUSTMENT_CREDIT");

  const effectiveCardId = cardId || activeCards[0]?.id || "";

  return (
    <div>
      {/* Authorize / Auth+Clear */}
      <p className={sectionTitleCls}>New Transaction</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Card</label>
          <select
            className={selectCls}
            value={cardId}
            onChange={(e) => setCardId(e.target.value)}
          >
            {activeCards.length === 0 && <option value="">No active cards</option>}
            {activeCards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.last4 ? `••••${c.last4}` : c.id.slice(-8)} ({c.status})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Amount ($)</label>
          <input
            type="number"
            step="0.01"
            className={inputCls}
            placeholder="e.g. 15.00"
            value={authAmount}
            onChange={(e) => setAuthAmount(e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls}>Merchant Name (optional)</label>
          <input
            type="text"
            className={inputCls}
            placeholder="e.g. Coffee Shop"
            value={merchantName}
            onChange={(e) => setMerchantName(e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls}>Category Code (optional)</label>
          <input
            type="text"
            className={inputCls}
            placeholder="e.g. GROCERY_STORES_SUPERMARKETS"
            value={categoryCode}
            onChange={(e) => setCategoryCode(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-4 flex gap-3">
        <button
          className={btnCls}
          disabled={!effectiveCardId || !authAmount}
          onClick={() =>
            runAction(() =>
              sim.simulateAuthorize(
                effectiveCardId,
                Number(authAmount),
                merchantName || undefined,
                categoryCode || undefined
              )
            ).then(() => {
              setAuthAmount("");
              setMerchantName("");
              setCategoryCode("");
            })
          }
        >
          Authorize
        </button>
        <button
          className={btnCls}
          disabled={!effectiveCardId || !authAmount}
          onClick={() =>
            runAction(() =>
              sim.simulateAuthAndClear(
                effectiveCardId,
                Number(authAmount),
                merchantName || undefined,
                categoryCode || undefined
              )
            ).then(() => {
              setAuthAmount("");
              setMerchantName("");
              setCategoryCode("");
            })
          }
        >
          Auth + Clear
        </button>
        <button
          className={btnCls}
          disabled={!effectiveCardId}
          onClick={() =>
            runAction(() =>
              sim.simulateVerify(
                effectiveCardId,
                undefined,
                merchantName || undefined
              )
            ).then(() => {
              setMerchantName("");
              setCategoryCode("");
            })
          }
        >
          Verify ($0)
        </button>
      </div>
      <p className="mt-2 text-xs text-gray-400">
        To test a decline: authorize an amount exceeding the available balance, or suspend the card first.
      </p>

      <div className={dividerCls} />

      {/* Clear / Reverse / Refund */}
      <p className={sectionTitleCls}>Existing Transaction</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Transaction ID</label>
          <input
            type="text"
            className={inputCls}
            placeholder="txn_..."
            value={txId}
            onChange={(e) => setTxId(e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls}>Amount for Clear (optional, $)</label>
          <input
            type="number"
            step="0.01"
            className={inputCls}
            placeholder="Leave blank to use authorized amount"
            value={clearAmount}
            onChange={(e) => setClearAmount(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-4 flex gap-3 flex-wrap">
        <button
          className={btnCls}
          disabled={!txId}
          onClick={() =>
            runAction(() =>
              sim.simulateClear(txId, clearAmount ? Number(clearAmount) : undefined)
            ).then(() => {
              setTxId("");
              setClearAmount("");
            })
          }
        >
          Clear
        </button>
        <button
          className={btnCls}
          disabled={!txId}
          onClick={() =>
            runAction(() => sim.simulateReverse(txId)).then(() => setTxId(""))
          }
        >
          Reverse
        </button>
        <button
          className={btnCls}
          disabled={!txId}
          onClick={() =>
            runAction(() => sim.simulateRefund(txId)).then(() => setTxId(""))
          }
        >
          Refund
        </button>
      </div>

      <div className={dividerCls} />

      {/* Adjust */}
      <p className={sectionTitleCls}>Adjust Transaction</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className={labelCls}>Transaction ID</label>
          <input
            type="text"
            className={inputCls}
            placeholder="txn_..."
            value={adjustTxId}
            onChange={(e) => setAdjustTxId(e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls}>Amount ($)</label>
          <input
            type="number"
            step="0.01"
            className={inputCls}
            placeholder="e.g. 5.00"
            value={adjustAmount}
            onChange={(e) => setAdjustAmount(e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls}>Type</label>
          <select
            className={selectCls}
            value={adjustType}
            onChange={(e) => setAdjustType(e.target.value)}
          >
            <option value="ADJUSTMENT_CREDIT">ADJUSTMENT_CREDIT</option>
            <option value="ADJUSTMENT_DEBIT">ADJUSTMENT_DEBIT</option>
          </select>
        </div>
      </div>
      <div className="mt-4">
        <button
          className={btnCls}
          disabled={!adjustTxId || !adjustAmount}
          onClick={() =>
            runAction(() =>
              sim.simulateAdjust(adjustTxId, Number(adjustAmount), adjustType)
            ).then(() => {
              setAdjustTxId("");
              setAdjustAmount("");
            })
          }
        >
          Adjust
        </button>
      </div>

      <ResultDisplay result={result} error={error} onDismissResult={onDismissResult} onDismissError={onDismissError} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deposits Tab
// ---------------------------------------------------------------------------

function DepositsTab({
  accounts,
  runAction,
  result,
  error,
  onDismissResult,
  onDismissError,
}: {
  accounts: any[];
  runAction: (fn: () => Promise<any>) => Promise<void>;
  result: any;
  error: string | null;
  onDismissResult: () => void;
  onDismissError: () => void;
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");

  const effectiveAccountId = accountId || accounts[0]?.id || "";

  return (
    <div>
      <p className={sectionTitleCls}>Fund via Wire</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Financial Account</label>
          <select
            className={selectCls}
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {accounts.length === 0 && <option value="">No accounts available</option>}
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name || a.id.slice(-8)} ({a.accountStatus})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Amount ($)</label>
          <input
            type="number"
            step="0.01"
            className={inputCls}
            placeholder="e.g. 1000.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Memo (optional)</label>
          <input
            type="text"
            className={inputCls}
            placeholder="Wire transfer memo"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-4">
        <button
          className={btnCls}
          disabled={!effectiveAccountId || !amount}
          onClick={() =>
            runAction(() =>
              sim.simulateDeposit(
                effectiveAccountId,
                Number(amount),
                memo || undefined
              )
            ).then(() => {
              setAmount("");
              setMemo("");
            })
          }
        >
          Fund via Wire
        </button>
      </div>
      <ResultDisplay result={result} error={error} onDismissResult={onDismissResult} onDismissError={onDismissError} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Applications Tab
// ---------------------------------------------------------------------------

function ApplicationsTab({
  applications,
  accountHolderId,
  runAction,
  result,
  error,
  onDismissResult,
  onDismissError,
}: {
  applications: any[];
  accountHolderId?: string;
  runAction: (fn: () => Promise<any>) => Promise<void>;
  result: any;
  error: string | null;
  onDismissResult: () => void;
  onDismissError: () => void;
}) {
  const [appId, setAppId] = useState(applications[0]?.id ?? "");

  const [statusValue, setStatusValue] = useState("APPROVED");

  const [verificationStatus, setVerificationStatus] = useState("PASSED");
  const [applicantId, setApplicantId] = useState("");

  const [docReviewDocId, setDocReviewDocId] = useState("");
  const [docReviewSessionId, setDocReviewSessionId] = useState("");
  const [docReviewStatus, setDocReviewStatus] = useState("ACCEPTED");

  const [uploadMemo, setUploadMemo] = useState("");
  const [uploadApplicantId, setUploadApplicantId] = useState("");
  const [uploadDocTypes, setUploadDocTypes] = useState("");

  // Pre-fill the applicant ID from the signed-in account holder once it loads —
  // it's almost always the value the operator wants, and isn't obvious otherwise.
  useEffect(() => {
    if (!accountHolderId) return;
    setApplicantId((cur) => cur || accountHolderId);
    setUploadApplicantId((cur) => cur || accountHolderId);
  }, [accountHolderId]);

  const effectiveAppId = appId || applications[0]?.id || "";

  return (
    <div>
      {/* Application selector */}
      <div className="mb-5">
        <label className={labelCls}>Application</label>
        <select
          className={selectCls}
          value={appId}
          onChange={(e) => setAppId(e.target.value)}
        >
          {applications.length === 0 && <option value="">No applications</option>}
          {applications.map((a) => (
            <option key={a.id} value={a.id}>
              {a.cardProduct?.name ?? "Application"} — {a.applicationState?.status ?? "?"} (
              {a.id.slice(-8)})
            </option>
          ))}
        </select>
      </div>

      {/* Change Status */}
      <p className={sectionTitleCls}>Change Application Status</p>
      <div className="flex gap-3 items-end">
        <div className="flex-1">
          <label className={labelCls}>New Status</label>
          <select
            className={selectCls}
            value={statusValue}
            onChange={(e) => setStatusValue(e.target.value)}
          >
            <option value="APPROVED">APPROVED</option>
            <option value="DENIED">DENIED</option>
          </select>
        </div>
        <button
          className={btnCls}
          disabled={!effectiveAppId}
          onClick={() =>
            runAction(() =>
              sim.simulateApplicationStatus(effectiveAppId, statusValue)
            )
          }
        >
          Set Status
        </button>
      </div>

      <div className={dividerCls} />

      {/* Change Verification Status */}
      <p className={sectionTitleCls}>Change Verification Status</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Applicant ID</label>
          <input
            type="text"
            className={inputCls}
            placeholder="ps_ah..."
            value={applicantId}
            onChange={(e) => setApplicantId(e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls}>Verification Status</label>
          <select
            className={selectCls}
            value={verificationStatus}
            onChange={(e) => setVerificationStatus(e.target.value)}
          >
            <option value="PASSED">PASSED</option>
            <option value="PENDING">PENDING</option>
            <option value="DENIED">DENIED</option>
          </select>
        </div>
      </div>
      <div className="mt-4">
        <button
          className={btnCls}
          disabled={!effectiveAppId || !applicantId}
          onClick={() =>
            runAction(() =>
              sim.simulateApplicationVerification(
                applicantId,
                effectiveAppId,
                verificationStatus
              )
            )
          }
        >
          Set Verification Status
        </button>
      </div>

      <div className={dividerCls} />

      {/* Document Review */}
      <p className={sectionTitleCls}>Document Review</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Document Upload Link ID</label>
          <input
            type="text"
            className={inputCls}
            placeholder="dul_..."
            value={docReviewDocId}
            onChange={(e) => setDocReviewDocId(e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls}>Document Upload Session ID</label>
          <input
            type="text"
            className={inputCls}
            placeholder="dus_..."
            value={docReviewSessionId}
            onChange={(e) => setDocReviewSessionId(e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls}>Review Status</label>
          <select
            className={selectCls}
            value={docReviewStatus}
            onChange={(e) => setDocReviewStatus(e.target.value)}
          >
            <option value="ACCEPTED">ACCEPTED</option>
            <option value="REJECTED">REJECTED</option>
            <option value="PENDING">PENDING</option>
          </select>
        </div>
      </div>
      <div className="mt-4">
        <button
          className={btnCls}
          disabled={!effectiveAppId || !docReviewDocId || !docReviewSessionId}
          onClick={() =>
            runAction(() =>
              sim.simulateDocumentReview(
                effectiveAppId,
                docReviewDocId,
                docReviewSessionId,
                docReviewStatus
              )
            ).then(() => {
              setDocReviewDocId("");
              setDocReviewSessionId("");
            })
          }
        >
          Submit Document Review
        </button>
      </div>

      <div className={dividerCls} />

      {/* Document Upload Sessions */}
      <p className={sectionTitleCls}>Create Document Upload Sessions</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Applicant ID</label>
          <input
            type="text"
            className={inputCls}
            placeholder="ps_ah..."
            value={uploadApplicantId}
            onChange={(e) => setUploadApplicantId(e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls}>Document Types (comma-separated)</label>
          <input
            type="text"
            className={inputCls}
            placeholder="e.g. GOVERNMENT_ID,SELFIE"
            value={uploadDocTypes}
            onChange={(e) => setUploadDocTypes(e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Memo (optional)</label>
          <input
            type="text"
            className={inputCls}
            placeholder="Internal memo"
            value={uploadMemo}
            onChange={(e) => setUploadMemo(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-4">
        <button
          className={btnCls}
          disabled={!effectiveAppId || !uploadApplicantId || !uploadDocTypes}
          onClick={() => {
            const docTypes = uploadDocTypes
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            return runAction(() =>
              sim.simulateDocumentUploadSessions(
                effectiveAppId,
                [{ applicantId: uploadApplicantId, documentTypes: docTypes }],
                uploadMemo || undefined
              )
            ).then(() => {
              setUploadDocTypes("");
              setUploadMemo("");
            });
          }}
        >
          Create Upload Sessions
        </button>
      </div>

      <ResultDisplay result={result} error={error} onDismissResult={onDismissResult} onDismissError={onDismissError} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ACH Tab
// ---------------------------------------------------------------------------

function AchTab({
  accounts,
  runAction,
  result,
  error,
  onDismissResult,
  onDismissError,
}: {
  accounts: any[];
  runAction: (fn: () => Promise<any>) => Promise<void>;
  result: any;
  error: string | null;
  onDismissResult: () => void;
  onDismissError: () => void;
}) {
  const [processingTransferId, setProcessingTransferId] = useState("");
  const [returnTransferId, setReturnTransferId] = useState("");
  const [returnReason, setReturnReason] = useState("");

  const [extAccountId, setExtAccountId] = useState(accounts[0]?.id ?? "");
  const [extAmount, setExtAmount] = useState("");

  const [nonOrigAccountId, setNonOrigAccountId] = useState(accounts[0]?.id ?? "");
  const [nonOrigAmount, setNonOrigAmount] = useState("");
  const [nonOrigCompany, setNonOrigCompany] = useState("");
  const [nonOrigPurpose, setNonOrigPurpose] = useState("CHECKING_TO_CHECKING");

  const effectiveExtAccountId = extAccountId || accounts[0]?.id || "";
  const effectiveNonOrigAccountId = nonOrigAccountId || accounts[0]?.id || "";

  return (
    <div>
      {/* Processing */}
      <p className={sectionTitleCls}>Process ACH Transfer</p>
      <div className="flex gap-3 items-end">
        <div className="flex-1">
          <label className={labelCls}>Transfer ID</label>
          <input
            type="text"
            className={inputCls}
            placeholder="ach_..."
            value={processingTransferId}
            onChange={(e) => setProcessingTransferId(e.target.value)}
          />
        </div>
        <button
          className={btnCls}
          disabled={!processingTransferId}
          onClick={() =>
            runAction(() =>
              sim.simulateAchProcessing(processingTransferId)
            ).then(() => setProcessingTransferId(""))
          }
        >
          Process
        </button>
      </div>

      <div className={dividerCls} />

      {/* Return */}
      <p className={sectionTitleCls}>Return ACH Transfer</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Transfer ID</label>
          <input
            type="text"
            className={inputCls}
            placeholder="ach_..."
            value={returnTransferId}
            onChange={(e) => setReturnTransferId(e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls}>Failure Reason</label>
          <input
            type="text"
            className={inputCls}
            placeholder="e.g. R01"
            value={returnReason}
            onChange={(e) => setReturnReason(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-4">
        <button
          className={btnCls}
          disabled={!returnTransferId || !returnReason}
          onClick={() =>
            runAction(() =>
              sim.simulateAchReturn(returnTransferId, returnReason)
            ).then(() => {
              setReturnTransferId("");
              setReturnReason("");
            })
          }
        >
          Return
        </button>
      </div>

      <div className={dividerCls} />

      {/* Externally Initiated */}
      <p className={sectionTitleCls}>Externally Initiated ACH</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Financial Account</label>
          <select
            className={selectCls}
            value={extAccountId}
            onChange={(e) => setExtAccountId(e.target.value)}
          >
            {accounts.length === 0 && <option value="">No accounts</option>}
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name || a.id.slice(-8)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Amount ($)</label>
          <input
            type="number"
            step="0.01"
            className={inputCls}
            placeholder="e.g. 500.00"
            value={extAmount}
            onChange={(e) => setExtAmount(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-4">
        <button
          className={btnCls}
          disabled={!effectiveExtAccountId || !extAmount}
          onClick={() =>
            runAction(() =>
              sim.simulateExternallyInitiatedAch(
                effectiveExtAccountId,
                Number(extAmount)
              )
            ).then(() => setExtAmount(""))
          }
        >
          Initiate
        </button>
      </div>

      <div className={dividerCls} />

      {/* Non-Originated */}
      <p className={sectionTitleCls}>Non-Originated ACH</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Financial Account</label>
          <select
            className={selectCls}
            value={nonOrigAccountId}
            onChange={(e) => setNonOrigAccountId(e.target.value)}
          >
            {accounts.length === 0 && <option value="">No accounts</option>}
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name || a.id.slice(-8)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Amount ($)</label>
          <input
            type="number"
            step="0.01"
            className={inputCls}
            placeholder="e.g. 250.00"
            value={nonOrigAmount}
            onChange={(e) => setNonOrigAmount(e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls}>Company Name (optional)</label>
          <input
            type="text"
            className={inputCls}
            placeholder="e.g. Acme Corp"
            value={nonOrigCompany}
            onChange={(e) => setNonOrigCompany(e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls}>Purpose</label>
          <select
            className={selectCls}
            value={nonOrigPurpose}
            onChange={(e) => setNonOrigPurpose(e.target.value)}
          >
            <option value="CHECKING_TO_CHECKING">CHECKING_TO_CHECKING</option>
            <option value="PAYROLL">PAYROLL</option>
            <option value="VENDOR_PAYMENT">VENDOR_PAYMENT</option>
            <option value="OTHER">OTHER</option>
          </select>
        </div>
      </div>
      <div className="mt-4">
        <button
          className={btnCls}
          disabled={!effectiveNonOrigAccountId || !nonOrigAmount}
          onClick={() =>
            runAction(() =>
              sim.simulateNonOriginatedAch(
                effectiveNonOrigAccountId,
                Number(nonOrigAmount),
                nonOrigCompany || undefined,
                nonOrigPurpose || undefined
              )
            ).then(() => {
              setNonOrigAmount("");
              setNonOrigCompany("");
            })
          }
        >
          Create
        </button>
      </div>

      <ResultDisplay result={result} error={error} onDismissResult={onDismissResult} onDismissError={onDismissError} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Physical Cards Tab
// ---------------------------------------------------------------------------

function PhysicalCardsTab({
  runAction,
  result,
  error,
  onDismissResult,
  onDismissError,
}: {
  runAction: (fn: () => Promise<any>) => Promise<void>;
  result: any;
  error: string | null;
  onDismissResult: () => void;
  onDismissError: () => void;
}) {
  const [orderId, setOrderId] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [shipDate, setShipDate] = useState("");
  const [showShipExtras, setShowShipExtras] = useState(false);

  return (
    <div>
      <p className={sectionTitleCls}>Physical Card Order</p>
      <div className="mb-4">
        <label className={labelCls}>Order ID</label>
        <input
          type="text"
          className={inputCls}
          placeholder="phys_order_..."
          value={orderId}
          onChange={(e) => setOrderId(e.target.value)}
        />
      </div>

      <div className="flex gap-3 flex-wrap">
        <button
          className={btnCls}
          disabled={!orderId}
          onClick={() =>
            runAction(() => sim.simulatePhysicalCardSendToPrinter(orderId))
          }
        >
          Send to Printer
        </button>
        <button
          className={btnCls}
          disabled={!orderId}
          onClick={() =>
            runAction(() => sim.simulatePhysicalCardApprove(orderId))
          }
        >
          Approve
        </button>
        <button
          className={btnCls}
          disabled={!orderId}
          onClick={() => setShowShipExtras((v) => !v)}
        >
          {showShipExtras ? "Hide Ship Options" : "Ship..."}
        </button>
        <button
          className={btnCls}
          disabled={!orderId}
          onClick={() =>
            runAction(() => sim.simulatePhysicalCardFailShipment(orderId))
          }
        >
          Fail Shipment
        </button>
      </div>

      {showShipExtras && (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 p-4 rounded-lg bg-gray-50 border border-gray-200">
          <div>
            <label className={labelCls}>Tracking Number (optional)</label>
            <input
              type="text"
              className={inputCls}
              placeholder="1Z..."
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>Ship Date (optional, YYYY-MM-DD)</label>
            <input
              type="date"
              className={inputCls}
              value={shipDate}
              onChange={(e) => setShipDate(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <button
              className={btnCls}
              disabled={!orderId}
              onClick={() =>
                runAction(() =>
                  sim.simulatePhysicalCardShip(
                    orderId,
                    trackingNumber || undefined,
                    shipDate || undefined
                  )
                ).then(() => {
                  setTrackingNumber("");
                  setShipDate("");
                  setShowShipExtras(false);
                })
              }
            >
              Ship
            </button>
          </div>
        </div>
      )}

      <ResultDisplay result={result} error={error} onDismissResult={onDismissResult} onDismissError={onDismissError} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Accounts Tab
// ---------------------------------------------------------------------------

function AccountsTab({
  accounts,
  runAction,
  result,
  error,
  onDismissResult,
  onDismissError,
}: {
  accounts: any[];
  runAction: (fn: () => Promise<any>) => Promise<void>;
  result: any;
  error: string | null;
  onDismissResult: () => void;
  onDismissError: () => void;
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const effectiveAccountId = accountId || accounts[0]?.id || "";

  return (
    <div>
      <p className={sectionTitleCls}>Financial Account Closure</p>
      <div className="mb-5">
        <label className={labelCls}>Financial Account</label>
        <select
          className={selectCls}
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          {accounts.length === 0 && <option value="">No accounts available</option>}
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name || a.id.slice(-8)} ({a.accountStatus})
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-3">
        <button
          className={btnCls}
          disabled={!effectiveAccountId}
          onClick={() =>
            runAction(() =>
              sim.simulateFinancialAccountInitiateClosure(effectiveAccountId)
            )
          }
        >
          Initiate Closure
        </button>
        <button
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!effectiveAccountId}
          onClick={() =>
            runAction(() =>
              sim.simulateFinancialAccountClose(effectiveAccountId)
            )
          }
        >
          Close Account
        </button>
      </div>

      <ResultDisplay result={result} error={error} onDismissResult={onDismissResult} onDismissError={onDismissError} />
    </div>
  );
}
