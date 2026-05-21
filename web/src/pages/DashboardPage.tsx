import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { getMe, type FinancialAccount, type CardProductApplication, type MeResponse } from "../api/client";
import { NavBar } from "../components/NavBar";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { ErrorMessage } from "../components/ErrorMessage";
import { EmptyState } from "../components/EmptyState";

export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user && !user.accountHolderId) {
      navigate("/onboard");
    }
  }, [user, navigate]);

  const queryClient = useQueryClient();
  const [pollUntil, setPollUntil] = useState(0);

  const {
    data: meData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    enabled: !!user?.accountHolderId,
    // Always refetch when landing on the dashboard so newly approved
    // applications and freshly provisioned accounts show up immediately.
    refetchOnMount: "always",
    refetchInterval: Date.now() < pollUntil ? 10_000 : false,
  });

  // Preserve optimistic accounts that the server hasn't indexed yet
  const optimisticAccountsRef = useRef<FinancialAccount[]>([]);
  const serverAccounts = meData?.accountHolder?.financialAccounts?.edges?.map((e) => e.node) ?? [];

  // Capture any accounts from cache that aren't in the server response yet
  // (injected by ApplyPage's handleIssue) and clear stale ones
  useEffect(() => {
    const cachedMe = queryClient.getQueryData<MeResponse>(["me"]);
    const cachedAccounts = cachedMe?.accountHolder?.financialAccounts?.edges?.map((e) => e.node) ?? [];
    for (const ca of cachedAccounts) {
      if (!serverAccounts.some((sa) => sa.id === ca.id) &&
          !optimisticAccountsRef.current.some((oa) => oa.id === ca.id)) {
        optimisticAccountsRef.current = [...optimisticAccountsRef.current, ca];
      }
    }

    // Start polling if there are optimistic accounts not yet in server data
    if (optimisticAccountsRef.current.length > 0) {
      setPollUntil((prev) => Math.max(prev, Date.now() + 30_000));
    }

    // Clear optimistic accounts once server catches up
    const serverIds = new Set(serverAccounts.map((a) => a.id));
    if (optimisticAccountsRef.current.length > 0 &&
        optimisticAccountsRef.current.every((oa) => serverIds.has(oa.id))) {
      optimisticAccountsRef.current = [];
    }
  }, [serverAccounts, queryClient]);

  // Merge: server + optimistic (deduped)
  const mergedMap = new Map<string, FinancialAccount>();
  for (const a of serverAccounts) mergedMap.set(a.id, a);
  for (const a of optimisticAccountsRef.current) mergedMap.set(a.id, a);
  const accounts = Array.from(mergedMap.values());

  // Open applications (not yet APPROVED or CLOSED)
  const allApplications: CardProductApplication[] =
    meData?.accountHolder?.cardProductApplications?.edges?.map((e) => e.node) ?? [];
  const openApplications = allApplications.filter(
    (a) => a.applicationState?.status && !["APPROVED", "CLOSED", "DENIED"].includes(a.applicationState.status)
  );

  if (!user?.accountHolderId) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <div className="mx-auto max-w-5xl px-4 py-8">
        <PageHeader title="Dashboard" />

        {user?.email && (
          <p className="mb-6 text-sm text-gray-500">
            Welcome back, <span className="font-medium text-gray-700">{user.email}</span>
          </p>
        )}

        {isLoading && <LoadingSpinner message="Loading accounts..." />}

        {error && (
          <ErrorMessage
            message={
              error instanceof Error
                ? error.message
                : "Failed to load accounts"
            }
          />
        )}

        {/* Open Applications */}
        {openApplications.length > 0 && (
          <div className="mb-6 space-y-3">
            <h2 className="text-lg font-medium text-gray-900">Open Applications</h2>
            {openApplications.map((app) => (
              <button
                key={app.id}
                onClick={() => navigate(`/apply?applicationId=${app.id}`)}
                className="flex w-full items-center justify-between rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-left shadow-sm hover:border-yellow-300 hover:shadow-md transition-all"
              >
                <div>
                  <p className="font-medium text-gray-900">{app.cardProduct?.name || "Card Application"}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    Applied {app.createdAt ? new Date(app.createdAt).toLocaleDateString() : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={app.applicationState?.status || "PENDING"} />
                  <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>
            ))}
          </div>
        )}

        {!isLoading && accounts.length === 0 && openApplications.length === 0 && (
          <EmptyState
            message="You don't have any accounts yet."
            actionLabel="Apply for a Card"
            onAction={() => navigate("/apply")}
          />
        )}

        {accounts.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between pt-2">
              <h2 className="text-lg font-medium text-gray-900">
                Financial Accounts
              </h2>
              <button
                onClick={() => navigate("/apply")}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
              >
                Apply for a Card
              </button>
            </div>

            <div className="grid gap-4">
              {accounts.map((account) => {
                const cashLedger = account.ledgers?.find((l) => l.name === "CASH");
                const availableCashLedger = account.ledgers?.find((l) => l.name === "AVAILABLE_CASH");
                const cashBalanceCents = cashLedger?.debitBalance?.value ?? 0;
                const availableCashCents = availableCashLedger?.creditBalance?.value ?? 0;
                const cashBalance = (Number(cashBalanceCents) / 100).toFixed(2);
                const availableCash = (Number(availableCashCents) / 100).toFixed(2);
                const currency = cashLedger?.debitBalance?.currencyCode ?? availableCashLedger?.creditBalance?.currencyCode ?? "USD";

                return (
                  <button
                    key={account.id}
                    onClick={() => navigate(`/accounts/${account.id}`)}
                    className={`flex w-full items-center justify-between rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm hover:border-indigo-300 hover:shadow-md transition-all border-l-4 ${account.accountStatus === "ACTIVE" ? "border-l-indigo-500" : account.accountStatus === "SUSPENDED" ? "border-l-amber-400" : "border-l-gray-300"}`}
                  >
                    <div>
                      <p className="font-medium text-gray-900">
                        {account.name || "Unnamed Account"}
                      </p>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <p className="text-lg font-semibold text-gray-900">
                          ${cashBalance}
                        </p>
                        <p className="text-xs text-gray-500">
                          ${availableCash} available &middot; {currency}
                        </p>
                      </div>
                      <StatusBadge status={account.accountStatus} />
                      <svg
                        className="h-5 w-5 text-gray-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
