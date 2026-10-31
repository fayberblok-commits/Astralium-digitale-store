"use client";

/**
 * Manager's Office — owner bank vault (Phase 4 upgrade, item 7).
 * Owner-only section (the API enforces the `bank` permission). Shows
 * the masked record; saving and revealing both demand a fresh step-up
 * (inline re-auth form when the API answers STEP_UP_REQUIRED).
 * Plaintext lives in component state only while revealed, and the
 * panel hides it again on demand — nothing is persisted client-side.
 */
import { useEffect, useState } from "react";
import StepUpForm, { type StepUpDict } from "./StepUpForm";

export interface BankDict {
  loading: string; title: string; desc: string; holder: string; bankName: string;
  account: string; iban: string; swift: string; currency: string; notes: string;
  save: string; reveal: string; hide: string; empty: string; updated: string;
  saved: string; stepUp: StepUpDict;
}

interface BankDetails {
  accountHolder: string; bankName: string; accountNumber: string; iban: string;
  swiftBic: string; currency: string; notes: string;
}
interface Masked extends BankDetails { present: boolean }
const EMPTY: BankDetails = { accountHolder: "", bankName: "", accountNumber: "", iban: "", swiftBic: "", currency: "", notes: "" };

export default function BankVaultPanel({ dict }: { dict: BankDict }) {
  const [state, setState] = useState<"loading" | "empty" | "ok" | "unavailable">("loading");
  const [masked, setMasked] = useState<Masked | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [form, setForm] = useState<BankDetails>(EMPTY);
  const [revealed, setRevealed] = useState<BankDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stepUpFor, setStepUpFor] = useState<null | "save" | "reveal">(null);

  async function load() {
    const res = await fetch("/api/admin/office/bank");
    if (!res.ok) { setError(`HTTP ${res.status}`); setState("unavailable"); return; }
    const d = (await res.json()) as { state: string; masked?: Masked; updatedAt?: string };
    if (d.state === "ok" && d.masked) {
      setState("ok"); setMasked(d.masked); setUpdatedAt(d.updatedAt ?? null);
    } else if (d.state === "empty") setState("empty");
    else setState("unavailable");
  }
  useEffect(() => { void load(); }, []);

  async function attemptSave(): Promise<boolean> {
    const res = await fetch("/api/admin/office/bank", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ details: form }),
    });
    const d = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.ok) { setNotice(dict.saved); setStepUpFor(null); await load(); return true; }
    if (d.error === "STEP_UP_REQUIRED") { setStepUpFor("save"); return false; }
    setError(d.error ?? `HTTP ${res.status}`);
    return false;
  }

  async function attemptReveal(): Promise<boolean> {
    const res = await fetch("/api/admin/office/bank/reveal", { method: "POST" });
    const d = (await res.json().catch(() => ({}))) as { error?: string; details?: BankDetails };
    if (res.ok && d.details) { setRevealed(d.details); setStepUpFor(null); return true; }
    if (d.error === "STEP_UP_REQUIRED") { setStepUpFor("reveal"); return false; }
    setError(d.error ?? `HTTP ${res.status}`);
    return false;
  }

  const field = (label: string, key: keyof BankDetails) => (
    <label>{label}
      <input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} maxLength={200} />
    </label>
  );
  const maskedRow = (label: string, value: string) => (
    <p className="summary-row"><span>{label}</span><span>{value || "—"}</span></p>
  );

  return (
    <div>
      <p className="muted">{dict.desc}</p>
      {error && <p className="form-error">{error}</p>}
      {notice && <p className="ok-text">{notice}</p>}
      {state === "loading" && <p className="muted">{dict.loading}</p>}
      {state === "empty" && <p className="muted">{dict.empty}</p>}
      {state === "ok" && masked && !revealed && (
        <div>
          {maskedRow(dict.holder, masked.accountHolder)}
          {maskedRow(dict.bankName, masked.bankName)}
          {maskedRow(dict.account, masked.accountNumber)}
          {maskedRow(dict.iban, masked.iban)}
          {maskedRow(dict.swift, masked.swiftBic)}
          {maskedRow(dict.currency, masked.currency)}
          {updatedAt && <p className="muted">{dict.updated}: {new Date(updatedAt).toLocaleString()}</p>}
          <div className="btn-row">
            <button type="button" className="btn btn-primary" onClick={() => void attemptReveal()}>{dict.reveal}</button>
          </div>
        </div>
      )}
      {revealed && (
        <div>
          {maskedRow(dict.holder, revealed.accountHolder)}
          {maskedRow(dict.bankName, revealed.bankName)}
          {maskedRow(dict.account, revealed.accountNumber)}
          {maskedRow(dict.iban, revealed.iban)}
          {maskedRow(dict.swift, revealed.swiftBic)}
          {maskedRow(dict.currency, revealed.currency)}
          {maskedRow(dict.notes, revealed.notes)}
          <button type="button" className="btn" onClick={() => setRevealed(null)}>{dict.hide}</button>
        </div>
      )}
      {stepUpFor && (
        <StepUpForm dict={dict.stepUp} onDone={() => { void (stepUpFor === "save" ? attemptSave() : attemptReveal()); }} />
      )}
      <form className="admin-form" onSubmit={(e) => { e.preventDefault(); void attemptSave(); }}>
        {field(dict.holder, "accountHolder")}
        {field(dict.bankName, "bankName")}
        {field(dict.account, "accountNumber")}
        {field(dict.iban, "iban")}
        {field(dict.swift, "swiftBic")}
        {field(dict.currency, "currency")}
        <label>{dict.notes}
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={1000} rows={2} />
        </label>
        <button type="submit" className="btn btn-primary">{dict.save}</button>
      </form>
    </div>
  );
}
