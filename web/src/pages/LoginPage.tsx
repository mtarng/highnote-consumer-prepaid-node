import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useEnvironment } from "../context/EnvironmentContext";
import { ErrorMessage } from "../components/ErrorMessage";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login, signup } = useAuth();
  const { isTestEnv } = useEnvironment();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // Sign-up vs sign-in lives in the URL so the mode is shareable and survives Back.
  const isSignUp = searchParams.get("mode") === "signup";
  const sessionExpired = !isSignUp && searchParams.get("reason") === "session-expired";

  const [passwordError, setPasswordError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPasswordError(null);

    if (isSignUp && password.length < 8) {
      setPasswordError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);

    try {
      if (isSignUp) {
        await signup(email, password);
      } else {
        await login(email, password);
      }
      navigate("/");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-slate-100 px-4">
      <div className="w-full max-w-md">
        <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="flex items-center justify-center gap-2 mb-1">
            <img src="/favicon.svg" alt="Bay19" className="w-8 h-8" />
            <h1 className="text-3xl font-extrabold tracking-tight text-indigo-600">
              Bay19
            </h1>
          </div>
          {isTestEnv && (
            <div className="flex justify-center">
              <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                Test
              </span>
            </div>
          )}
          <p className="mb-1 text-center text-xs font-medium text-gray-400">
            Prepaid Debit, Simplified
          </p>
          <div className="mx-auto mb-5 mt-3 h-px w-16 bg-indigo-200" />
          <p className="mb-6 text-center text-sm font-medium text-gray-700">
            {isSignUp ? "Create Account" : "Sign In"}
          </p>

          {sessionExpired && !error && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Your session expired. Please sign in again to continue.
            </div>
          )}

          {error && (
            <div className="mb-4">
              <ErrorMessage message={error} />
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-gray-700"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={isSignUp ? 8 : 1}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setPasswordError(null); }}
                className={`mt-1 block w-full rounded-lg border ${passwordError ? "border-red-300" : "border-gray-300"} px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500`}
                placeholder={isSignUp ? "At least 8 characters" : "Enter your password"}
              />
              {passwordError && (
                <p className="mt-1 text-xs text-red-600">{passwordError}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  {isSignUp ? "Creating account..." : "Signing in..."}
                </span>
              ) : isSignUp ? (
                "Create Account"
              ) : (
                "Sign In"
              )}
            </button>
          </form>

          <div className="mt-4 text-center">
            <button
              onClick={() => {
                setSearchParams(isSignUp ? {} : { mode: "signup" });
                setError(null);
                setPasswordError(null);
              }}
              className="text-sm text-indigo-600 hover:text-indigo-500"
            >
              {isSignUp
                ? "Already have an account? Sign in"
                : "Don't have an account? Create one"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
