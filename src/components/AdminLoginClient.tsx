"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Admin sign-in. Two modes, one form:
 *  - Owner: just the ADMIN_PASSWORD (bootstrap owner, unchanged).
 *  - Team account (Phase 6, feature 29): email + password; when the
 *    account has TOTP enabled the server answers TOTP_REQUIRED and the
 *    code field appears (authenticator code or a backup code).
 */
export default function AdminLoginClient({ locale, configured }: { locale: string; configured: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  if (!configured) {
    return (
      <div className="panel" style={{ marginTop: 32 }}>
        <h1>Admin disabled</h1>
        <p className="muted">
          The admin area is turned off because <code>ADMIN_PASSWORD</code> is not set.
          Add it in your hosting environment variables (Vercel → Project → Settings →
          Environment Variables), redeploy, and return here. See <code>.env.example</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="panel" style={{ marginTop: 32 }}>
      <h1>Astralium Control</h1>
      <form
        className="admin-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const res = await fetch("/api/admin/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              password,
              ...(email.trim() ? { email: email.trim() } : {}),
              ...(code.trim() ? { code: code.trim() } : {}),
            }),
          });
          if (res.ok) {
            router.push(`/${locale}/control-astralium`);
            router.refresh();
            return;
          }
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          if (data.error === "TOTP_REQUIRED") {
            setNeedCode(true);
            setError("Enter the 6-digit code from your authenticator app (or a backup code).");
          } else if (data.error === "TOTP_INVALID") {
            setNeedCode(true);
            setError("That code did not match. Codes are single-use and time-based — try the current one.");
          } else {
            setError("Incorrect credentials.");
          }
          setBusy(false);
        }}
      >
        <label>
          Team email (optional — leave empty for the owner password)
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            placeholder="you@example.com"
          />
        </label>
        <label>
          {email.trim() ? "Account password" : "Admin password"}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {needCode && (
          <label>
            Authenticator / backup code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="one-time-code"
              inputMode="text"
              required
            />
          </label>
        )}
        {error && <p className="err-text" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Checking…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
