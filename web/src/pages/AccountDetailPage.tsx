import { useState, useRef, useCallback, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getMe,
  listActivities,
  listWireTransfers,
  type ReviewWorkflowEvent,
  issueCard,
  activateCard,
  suspendCard,
  closeCard,
  reissueCard,
  getPinToken,
  getViewerToken,
  suspendFinancialAccount,
  unsuspendFinancialAccount,
  orderPhysicalCard,
  addNonVerifiedBankAccount,
  addPlaidBankAccount,
  addFinicityBankAccount,
  initiateAchTransfer,
  createOneTimeAchTransfer,
  createRecurringAchTransfer,
  cancelAchTransfer,
  listScheduledTransfers,
  type PaymentCard,
  type ReissueCardReason,
} from "../api/client";
import { ATMLocatorModal } from "../components/ATMLocatorModal";
import { useEnvironment } from "../context/EnvironmentContext";
import {
  simulateAuthorize,
  simulateAuthAndClear,
  simulateVerify,
  simulateClear,
  simulateDeposit,
  simulateRefund,
  simulateFinancialAccountInitiateClosure,
  simulateFinancialAccountClose,
} from "../api/simulate";
import { filterActivitiesBySearch, filterActivitiesByStatus, type ActivityStatusFilter } from "../utils/activityFilters";
import { NavBar } from "../components/NavBar";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { ErrorMessage } from "../components/ErrorMessage";
import { EmptyState } from "../components/EmptyState";

