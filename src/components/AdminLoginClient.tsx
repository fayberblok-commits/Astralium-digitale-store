"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginClient({ locale, configured }: { locale: string; configured: boolean }) {
  const [password, setPassword] = useState("");
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
            body: JSON.stringify({ password }),
          });
          if (res.ok) {
            router.push(`/${locale}/control-astralium`);
            router.refresh();
          } else {
            setError("Incorrect password.");
            setBusy(false);
          }
        }}
      >
        <label>
          Admin password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p className="err-text" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Checking…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
