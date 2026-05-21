import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./context/AuthContext";
import { EnvironmentProvider } from "./context/EnvironmentContext";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Rate-limit (429) errors are transient — retry a few times, backing off
      // past the Highnote rate-limit window. Other errors retry once.
      retry: (failureCount, error) => {
        const status = (error as { status?: number } | null)?.status;
        return status === 429 ? failureCount < 3 : failureCount < 1;
      },
      retryDelay: (attempt, error) => {
        const status = (error as { status?: number } | null)?.status;
        if (status === 429) return 10_000;
        return Math.min(1000 * 2 ** attempt, 30_000);
      },
      staleTime: 30_000,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <EnvironmentProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </EnvironmentProvider>
    </QueryClientProvider>
  </StrictMode>
);