export function AccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { isTestEnv } = useEnvironment();
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [expandedActivityId, setExpandedActivityId] = useState<string | null>(null);
  const [reissueCardId, setReissueCardId] = useState<string | null>(null);
  const [reissueReason, setReissueReason] = useState<ReissueCardReason | null>(null);
  const [copyNumber, setCopyNumber] = useState(true);
  const [copyPin, setCopyPin] = useState(false);
  const [pinCardId, setPinCardId] = useState<string | null>(null);
  const [pinStatus, setPinStatus] = useState<"idle" | "loading" | "ready" | "success" | "error">("idle");
  const [pinError, setPinError] = useState<string | null>(null);
  const pinUnmountRef = useRef<(() => Promise<void>) | null>(null);
  const pinSubmitRef = useRef<(() => void) | null>(null);
  const [viewerCardId, setViewerCardId] = useState<string | null>(null);
  const [viewerStatus, setViewerStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [viewerError, setViewerError] = useState<string | null>(null);
  const viewerUnmountRef = useRef<(() => Promise<void>) | null>(null);
  const viewerToggleMaskRef = useRef<(() => void) | null>(null);
  const [showCvv, setShowCvv] = useState(false);
  // Optimistic cards from mutations — kept in state, keyed by id
  const [optimisticCards, setOptimisticCards] = useState<Map<string, PaymentCard>>(new Map());
  const [pollUntil, setPollUntil] = useState(0);
  // Test tools state
  const [fundAmount, setFundAmount] = useState("");
  const [simPurchaseCardId, setSimPurchaseCardId] = useState<string | null>(null);
  const [simAmount, setSimAmount] = useState("");
  // Physical card order state
  const [orderPhysicalCardId, setOrderPhysicalCardId] = useState<string | null>(null);
  const [orderForm, setOrderForm] = useState({
    nameOnCard: "",
    recipientGivenName: "",
    recipientFamilyName: "",
    streetAddress: "",
    extendedAddress: "",
    locality: "",
    region: "",
    postalCode: "",
    countryCodeAlpha3: "USA",
  });
  // Bank account linking state
  const [bankRoutingNumber, setBankRoutingNumber] = useState("091000019");
  const [bankAccountNumber, setBankAccountNumber] = useState("12345");
  const [bankAccountType, setBankAccountType] = useState("CHECKING");
  const [bankAccountName, setBankAccountName] = useState("");
  const [bankLinkMethod, setBankLinkMethod] = useState<"non-verified" | "plaid" | "finicity">("non-verified");
  const [plaidToken, setPlaidToken] = useState("processor-token-success");
  const [finicityReceiptId, setFinicityReceiptId] = useState("processor-token-success");
  const [finicityCustomerId, setFinicityCustomerId] = useState("5543088633794259024");
  const [finicityName, setFinicityName] = useState("Finicity Checking");
  const [activityPageSize, setActivityPageSize] = useState(20);
  const [activitySearch, setActivitySearch] = useState("");
  const [activityStatusFilter, setActivityStatusFilter] = useState<ActivityStatusFilter>("all");
  // ACH transfer state
  const [achDirection, setAchDirection] = useState<"pull" | "push" | "schedule" | "recurring">("pull");
  const [achScheduleDate, setAchScheduleDate] = useState("");
  const [achDayOfMonth, setAchDayOfMonth] = useState("1");
  const [achAmount, setAchAmount] = useState("");
  const [achExternalAccountId, setAchExternalAccountId] = useState("");
  // ATM locator state
  const [showAtmModal, setShowAtmModal] = useState(false);
  const [showTestTools, setShowTestTools] = useState(false);

  function startPolling() {
    setPollUntil(Date.now() + 30_000);
  }

  // Use the shared "me" query — single source of truth for all account data
  const {
    data: meData,
    isLoading: accountLoading,
    error: accountError,
  } = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    refetchInterval: Date.now() < pollUntil ? 10_000 : false,
  });

  // Find this account from the "me" response
  const account = meData?.accountHolder?.financialAccounts?.edges
    ?.map((e) => e.node)
    ?.find((a) => a.id === id) ?? null;

  const externalAccounts = meData?.accountHolder?.externalFinancialAccounts?.edges?.map((e) => e.node) ?? [];

  // Card issuance requires a passed identity verification. Only block when we
  // positively know verification has NOT passed — if no verification info is
  // present, defer to the API rather than risk a false negative.
  const verificationStatuses = (meData?.accountHolder?.cardProductApplications?.edges ?? [])
    .map((e) => e.node.accountHolderSnapshot?.currentVerification?.status)
    .filter((s): s is string => !!s);
  const canIssueCard =
    verificationStatuses.length === 0 || verificationStatuses.includes("PASSED");

  const {
    data: activities,
    isLoading: txLoading,
    error: activitiesError,
    refetch: refetchActivities,
  } = useQuery({
    queryKey: ["activities", id, activityPageSize],
    queryFn: () => listActivities(id!, activityPageSize),
    enabled: !!id,
    refetchInterval: Date.now() < pollUntil ? 5_000 : false,
  });

  const {
    data: scheduledTransfers,
    isLoading: scheduledLoading,
  } = useQuery({
    queryKey: ["scheduled-transfers", id],
    queryFn: () => listScheduledTransfers(id!),
    enabled: !!id,
    refetchInterval: Date.now() < pollUntil ? 5_000 : false,
  });

  const [wireTransfersExpanded, setWireTransfersExpanded] = useState(false);
  const {
    data: wireTransfers,
    isLoading: wireTransfersLoading,
    error: wireTransfersError,
  } = useQuery({
    queryKey: ["wire-transfers", id],
    queryFn: () => listWireTransfers(id!),
    enabled: !!id && wireTransfersExpanded,
    staleTime: 60_000,
  });

  // Merge server cards with optimistic cards from mutations — optimistic first
  const serverCards: PaymentCard[] = account?.paymentCards?.edges?.map((e) => e.node) ?? [];
  const seenIds = new Set<string>();
  const cards: PaymentCard[] = [];
  // Optimistic cards go first (newest at top)
  optimisticCards.forEach((c) => {
    if (!seenIds.has(c.id)) { seenIds.add(c.id); cards.push(c); }
  });
  // Then server cards that aren't already covered by optimistic
  for (const c of serverCards) {
    if (!seenIds.has(c.id)) { seenIds.add(c.id); cards.push(c); }
  }

  // Clear optimistic entries once server has caught up
  useEffect(() => {
    if (serverCards.length === 0) return;
    const serverIds = new Set(serverCards.map((c) => c.id));
    setOptimisticCards((prev) => {
      if (prev.size === 0) return prev;
      const stillPending = new Map<string, PaymentCard>();
      prev.forEach((c, cid) => {
        if (!serverIds.has(cid)) stillPending.set(cid, c);
      });
      return stillPending.size < prev.size ? stillPending : prev;
    });
  }, [serverCards.map(c => c.id).join(',')]);

  // Invalidate every account-scoped query so balance, activity, transfers and
  // wire history all refresh after a mutation — not just the account itself.
  function invalidateAccount() {
    void queryClient.invalidateQueries({ queryKey: ["me"] });
    void queryClient.invalidateQueries({ queryKey: ["activities"] });
    void queryClient.invalidateQueries({ queryKey: ["scheduled-transfers"] });
    void queryClient.invalidateQueries({ queryKey: ["wire-transfers"] });
  }

  const issueCardMutation = useMutation({
    mutationFn: () => {
      if (!id) throw new Error("No account ID");
      return issueCard(id);
    },
    onSuccess: (newCard) => {
      setOptimisticCards((prev) => new Map(prev).set(newCard.id, newCard));
      startPolling();
    },
    onError: (err: Error) => setActionError(err.message),
  });

  const cardActionMutation = useMutation({
    mutationFn: ({ cardId, action }: { cardId: string; action: "activate" | "suspend" | "close" }) => {
      switch (action) {
        case "activate": return activateCard(cardId);
        case "suspend": return suspendCard(cardId);
        case "close": return closeCard(cardId);
      }
    },
    onSuccess: (updatedCard) => {
      setOptimisticCards((prev) => new Map(prev).set(updatedCard.id, updatedCard));
      startPolling();
    },
    onError: (err: Error) => setActionError(err.message),
  });

  const reissueCardMutation = useMutation({
    mutationFn: ({ cardId, reason, copyNum, copyPn }: { cardId: string; reason: ReissueCardReason; copyNum: boolean; copyPn: boolean }) => {
      return reissueCard(cardId, {
        reason,
        activateOnCreate: true,
        ...(reason === "STOLEN" && id ? { financialAccountId: id } : {}),
        ...((reason === "LOST" || reason === "STOLEN") ? { cardLostDate: new Date().toISOString() } : {}),
        copyNumber: copyNum,
        copyPin: copyPn,
      });
    },
    onSuccess: (newCard) => {
      setReissueCardId(null);
      setReissueReason(null);
      setOptimisticCards((prev) => new Map(prev).set(newCard.id, newCard));
      startPolling();
    },
    onError: (err: Error) => {
      setReissueCardId(null);
      setReissueReason(null);
      setActionError(err.message);
    },
  });

  const openPinModal = useCallback(async (cardId: string) => {
    setPinCardId(cardId);
    setPinStatus("loading");
    setPinError(null);
    try {
      const token = await getPinToken(cardId);
      setPinStatus("ready");
      // Dynamically import to avoid SSR/bundling issues
      const { renderFields } = await import("@highnoteplatform/secure-inputs");
      // Wait for next tick so the #pin-container element is in the DOM
      await new Promise((r) => setTimeout(r, 50));
      const { submit, unmount } = await renderFields({
        elements: {
          pin: {
            clientToken: token.value,
            paymentCardId: cardId,
            selector: "#pin-container",
            masked: true,
            showToggle: true,
          },
        },
        environment: "test",
        onSuccess: () => {
          setPinStatus("success");
        },
        onError: (error: any) => {
          setPinError(error?.message || "Failed to set PIN");
          setPinStatus("error");
        },
      });
      pinSubmitRef.current = submit;
      pinUnmountRef.current = unmount;
    } catch (err) {
      setPinError(err instanceof Error ? err.message : "Failed to load PIN form");
      setPinStatus("error");
    }
  }, []);

  const closePinModal = useCallback(async () => {
    pinSubmitRef.current = null;
    if (pinUnmountRef.current) {
      await pinUnmountRef.current();
      pinUnmountRef.current = null;
    }
    setPinCardId(null);
    setPinStatus("idle");
    setPinError(null);
  }, []);

  const openViewerModal = useCallback(async (cardId: string) => {
    setViewerCardId(cardId);
    setViewerStatus("loading");
    setViewerError(null);
    try {
      const token = await getViewerToken(cardId);
      setViewerStatus("ready");
      const { renderFields } = await import("@highnoteplatform/card-viewer");
      await new Promise((r) => setTimeout(r, 50));
      const { unmount, toggleCardNumberMask } = await renderFields({
        clientToken: token.value,
        paymentCardId: cardId,
        environment: "test",
        onError: (error: any) => {
          setViewerError(error?.message || "Failed to load card details");
          setViewerStatus("error");
        },
        elements: {
          cardNumber: { selector: "#viewer-card-number" },
          cvv: { selector: "#viewer-cvv" },
          expirationDate: { selector: "#viewer-expiry" },
        },
      });
      viewerUnmountRef.current = unmount;
      viewerToggleMaskRef.current = toggleCardNumberMask;
    } catch (err) {
      setViewerError(err instanceof Error ? err.message : "Failed to load card viewer");
      setViewerStatus("error");
    }
  }, []);

  const closeViewerModal = useCallback(async () => {
    viewerToggleMaskRef.current = null;
    if (viewerUnmountRef.current) {
      await viewerUnmountRef.current();
      viewerUnmountRef.current = null;
    }
    setViewerCardId(null);
    setViewerStatus("idle");
    setViewerError(null);
    setShowCvv(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pinUnmountRef.current) {
        void pinUnmountRef.current();
      }
      if (viewerUnmountRef.current) {
        void viewerUnmountRef.current();
      }
    };
  }, []);

  useEffect(() => {
    if (!actionError) return;
    const timer = setTimeout(() => setActionError(null), 30_000);
    return () => clearTimeout(timer);
  }, [actionError]);

  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => setSuccessMessage(null), 30_000);
    return () => clearTimeout(timer);
  }, [successMessage]);

  const suspendAccountMutation = useMutation({
    mutationFn: () => {
      if (!id) throw new Error("No account ID");
      return suspendFinancialAccount(id, "Suspended by user", "ACCOUNT_HOLDER_REQUEST");
    },
    onSuccess: () => { invalidateAccount(); startPolling(); },
    onError: (err: Error) => setActionError(err.message),
  });

  const unsuspendAccountMutation = useMutation({
    mutationFn: () => {
      if (!id) throw new Error("No account ID");
      return unsuspendFinancialAccount(id, "Unsuspended by user");
    },
    onSuccess: () => { invalidateAccount(); startPolling(); },
    onError: (err: Error) => setActionError(err.message),
  });

  const orderPhysicalMutation = useMutation({
    mutationFn: () => {
      if (!orderPhysicalCardId) throw new Error("No card selected");
      return orderPhysicalCard(orderPhysicalCardId, orderForm);
    },
    onSuccess: () => {
      setOrderPhysicalCardId(null);
      setOrderForm({ nameOnCard: "", recipientGivenName: "", recipientFamilyName: "", streetAddress: "", extendedAddress: "", locality: "", region: "", postalCode: "", countryCodeAlpha3: "USA" });
      invalidateAccount();
      startPolling();
    },
    onError: (err: Error) => setActionError(err.message),
  });

  function renderCardActions(card: PaymentCard) {
    const buttons: Array<{
      label: string;
      action: "activate" | "suspend" | "close";
      style: string;
    }> = [];

    if (card.status === "ACTIVATION_REQUIRED" || card.status === "SUSPENDED") {
      buttons.push({ label: "Activate", action: "activate", style: "bg-green-600 text-white hover:bg-green-700" });
    }
    if (card.status === "ACTIVE") {
      buttons.push({ label: "Suspend", action: "suspend", style: "bg-yellow-600 text-white hover:bg-yellow-700" });
    }
    if (card.status !== "CLOSED") {
      buttons.push({ label: "Close", action: "close", style: "bg-red-600 text-white hover:bg-red-700" });
    }

    return (
      <>
        {buttons.map((btn) => (
          <button
            key={btn.action}
            onClick={() => cardActionMutation.mutate({ cardId: card.id, action: btn.action })}
            disabled={cardActionMutation.isPending}
            className={`rounded px-3 py-1 text-xs font-medium ${btn.style} disabled:opacity-50`}
          >
            {btn.label}
          </button>
        ))}
        {card.status === "ACTIVE" && (
          <>
            <button
              onClick={() => openViewerModal(card.id)}
              disabled={viewerStatus === "loading"}
              className="rounded px-3 py-1 text-xs font-medium bg-gray-700 text-white hover:bg-gray-800 disabled:opacity-50"
            >
              View Card
            </button>
            <button
              onClick={() => openPinModal(card.id)}
              disabled={pinStatus === "loading"}
              className="rounded px-3 py-1 text-xs font-medium bg-gray-700 text-white hover:bg-gray-800 disabled:opacity-50"
            >
              Set PIN
            </button>
            {card.formFactor === "VIRTUAL" && (
              <button
                onClick={() => setOrderPhysicalCardId(card.id)}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
              >
                Order Physical
              </button>
            )}
          </>
        )}
        {card.status !== "CLOSED" && (
          <button
            onClick={() => setReissueCardId(card.id)}
            disabled={reissueCardMutation.isPending}
            className="rounded px-3 py-1 text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Reissue
          </button>
        )}
      </>
    );
  }

  if (accountLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBar />
        <div className="mx-auto max-w-5xl px-4 py-8">
          <LoadingSpinner message="Loading account..." />
        </div>
      </div>
    );
  }

  if (accountError) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBar />
        <div className="mx-auto max-w-5xl px-4 py-8">
          <PageHeader title="Account Details" showBack />
          <ErrorMessage
            message={accountError instanceof Error ? accountError.message : "Failed to load account"}
          />
        </div>
      </div>
    );
  }

  const accountStatus = account?.accountStatus ?? "UNKNOWN";
  const cashLedger = account?.ledgers?.find((l) => l.name === "CASH");
  const availableCashLedger = account?.ledgers?.find((l) => l.name === "AVAILABLE_CASH");
  // Highnote returns amounts in minor units (cents for USD).
  // CASH ledger uses debitBalance for prepaid debit cards (debit accounting).
  // AVAILABLE_CASH uses creditBalance.
  const cashBalanceCents = cashLedger?.debitBalance?.value ?? 0;
  const availableCashCents = availableCashLedger?.creditBalance?.value ?? 0;
  const cashBalance = (Number(cashBalanceCents) / 100).toFixed(2);
  const availableCash = (Number(availableCashCents) / 100).toFixed(2);
  const currency = cashLedger?.debitBalance?.currencyCode ?? availableCashLedger?.creditBalance?.currencyCode ?? "USD";

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
        <PageHeader title={account?.name || "Account Details"} showBack />

        {actionError && (
          <div className="mb-4">
            <ErrorMessage message={actionError} onDismiss={() => setActionError(null)} />
          </div>
        )}

        {successMessage && (
          <div className="mb-4">
            <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 flex items-center justify-between">
              <p className="text-sm text-green-800">{successMessage}</p>
              <button onClick={() => setSuccessMessage(null)} className="text-green-600 hover:text-green-800 text-lg leading-none">&times;</button>
            </div>
          </div>
        )}

        {/* Balance Summary */}
        <div className="mb-6 grid grid-cols-2 gap-4">
          <div className="rounded-xl border border-gray-200 border-l-4 border-l-indigo-500 bg-gradient-to-r from-indigo-50/60 to-white p-6 shadow-sm">
            <p className="text-sm text-gray-500">Cash Balance</p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">
              ${cashBalance}
            </p>
            <p className="mt-1 text-xs text-gray-400">{currency}</p>
          </div>
          <div className="rounded-xl border border-gray-200 border-l-4 border-l-indigo-500 bg-gradient-to-r from-indigo-50/60 to-white p-6 shadow-sm">
            <p className="text-sm text-gray-500">Available Cash</p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">
              ${availableCash}
            </p>
            <p className="mt-1 text-xs text-gray-400">{currency}</p>
          </div>
        </div>

        {/* Account Info */}
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1 pr-4">
              <h2 className="text-lg font-medium text-gray-900">Account Information</h2>
              {account?.id && (
                <p className="mt-1 truncate font-mono text-xs text-gray-400" title={account.id}>ID: {account.id}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <StatusBadge status={accountStatus} />
              {accountStatus === "ACTIVE" && (
                <button
                  onClick={() => suspendAccountMutation.mutate()}
                  disabled={suspendAccountMutation.isPending}
                  className="rounded-lg border border-amber-500 px-3 py-1 text-xs font-medium text-amber-600 hover:bg-amber-50 disabled:opacity-50 transition-colors"
                >
                  {suspendAccountMutation.isPending ? "Suspending..." : "Suspend Account"}
                </button>
              )}
              {accountStatus === "SUSPENDED" && (
                <button
                  onClick={() => unsuspendAccountMutation.mutate()}
                  disabled={unsuspendAccountMutation.isPending}
                  className="rounded px-3 py-1 text-xs font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {unsuspendAccountMutation.isPending ? "Unsuspending..." : "Unsuspend Account"}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Cards Section */}
        <div className="mb-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-medium text-gray-900">Cards</h2>
            {cards.every((c) => c.status === "CLOSED") && account?.accountStatus !== "CLOSED" && (
              <button
                onClick={() => issueCardMutation.mutate()}
                disabled={issueCardMutation.isPending || !canIssueCard}
                title={canIssueCard ? undefined : "Identity verification must be completed first"}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {issueCardMutation.isPending ? "Issuing..." : "Issue New Card"}
              </button>
            )}
          </div>

          {cards.every((c) => c.status === "CLOSED") && account?.accountStatus !== "CLOSED" && !canIssueCard && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-700">
              Identity verification hasn't passed yet — a card can't be issued until it does.
              {isTestEnv && " Use the Simulation console to set the verification status to PASSED."}
            </div>
          )}

          {cards.length === 0 && (
            <EmptyState message="No cards issued for this account." />
          )}

          {cards.length > 0 && (
            <div className="space-y-3">
              {cards.map((card) => {
                const isClosed = card.status === "CLOSED";
                const isExpanded = !isClosed && expandedCardId === card.id;
                return (
                  <div
                    key={card.id}
                    className={`rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden ${isClosed ? "opacity-60" : ""}`}
                  >
                    <div
                      role={isClosed ? undefined : "button"}
                      onClick={() => !isClosed && setExpandedCardId(isExpanded ? null : card.id)}
                      className={`flex w-full items-center justify-between p-4 text-left ${isClosed ? "" : "cursor-pointer hover:bg-gray-50 transition-colors"}`}
                    >
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {card.last4 ? `**** ${card.last4}` : "****"}
                        </p>
                        <p className="text-xs text-gray-500">
                          {card.network || "Card"} {card.formFactor ? `\u00b7 ${card.formFactor}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="hidden sm:inline text-xs text-gray-300 font-mono">{card.id}</span>
                        <StatusBadge status={card.status} />
                        {!isClosed && (
                          <svg
                            className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                          </svg>
                        )}
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
                        <div className="flex flex-wrap gap-2">
                          {renderCardActions(card)}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ATM Locator */}
        {cards.some(c => c.status === "ACTIVE") && (
          <div className="mb-6">
            <button
              onClick={() => setShowAtmModal(true)}
              className="w-full flex items-center justify-between rounded-xl border border-gray-200 bg-white px-6 py-4 shadow-sm hover:bg-gray-50 hover:border-indigo-200 transition-all group"
            >
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-indigo-600 text-white text-xs font-bold group-hover:bg-indigo-700 transition-colors">
                  ATM
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium text-gray-900">Find Surcharge-Free ATMs</p>
                  <p className="text-xs text-gray-500">MoneyPass network &middot; Tap to search nearby</p>
                </div>
              </div>
              <svg className="h-5 w-5 text-gray-400 group-hover:text-indigo-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        )}
        {showAtmModal && cards.find(c => c.status === "ACTIVE") && (
          <ATMLocatorModal
            cardId={cards.find(c => c.status === "ACTIVE")!.id}
            onClose={() => setShowAtmModal(false)}
          />
        )}

        {/* Test Tools Panel (test env only) */}
        {isTestEnv && account?.accountStatus !== "CLOSED" && (
          <div className="mb-6 rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/50 overflow-hidden">
            <button
              onClick={() => setShowTestTools(!showTestTools)}
              className="w-full bg-amber-100/60 px-6 py-3 flex items-center justify-between text-left hover:bg-amber-100 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-amber-700">⚙</span>
                <span className="text-sm font-semibold text-amber-800">TEST TOOLS</span>
                <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-medium text-white">TEST ENV ONLY</span>
              </div>
              <svg className={`h-4 w-4 text-amber-500 transition-transform duration-200 ${showTestTools ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showTestTools && (<><div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4 animate-fade-in">
              {/* Fund Account */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Fund Account (Wire Deposit)</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Amount"
                    value={fundAmount}
                    onChange={(e) => setFundAmount(e.target.value)}
                    className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                  />
                  <button
                    onClick={async () => {
                      try {
                        setActionError(null);
                        await simulateDeposit(id!, Number(fundAmount));
                        setFundAmount("");
                        invalidateAccount();
                        startPolling();
                        setSuccessMessage("Wire deposit simulated successfully");
                      } catch (err: any) {
                        setActionError(err.message);
                      }
                    }}
                    disabled={!fundAmount || Number(fundAmount) <= 0}
                    className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
                  >
                    ⚙ Fund
                  </button>
                </div>
              </div>

              {/* Simulate Purchase */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Simulate Purchase</label>
                <div className="flex gap-2 mb-2">
                  <select
                    className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm bg-white"
                    value={simPurchaseCardId ?? ""}
                    onChange={(e) => setSimPurchaseCardId(e.target.value || null)}
                  >
                    <option value="">Select card...</option>
                    {cards.filter(c => c.status === "ACTIVE").map(c => (
                      <option key={c.id} value={c.id}>**** {c.last4 || "????"}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="$"
                    value={simAmount}
                    onChange={(e) => setSimAmount(e.target.value)}
                    className="w-24 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      try {
                        setActionError(null);
                        await simulateAuthorize(simPurchaseCardId!, Number(simAmount), "Test Merchant", "GROCERY_STORES_SUPERMARKETS");
                        setSimAmount("");
                        invalidateAccount();
                        void queryClient.invalidateQueries({ queryKey: ["activities", id] });
                        startPolling();
                        setSuccessMessage("Authorization simulated successfully");
                      } catch (err: any) {
                        setActionError(err.message);
                      }
                    }}
                    disabled={!simPurchaseCardId || !simAmount || Number(simAmount) <= 0}
                    className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
                  >
                    ⚙ Auth Only
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        setActionError(null);
                        await simulateAuthAndClear(simPurchaseCardId!, Number(simAmount), "Test Merchant", "GROCERY_STORES_SUPERMARKETS");
                        setSimAmount("");
                        invalidateAccount();
                        void queryClient.invalidateQueries({ queryKey: ["activities", id] });
                        startPolling();
                        setSuccessMessage("Authorization and clearing simulated successfully");
                      } catch (err: any) {
                        setActionError(err.message);
                      }
                    }}
                    disabled={!simPurchaseCardId || !simAmount || Number(simAmount) <= 0}
                    className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
                  >
                    ⚙ Auth + Clear
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        setActionError(null);
                        await simulateVerify(simPurchaseCardId!);
                        invalidateAccount();
                        void queryClient.invalidateQueries({ queryKey: ["activities", id] });
                        startPolling();
                        setSuccessMessage("Verification simulated successfully");
                      } catch (err: any) {
                        setActionError(err.message);
                      }
                    }}
                    disabled={!simPurchaseCardId}
                    className="rounded-md bg-amber-400 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-500 disabled:opacity-50 transition-colors"
                  >
                    ⚙ Verify
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        setActionError(null);
                        await simulateAuthorize(simPurchaseCardId!, 999999, "Decline Test", "GROCERY_STORES_SUPERMARKETS");
                        invalidateAccount();
                        void queryClient.invalidateQueries({ queryKey: ["activities", id] });
                        startPolling();
                        setSuccessMessage("Decline simulated — check activity feed");
                      } catch (err: any) {
                        // A declined transaction may return as an error OR as a successful response with DECLINED responseCode
                        // Either way, refresh the feed
                        invalidateAccount();
                        void queryClient.invalidateQueries({ queryKey: ["activities", id] });
                        startPolling();
                        setActionError(err.message);
                      }
                    }}
                    disabled={!simPurchaseCardId}
                    className="rounded-md bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
                  >
                    ⚙ Decline
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-400">Default merchant: Test Merchant (Grocery)</p>
              </div>
            </div>

            {/* Link Bank Account */}
            <div className="border-t border-amber-200 px-6 py-4">
              <label className="block text-xs font-semibold text-amber-800 mb-2">Link External Bank Account</label>
              <div className="flex gap-2 mb-3">
                {(["non-verified", "plaid", "finicity"] as const).map((method) => (
                  <button
                    key={method}
                    onClick={() => setBankLinkMethod(method)}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                      bankLinkMethod === method
                        ? "bg-amber-600 text-white"
                        : "bg-amber-100 text-amber-700 hover:bg-amber-200"
                    }`}
                  >
                    {method === "non-verified" ? "Manual" : method === "plaid" ? "Plaid" : "Finicity"}
                  </button>
                ))}
              </div>

              {bankLinkMethod === "non-verified" && (
                <div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Routing Number</label>
                      <input type="text" value={bankRoutingNumber} onChange={(e) => setBankRoutingNumber(e.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm" placeholder="091000019" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Account Number</label>
                      <input type="text" value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm" placeholder="12345" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Account Type</label>
                      <select value={bankAccountType} onChange={(e) => setBankAccountType(e.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm bg-white">
                        <option value="CHECKING">Checking</option>
                        <option value="SAVINGS">Savings</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Name (optional)</label>
                      <input type="text" value={bankAccountName} onChange={(e) => setBankAccountName(e.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm" placeholder="My Checking" />
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        setActionError(null);
                        const accountHolderId = meData?.accountHolder?.id;
                        if (!accountHolderId) throw new Error("No account holder found");
                        await addNonVerifiedBankAccount({ accountHolderId, routingNumber: bankRoutingNumber, accountNumber: bankAccountNumber, bankAccountType, ...(bankAccountName && { name: bankAccountName }) });
                        invalidateAccount(); startPolling();
                        setSuccessMessage("Non-verified bank account linked successfully");
                        setBankAccountName("");
                      } catch (err: any) { setActionError(err.message); }
                    }}
                    disabled={!bankRoutingNumber || !bankAccountNumber}
                    className="mt-3 rounded-md bg-amber-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
                  >
                    ⚙ Link Bank Account
                  </button>
                </div>
              )}

              {bankLinkMethod === "plaid" && (
                <div>
                  <div className="grid grid-cols-1 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Processor Token</label>
                      <input type="text" value={plaidToken} onChange={(e) => setPlaidToken(e.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm" placeholder="processor-token-success" />
                      <p className="mt-1 text-xs text-gray-400">Use "processor-token-success" for test environment</p>
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        setActionError(null);
                        const accountHolderId = meData?.accountHolder?.id;
                        if (!accountHolderId) throw new Error("No account holder found");
                        await addPlaidBankAccount({ accountHolderId, processorToken: plaidToken });
                        invalidateAccount(); startPolling();
                        setSuccessMessage("Plaid bank account linked successfully");
                      } catch (err: any) { setActionError(err.message); }
                    }}
                    disabled={!plaidToken}
                    className="mt-3 rounded-md bg-amber-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
                  >
                    ⚙ Link via Plaid
                  </button>
                </div>
              )}

              {bankLinkMethod === "finicity" && (
                <div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Receipt ID</label>
                      <input type="text" value={finicityReceiptId} onChange={(e) => setFinicityReceiptId(e.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm" />
                      <p className="mt-1 text-xs text-gray-400">Use "processor-token-success" for test</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Customer ID</label>
                      <input type="text" value={finicityCustomerId} onChange={(e) => setFinicityCustomerId(e.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Account Name</label>
                      <input type="text" value={finicityName} onChange={(e) => setFinicityName(e.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Account Type</label>
                      <select value={bankAccountType} onChange={(e) => setBankAccountType(e.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm bg-white">
                        <option value="CHECKING">Checking</option>
                        <option value="SAVINGS">Savings</option>
                      </select>
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        setActionError(null);
                        const accountHolderId = meData?.accountHolder?.id;
                        if (!accountHolderId) throw new Error("No account holder found");
                        await addFinicityBankAccount({ accountHolderId, name: finicityName, bankAccountType, receiptId: finicityReceiptId, customerId: finicityCustomerId });
                        invalidateAccount(); startPolling();
                        setSuccessMessage("Finicity bank account linked successfully");
                      } catch (err: any) { setActionError(err.message); }
                    }}
                    disabled={!finicityReceiptId || !finicityCustomerId || !finicityName}
                    className="mt-3 rounded-md bg-amber-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
                  >
                    ⚙ Link via Finicity
                  </button>
                </div>
              )}
            </div>

            {/* ACH Transfers */}
            {externalAccounts.length > 0 && (
              <div className="border-t border-amber-200 px-6 py-4">
                <label className="block text-xs font-semibold text-amber-800 mb-2">ACH Transfer</label>
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => setAchDirection("pull")}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                      achDirection === "pull" ? "bg-amber-600 text-white" : "bg-amber-100 text-amber-700 hover:bg-amber-200"
                    }`}
                  >
                    Pull (Load Funds)
                  </button>
                  <button
                    onClick={() => setAchDirection("push")}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                      achDirection === "push" ? "bg-amber-600 text-white" : "bg-amber-100 text-amber-700 hover:bg-amber-200"
                    }`}
                  >
                    Push (Send Funds)
                  </button>
                  <button
                    onClick={() => setAchDirection("schedule")}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                      achDirection === "schedule" ? "bg-amber-600 text-white" : "bg-amber-100 text-amber-700 hover:bg-amber-200"
                    }`}
                  >
                    One-Time
                  </button>
                  <button
                    onClick={() => setAchDirection("recurring")}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                      achDirection === "recurring" ? "bg-amber-600 text-white" : "bg-amber-100 text-amber-700 hover:bg-amber-200"
                    }`}
                  >
                    Recurring
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">External Account</label>
                    <select
                      value={achExternalAccountId}
                      onChange={(e) => setAchExternalAccountId(e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm bg-white"
                    >
                      <option value="">Select account...</option>
                      {externalAccounts.map((ea) => (
                        <option key={ea.id} value={ea.id}>
                          {ea.name || "Bank Account"} {ea.externalBankAccountDetails?.last4 ? `(****${ea.externalBankAccountDetails.last4})` : ""} — {ea.__typename === "NonVerifiedExternalUSFinancialBankAccount" ? "Non-Verified" : "Verified"}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Amount ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={achAmount}
                      onChange={(e) => setAchAmount(e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                      placeholder="e.g. 50.00"
                    />
                  </div>
                </div>
                {achDirection === "schedule" && (
                  <div className="mt-3">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Scheduled Date (optional)</label>
                    <input
                      type="date"
                      value={achScheduleDate}
                      onChange={(e) => setAchScheduleDate(e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                    />
                  </div>
                )}
                {achDirection === "recurring" && (
                  <div className="mt-3">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Day of Month (1-28)</label>
                    <input
                      type="number"
                      min="1"
                      max="28"
                      value={achDayOfMonth}
                      onChange={(e) => setAchDayOfMonth(e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                      placeholder="1"
                    />
                  </div>
                )}
                <p className="mt-2 text-xs text-gray-400">
                  {achDirection === "schedule"
                    ? "Schedule a one-time ACH pull from the external account (optional date)"
                    : achDirection === "recurring"
                    ? "Set up a monthly recurring ACH pull on the selected day"
                    : achDirection === "pull"
                    ? "Pull funds FROM the external account INTO this Highnote account"
                    : "Push funds FROM this Highnote account TO the external account"}
                </p>
                <button
                  onClick={async () => {
                    try {
                      setActionError(null);
                      if (!achExternalAccountId || !achAmount) return;
                      if (achDirection === "schedule") {
                        await createOneTimeAchTransfer({
                          fromFinancialAccountId: achExternalAccountId,
                          toFinancialAccountId: id!,
                          amount: Number(achAmount),
                          scheduledDate: achScheduleDate || undefined,
                        });
                        setAchAmount("");
                        setAchScheduleDate("");
                        invalidateAccount();
                        void queryClient.invalidateQueries({ queryKey: ["scheduled-transfers", id] });
                        startPolling();
                        setSuccessMessage("One-time ACH transfer scheduled");
                      } else if (achDirection === "recurring") {
                        await createRecurringAchTransfer({
                          fromFinancialAccountId: achExternalAccountId,
                          toFinancialAccountId: id!,
                          amount: Number(achAmount),
                          dayOfMonth: Number(achDayOfMonth),
                        });
                        setAchAmount("");
                        invalidateAccount();
                        void queryClient.invalidateQueries({ queryKey: ["scheduled-transfers", id] });
                        startPolling();
                        setSuccessMessage(`Recurring monthly ACH transfer set for day ${achDayOfMonth}`);
                      } else {
                        const fromId = achDirection === "pull" ? achExternalAccountId : id!;
                        const toId = achDirection === "pull" ? id! : achExternalAccountId;
                        await initiateAchTransfer({
                          fromFinancialAccountId: fromId,
                          toFinancialAccountId: toId,
                          amount: Number(achAmount),
                          purpose: achDirection === "pull" ? "DEPOSIT" : "WITHDRAWAL",
                        });
                        setAchAmount("");
                        invalidateAccount();
                        void queryClient.invalidateQueries({ queryKey: ["activities", id] });
                        startPolling();
                        setSuccessMessage(`ACH ${achDirection} transfer initiated successfully`);
                      }
                    } catch (err: any) {
                      setActionError(err.message);
                    }
                  }}
                  disabled={!achExternalAccountId || !achAmount || Number(achAmount) <= 0}
                  className="mt-3 rounded-md bg-amber-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
                >
                  {achDirection === "schedule" ? "Schedule Transfer" : achDirection === "recurring" ? "Create Recurring" : achDirection === "pull" ? "Pull Funds" : "Push Funds"}
                </button>
              </div>
            )}

            {/* Scheduled Transfers */}
            {scheduledTransfers && scheduledTransfers.length > 0 && (
              <div className="border-t border-amber-200 px-6 py-4">
                <label className="block text-xs font-semibold text-amber-800 mb-2">
                  Scheduled Transfers ({scheduledTransfers.length})
                </label>
                <div className="space-y-2">
                  {scheduledTransfers.map((st) => {
                    const amount = st.transferAmount?.amount;
                    const amountStr = amount ? `$${(Number(amount.value) / 100).toFixed(2)}` : "\u2014";
                    const isActive = st.status === "SCHEDULED" || st.status === "ACTIVE";
                    return (
                      <div key={st.id} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-gray-900">{amountStr}</p>
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                              st.status === "CANCELED" ? "bg-red-100 text-red-800"
                                : st.status === "CLOSED" ? "bg-gray-100 text-gray-600"
                                : "bg-green-100 text-green-800"
                            }`}>
                              {st.status}
                            </span>
                            <span className="text-xs text-gray-400">
                              {st.__typename === "RecurringACHTransfer" ? "Recurring" : "One-Time"}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {st.scheduledTransferDate ? `Scheduled: ${new Date(st.scheduledTransferDate).toLocaleDateString()}` : ""}
                            {st.frequency ? `Frequency: ${st.frequency}` : ""}
                          </p>
                          <p className="text-xs text-gray-400 font-mono mt-0.5">{st.id}</p>
                        </div>
                        {isActive && (
                          <button
                            onClick={async () => {
                              try {
                                setActionError(null);
                                await cancelAchTransfer(st.id);
                                void queryClient.invalidateQueries({ queryKey: ["scheduled-transfers", id] });
                                setSuccessMessage("Transfer cancelled");
                              } catch (err: any) {
                                setActionError(err.message);
                              }
                            }}
                            className="rounded-md border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Account closure simulation — only if applicable */}
            {(account?.accountStatus === "ACTIVE" || account?.accountStatus === "PENDING_CLOSURE") && (
              <div className="border-t border-amber-200 px-6 py-3 flex gap-2">
                {account?.accountStatus === "ACTIVE" && (
                  <button
                    onClick={async () => {
                      try {
                        setActionError(null);
                        await simulateFinancialAccountInitiateClosure(id!);
                        invalidateAccount();
                        startPolling();
                        setSuccessMessage("Account closure initiated");
                      } catch (err: any) { setActionError(err.message); }
                    }}
                    className="rounded-md border border-amber-500 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 transition-colors"
                  >
                    ⚙ Initiate Closure (Test)
                  </button>
                )}
                {account?.accountStatus === "PENDING_CLOSURE" && (
                  <button
                    onClick={async () => {
                      try {
                        setActionError(null);
                        await simulateFinancialAccountClose(id!);
                        invalidateAccount();
                        startPolling();
                        setSuccessMessage("Account closed");
                      } catch (err: any) { setActionError(err.message); }
                    }}
                    className="rounded-md border border-amber-500 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 transition-colors"
                  >
                    ⚙ Close Account (Test)
                  </button>
                )}
              </div>
            )}
          </>)}
          </div>
        )}

        {/* Card Viewer Modal */}
        {viewerCardId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
              <h3 className="mb-4 text-lg font-semibold text-gray-900">Card Details</h3>

              {viewerStatus === "loading" && (
                <p className="text-sm text-gray-500">Loading card details...</p>
              )}

              {viewerError && (
                <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3">
                  <p className="whitespace-pre-line text-sm text-red-700">{viewerError}</p>
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="text-xs font-medium text-gray-500">Card Number</label>
                    <button
                      onClick={() => viewerToggleMaskRef.current?.()}
                      className="text-xs text-indigo-600 hover:text-indigo-800"
                    >
                      Show / Hide
                    </button>
                  </div>
                  <div id="viewer-card-number" className="rounded-md border border-gray-200 p-2 [&_iframe]:!h-[24px] [&_iframe]:!w-full" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-500">Expiry</label>
                    <div id="viewer-expiry" className="rounded-md border border-gray-200 p-2 [&_iframe]:!h-[24px] [&_iframe]:!w-full" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-500">CVV</label>
                    <div id="viewer-cvv" className="rounded-md border border-gray-200 p-2 [&_iframe]:!h-[24px] [&_iframe]:!w-full" />
                  </div>
                </div>
              </div>

              <button
                onClick={closeViewerModal}
                className="mt-4 w-full rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* Set PIN Modal */}
        {pinCardId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
              <h3 className="mb-4 text-lg font-semibold text-gray-900">Set Card PIN</h3>

              {pinStatus === "loading" && (
                <p className="text-sm text-gray-500">Loading secure PIN form...</p>
              )}

              {pinError && (
                <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3">
                  <p className="whitespace-pre-line text-sm text-red-700">{pinError}</p>
                </div>
              )}

              {pinStatus === "success" && (
                <div className="mb-3 rounded-md border border-green-200 bg-green-50 p-3">
                  <p className="text-sm text-green-700">PIN set successfully!</p>
                </div>
              )}

              {pinStatus !== "success" && (
                <div className="mb-4">
                  <label className="mb-1 block text-sm font-medium text-gray-700">Enter 4-digit PIN</label>
                  <div
                    id="pin-container"
                    className="[&_iframe]:!h-[40px] [&_iframe]:!w-full"
                  />
                </div>
              )}

              {(pinStatus === "ready" || pinStatus === "error") && (
                <button
                  onClick={() => pinSubmitRef.current?.()}
                  className="mb-2 w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  Submit PIN
                </button>
              )}

              <button
                onClick={closePinModal}
                className="w-full rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {pinStatus === "success" ? "Done" : "Cancel"}
              </button>
            </div>
          </div>
        )}

        {/* Reissue Card Modal */}
        {reissueCardId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
              <h3 className="mb-2 text-lg font-semibold text-gray-900">Reissue Card</h3>

              {!reissueReason ? (
                <>
                  <p className="mb-4 text-sm text-gray-500">Why do you need a new card?</p>
                  <div className="space-y-2">
                    {([
                      { reason: "LOST" as const, label: "Lost", desc: "Card is lost" },
                      { reason: "EXPIRED" as const, label: "Expiring / Expired", desc: "Card is near or past expiration" },
                      { reason: "OTHER" as const, label: "Other", desc: "Damaged, worn out, or another reason" },
                      { reason: "STOLEN" as const, label: "Stolen", desc: "Card was stolen — will be closed immediately and a new card issued" },
                    ]).map(({ reason, label, desc }) => (
                      <button
                        key={reason}
                        onClick={() => {
                          if (reason === "STOLEN") {
                            // Stolen skips options — close + issue new immediately
                            reissueCardMutation.mutate({ cardId: reissueCardId, reason, copyNum: false, copyPn: false });
                          } else {
                            setReissueReason(reason);
                            setCopyNumber(reason !== "LOST");
                            setCopyPin(reason !== "LOST");
                          }
                        }}
                        disabled={reissueCardMutation.isPending}
                        className="w-full rounded-lg border border-gray-200 p-3 text-left hover:bg-gray-50 disabled:opacity-50"
                      >
                        <p className="text-sm font-medium text-gray-900">{label}</p>
                        <p className="text-xs text-gray-500">{desc}</p>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <p className="mb-4 text-sm text-gray-500">Choose what to keep from the original card.</p>
                  <div className="space-y-3">
                    <label className={`flex items-center gap-3 rounded-lg border border-gray-200 p-3 ${reissueReason === "LOST" ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-gray-50"}`}>
                      <input
                        type="checkbox"
                        checked={copyNumber}
                        onChange={(e) => setCopyNumber(e.target.checked)}
                        disabled={reissueReason === "LOST"}
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600"
                      />
                      <div>
                        <p className="text-sm font-medium text-gray-900">Keep card number (PAN)</p>
                        <p className="text-xs text-gray-500">
                          {reissueReason === "LOST" ? "Not available for lost cards" : "Same card number, new CVV and expiry"}
                        </p>
                      </div>
                    </label>
                    <label className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 cursor-pointer hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={copyPin}
                        onChange={(e) => setCopyPin(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600"
                      />
                      <div>
                        <p className="text-sm font-medium text-gray-900">Keep PIN</p>
                        <p className="text-xs text-gray-500">Carry over the existing PIN to the new card</p>
                      </div>
                    </label>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() => setReissueReason(null)}
                      disabled={reissueCardMutation.isPending}
                      className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Back
                    </button>
                    <button
                      onClick={() => reissueCardMutation.mutate({ cardId: reissueCardId, reason: reissueReason, copyNum: copyNumber, copyPn: copyPin })}
                      disabled={reissueCardMutation.isPending}
                      className="flex-1 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {reissueCardMutation.isPending ? "Reissuing..." : "Reissue Card"}
                    </button>
                  </div>
                </>
              )}

              {!reissueReason && (
                <button
                  onClick={() => setReissueCardId(null)}
                  disabled={reissueCardMutation.isPending}
                  className="mt-4 w-full rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}

        {/* Activity Section */}
        <div>
          <h2 className="mb-4 text-lg font-medium text-gray-900">Recent Activity</h2>

          {txLoading && <LoadingSpinner message="Loading activity..." />}

          {activitiesError && (!activities || activities.length === 0) && !txLoading && (
            <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-red-200 bg-red-50/40 py-12 px-6 text-center">
              <svg className="h-12 w-12 text-red-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="mt-4 text-sm font-medium text-gray-700">Couldn't load activity</p>
              <p className="mt-1 text-xs text-gray-500">
                {activitiesError instanceof Error ? activitiesError.message : "Something went wrong."}
              </p>
              <button
                onClick={() => void refetchActivities()}
                className="mt-4 rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
              >
                Retry
              </button>
            </div>
          )}

          {activities && activities.length > 0 && (
            <div className="flex items-center gap-3 mb-4">
              <input
                type="text"
                placeholder="Search transactions..."
                value={activitySearch}
                onChange={(e) => setActivitySearch(e.target.value)}
                className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <select
                value={activityStatusFilter}
                onChange={(e) => setActivityStatusFilter(e.target.value as any)}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm bg-white focus:border-indigo-500 focus:outline-none"
              >
                <option value="all">All Status</option>
                <option value="authorized">Authorized</option>
                <option value="cleared">Cleared</option>
                <option value="declined">Declined</option>
              </select>
            </div>
          )}

          {activities && activities.length === 0 && !activitiesError && (
            <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 py-12 px-6">
              <svg className="h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p className="mt-4 text-sm text-gray-500">No activity yet.</p>
            </div>
          )}

          {activities && activities.length > 0 && (() => {
            // Friendly source type names for non-card transactions
            const typeLabels: Record<string, string> = {
              CreditFunds: "Deposit",
              DebitFunds: "Withdrawal",
              InterFinancialAccountTransfer: "Transfer",
              FeeTransferEvent: "Fee",
              IntegratorInitiatedFundsDepositACHTransfer: "ACH Deposit",
              IntegratorInitiatedFundsWithdrawalACHTransfer: "ACH Withdrawal",
              PayrollTransfer: "Payroll",
              SecureDeposit: "Secure Deposit",
              SecureDepositACHTransfer: "Secure Deposit (ACH)",
              SecureCardBalanceRepaymentACHTransfer: "Repayment",
            };

            const filteredActivities = filterActivitiesByStatus(
              filterActivitiesBySearch(activities, activitySearch),
              activityStatusFilter,
            );
            const isEffectivelyPending = (a: any) => {
              if (!a.isComplete) return true;
              // Non-card transfers with PENDING/PROCESSING status from SDK
              const src = a.source as any;
              const xferStatus = (src?.externalStatus ?? src?.integratorStatus)?.status;
              if (xferStatus === "PENDING" || xferStatus === "PROCESSING") return true;
              return false;
            };
            const pendingActivities = filteredActivities.filter(isEffectivelyPending);
            const postedActivities = filteredActivities.filter((a: any) => !isEffectivelyPending(a));

            function renderActivity(activity: any, idx: number) {
              const sourceId = activity.source?.id ?? `activity-${idx}`;
              const isExpanded = expandedActivityId === sourceId;
              const isCardTx = activity.source?.__typename === "DebitTransaction" || activity.source?.__typename === "CreditTransaction";
              const events = (activity.source as any)?.transactionEvents ?? [];
              // Find merchant details and response code from any event (ClearingEvent may be first but lack details)
              const authEvent = events.find((e: any) => e.__typename === "AuthorizationEvent" || e.__typename === "AuthorizationAndClearEvent" || e.__typename === "VerificationEvent");
              const anyEventWithMerchant = events.find((e: any) => e.merchantDetails?.name);
              const merchantSource = anyEventWithMerchant ?? authEvent ?? events[0];
              const merchantName = merchantSource?.merchantDetails?.name;
              const cardLast4 = (authEvent ?? events.find((e: any) => e.paymentCard) ?? events[0])?.paymentCard?.last4;
              const responseCode = (authEvent ?? events[0])?.responseCode;
              const isApproved = !responseCode || responseCode === "APPROVED" || responseCode === "APPROVED_FOR_PARTIAL_AMOUNT" || responseCode === "APPROVED_FOR_PURCHASE_AMOUNT_ONLY";
              const isPending = !activity.isComplete && (activity.pendingAmount?.value ?? 0) > 0;

              // Transfer-level data from enriched SDK fragments
              const source = activity.source as any;
              const transferStatus = (source?.externalStatus ?? source?.integratorStatus)?.status;
              const transferReasonCode = (source?.externalStatus ?? source?.integratorStatus)?.statusReasonCode;
              const transferAmount = source?.amount;
              const transferCompanyName = source?.companyName;

              // Amount display — prefer activity-level amounts, fall back to source-level
              const pending = activity.pendingAmount;
              const posted = activity.postedAmount;
              const activityAmount = (posted?.value ?? 0) > 0 ? posted : (pending?.value ?? 0) > 0 ? pending : null;
              const displayAmount = activityAmount ?? transferAmount;
              const amountDollars = displayAmount ? (Number(displayAmount.value) / 100).toFixed(2) : null;
              const isNegative = activity.sign === "NEGATIVE";

              // Status label and color
              let statusLabel: string;
              let statusColor: string;
              if (isCardTx) {
                if (!isApproved) {
                  statusLabel = "Declined";
                  statusColor = "bg-red-100 text-red-800";
                } else if (isPending) {
                  statusLabel = "Authorized";
                  statusColor = "bg-yellow-100 text-yellow-800";
                } else {
                  statusLabel = "Cleared";
                  statusColor = "bg-green-100 text-green-800";
                }
              } else if (transferStatus) {
                // Use real transfer status from SDK
                const statusMap: Record<string, [string, string]> = {
                  PROCESSED: ["Complete", "bg-green-100 text-green-800"],
                  PROCESSING: ["Processing", "bg-yellow-100 text-yellow-800"],
                  PENDING: ["Pending", "bg-yellow-100 text-yellow-800"],
                  FAILED: ["Failed", "bg-red-100 text-red-800"],
                  RETURNED: ["Returned", "bg-red-100 text-red-800"],
                  REVERSED: ["Reversed", "bg-red-100 text-red-800"],
                  CANCELED: ["Canceled", "bg-gray-100 text-gray-800"],
                };
                [statusLabel, statusColor] = statusMap[transferStatus] ?? [transferStatus, "bg-gray-100 text-gray-800"];
              } else {
                statusLabel = activity.isComplete ? "Complete" : "Processing";
                statusColor = activity.isComplete ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800";
              }

              // Description line
              const transferLabel = typeLabels[activity.source?.__typename ?? ""] ?? activity.source?.__typename ?? "Activity";
              const description = isCardTx
                ? `${merchantName || "Card Transaction"}${cardLast4 ? ` \u00b7 Card ${cardLast4}` : ""}`
                : transferCompanyName ? `${transferLabel} \u00b7 ${transferCompanyName}` : transferLabel;

              return (
                <div key={sourceId} className="border-b border-gray-100 last:border-b-0">
                  <div
                    role="button"
                    onClick={() => setExpandedActivityId(isExpanded ? null : sourceId)}
                    className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">{description}</p>
                      <p className="text-xs text-gray-500">
                        {activity.createdAt ? new Date(activity.createdAt).toLocaleString() : "—"}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 ml-4">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}>
                        {statusLabel}
                      </span>
                      <span className={`text-sm font-medium ${isNegative ? "text-red-600" : "text-green-600"}`}>
                        {amountDollars ? `${isNegative ? "-" : "+"}$${amountDollars}` : "—"}
                      </span>
                      <svg className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="bg-gray-50 px-4 py-3 border-t border-gray-100">
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                        <div className="col-span-2"><dt className="text-gray-500">Transaction ID</dt><dd className="font-mono text-gray-700 break-all">{sourceId}</dd></div>
                        {merchantName && <div><dt className="text-gray-500">Merchant</dt><dd className="text-gray-700">{merchantName}</dd></div>}
                        {merchantSource?.merchantDetails?.categoryCode && <div><dt className="text-gray-500">MCC</dt><dd className="text-gray-700">{merchantSource.merchantDetails.categoryCode}</dd></div>}
                        {merchantSource?.merchantDetails?.description && <div><dt className="text-gray-500">Description</dt><dd className="text-gray-700">{merchantSource.merchantDetails.description}</dd></div>}
                        {responseCode && (
                          <div><dt className="text-gray-500">Response Code</dt><dd className={`font-medium ${isApproved ? "text-green-700" : "text-red-700"}`}>{responseCode}</dd></div>
                        )}
                        {(authEvent?.transactionProcessingType) && (
                          <div><dt className="text-gray-500">Processing Type</dt><dd className="text-gray-700">{authEvent.transactionProcessingType}</dd></div>
                        )}
                        {transferStatus && <div><dt className="text-gray-500">Transfer Status</dt><dd className={`font-medium ${transferStatus === "PROCESSED" ? "text-green-700" : transferStatus === "FAILED" || transferStatus === "RETURNED" ? "text-red-700" : "text-yellow-700"}`}>{transferStatus}</dd></div>}
                        {transferReasonCode && <div><dt className="text-gray-500">Failure Reason</dt><dd className="text-red-700 font-medium">{transferReasonCode.replace(/_/g, " ")}</dd></div>}
                        {transferCompanyName && <div><dt className="text-gray-500">Company</dt><dd className="text-gray-700">{transferCompanyName}</dd></div>}
                        {source?.settlementDate && <div><dt className="text-gray-500">Settlement Date</dt><dd className="text-gray-700">{source.settlementDate}</dd></div>}
                        {transferAmount && <div><dt className="text-gray-500">Transfer Amount</dt><dd className="text-gray-700">${(Number(transferAmount.value) / 100).toFixed(2)} {transferAmount.currencyCode}</dd></div>}
                        {events.map((evt: any) => (
                          <div key={evt.id} className="col-span-2"><dt className="text-gray-500">Event ({evt.__typename})</dt><dd className="font-mono text-gray-700 break-all">{evt.id}</dd></div>
                        ))}
                      </dl>
                      {isTestEnv && isPending && isCardTx && (
                        <div className="mt-2 pt-2 border-t border-gray-200">
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                setActionError(null);
                                await simulateClear(sourceId);
                                invalidateAccount();
                                void queryClient.invalidateQueries({ queryKey: ["activities", id] });
                                startPolling();
                                setSuccessMessage("Transaction cleared successfully");
                              } catch (err: any) {
                                setActionError(err.message);
                              }
                            }}
                            className="rounded-md border border-amber-500 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 transition-colors"
                          >
                            ⚙ Clear Transaction (Test)
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <div className="space-y-6">
                {/* Pending Section */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Pending</h3>
                  {pendingActivities.length === 0 ? (
                    <p className="text-xs text-gray-400 italic">No pending transactions</p>
                  ) : (
                    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                      {pendingActivities.map(renderActivity)}
                    </div>
                  )}
                </div>

                {/* Posted Section */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Posted</h3>
                  {postedActivities.length === 0 ? (
                    <p className="text-xs text-gray-400 italic">No posted transactions</p>
                  ) : (
                    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                      {postedActivities.map(renderActivity)}
                    </div>
                  )}
                </div>
                {filteredActivities.length === 0 && (activitySearch || activityStatusFilter !== "all") && (
                  <p className="text-sm text-gray-500 text-center py-4">No transactions match your filters.</p>
                )}
                {activities && activities.length >= activityPageSize && (
                  <div className="mt-4 flex justify-center">
                    <button
                      onClick={() => setActivityPageSize((prev) => prev + 20)}
                      className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      Load More
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* Wire Transfers Section */}
        <div>
          <button
            onClick={() => setWireTransfersExpanded(!wireTransfersExpanded)}
            className="flex w-full items-center justify-between mb-4"
          >
            <h2 className="text-lg font-medium text-gray-900">Wire Transfers</h2>
            <div className="flex items-center gap-2">
              {wireTransfers && wireTransfers.length > 0 && (
                <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                  {wireTransfers.length}
                </span>
              )}
              <svg className={`h-5 w-5 text-gray-400 transition-transform ${wireTransfersExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </button>

          {wireTransfersExpanded && (
            <>
              {wireTransfersLoading && <LoadingSpinner message="Loading wire transfers..." />}

              {wireTransfersError && (
                <ErrorMessage message={wireTransfersError.message || "Failed to load wire transfers"} />
              )}

              {wireTransfers && wireTransfers.length === 0 && (
                <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 py-8 px-6">
                  <svg className="h-10 w-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                  </svg>
                  <p className="mt-3 text-sm text-gray-500">No wire transfers</p>
                </div>
              )}

              {wireTransfers && wireTransfers.length > 0 && (() => {
                const reviewStateColors: Record<string, string> = {
                  COMPLETED: "bg-green-100 text-green-800",
                  APPROVED: "bg-green-100 text-green-800",
                  PENDING: "bg-yellow-100 text-yellow-800",
                  IN_REVIEW: "bg-yellow-100 text-yellow-800",
                  FAILED: "bg-red-100 text-red-800",
                  REJECTED: "bg-red-100 text-red-800",
                };

                return (
                <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                  {wireTransfers.map((event: ReviewWorkflowEvent) => {
                    const transfer = event.transfer;
                    const amount = transfer?.amount?.value != null ? (transfer.amount.value / 100).toFixed(2) : null;
                    const isIncoming = transfer?.type === "INCOMING";

                    return (
                      <div key={event.id} className="border-b border-gray-100 last:border-b-0 px-4 py-3">
                        <div className="flex items-center justify-between">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900">
                              {isIncoming ? "Incoming" : "Outgoing"} Wire Transfer
                              {transfer?.memo && <span className="text-gray-500"> · {transfer.memo}</span>}
                            </p>
                            <p className="text-xs text-gray-500">
                              {event.createdAt ? new Date(event.createdAt).toLocaleString() : "—"}
                            </p>
                            {transfer?.statusReason && (
                              <p className="text-xs text-red-600 mt-0.5">{transfer.statusReason.replace(/_/g, " ")}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-3 ml-4">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${reviewStateColors[event.reviewState] ?? "bg-gray-100 text-gray-800"}`}>
                              {event.reviewState}
                            </span>
                            {amount && (
                              <span className={`text-sm font-medium ${isIncoming ? "text-green-600" : "text-red-600"}`}>
                                {isIncoming ? "+" : "-"}${amount}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                );
              })()}
            </>
          )}
        </div>

        {/* Order Physical Card Modal */}
        {orderPhysicalCardId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setOrderPhysicalCardId(null)}>
            <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-medium text-gray-900 mb-4">Order Physical Card</h3>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Name on Card</label>
                  <input className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    value={orderForm.nameOnCard}
                    onChange={(e) => setOrderForm(f => ({ ...f, nameOnCard: e.target.value }))}
                    placeholder="JANE DOE" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Recipient First Name</label>
                    <input className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      value={orderForm.recipientGivenName}
                      onChange={(e) => setOrderForm(f => ({ ...f, recipientGivenName: e.target.value }))}
                      placeholder="Jane" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Recipient Last Name</label>
                    <input className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      value={orderForm.recipientFamilyName}
                      onChange={(e) => setOrderForm(f => ({ ...f, recipientFamilyName: e.target.value }))}
                      placeholder="Doe" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Street Address</label>
                  <input className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    value={orderForm.streetAddress}
                    onChange={(e) => setOrderForm(f => ({ ...f, streetAddress: e.target.value }))}
                    placeholder="123 Main St" />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Apt / Suite (optional)</label>
                  <input className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    value={orderForm.extendedAddress}
                    onChange={(e) => setOrderForm(f => ({ ...f, extendedAddress: e.target.value }))} />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">City</label>
                    <input className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      value={orderForm.locality}
                      onChange={(e) => setOrderForm(f => ({ ...f, locality: e.target.value.replace(/[0-9]/g, "") }))}
                      placeholder="San Francisco" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">State</label>
                    <input className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm uppercase"
                      value={orderForm.region}
                      onChange={(e) => setOrderForm(f => ({ ...f, region: e.target.value.replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase() }))}
                      placeholder="CA"
                      maxLength={2} />
                    {orderForm.region && orderForm.region.length !== 2 && (
                      <p className="text-xs text-red-500 mt-1">Use 2-letter state code</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Postal Code</label>
                    <input className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      value={orderForm.postalCode}
                      onChange={(e) => setOrderForm(f => ({ ...f, postalCode: e.target.value.replace(/\D/g, "").slice(0, 5) }))}
                      placeholder="94107"
                      maxLength={5} />
                    {orderForm.postalCode && orderForm.postalCode.length !== 5 && (
                      <p className="text-xs text-red-500 mt-1">Must be 5 digits</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={() => setOrderPhysicalCardId(null)}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => orderPhysicalMutation.mutate()}
                  disabled={orderPhysicalMutation.isPending || !orderForm.nameOnCard || !orderForm.recipientGivenName || !orderForm.recipientFamilyName || !orderForm.streetAddress || !orderForm.locality || orderForm.region.length !== 2 || orderForm.postalCode.length !== 5}
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {orderPhysicalMutation.isPending ? "Ordering..." : "Order Physical Card"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
