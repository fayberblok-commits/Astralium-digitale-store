import type { Metadata } from "next";
import { getDictionary } from "../../../i18n/dictionaries";
import { getFlag } from "../../../lib/flags";
import { resolvePrivacyRequest } from "../../../lib/privacy";
import PrivacyCenterClient from "../../../components/PrivacyCenterClient";
import PrivacyDeleteConfirm from "../../../components/PrivacyDeleteConfirm";
import PushOptIn from "../../../components/PushOptIn";

export const metadata: Metadata = { title: "Privacy Center", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Privacy center (Phase 6, feature 30). With ?token=… the page becomes
 * the landing for a verified one-time link: export tokens get a
 * download button (the download itself consumes the token), delete
 * tokens get an explicit confirmation form. Anything else renders the
 * request + consent-preference forms.
 */
export default async function PrivacyCenterPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { locale } = await params;
  const { token } = await searchParams;
  const dict = getDictionary(locale);

  if (!(await getFlag("privacy_center"))) {
    return (
      <>
        <h1 style={{ marginTop: 28 }}>{dict.pc_t}</h1>
        <p className="muted">{dict.pc_disabled}</p>
      </>
    );
  }

  let tokenBlock: React.ReactNode = null;
  if (token) {
    const pending = await resolvePrivacyRequest(token);
    if (!pending) {
      tokenBlock = (
        <section className="panel">
          <p><span className="pill pill-bad">{dict.pc_token_invalid}</span></p>
        </section>
      );
    } else if (pending.kind === "export") {
      tokenBlock = (
        <section className="panel">
          <h2>{dict.pc_export_ready}</h2>
          <p>
            <a className="btn btn-primary" href={`/api/privacy/export?token=${encodeURIComponent(token)}`}>
              {dict.pc_download_json}
            </a>
          </p>
        </section>
      );
    } else {
      tokenBlock = (
        <section className="panel">
          <h2>{dict.pc_delete_confirm_t}</h2>
          <PrivacyDeleteConfirm dict={dict} token={token} />
        </section>
      );
    }
  }

  const showPush = await getFlag("pwa_push");

  return (
    <>
      <h1 style={{ marginTop: 28 }}>{dict.pc_t}</h1>
      <p className="muted">{dict.pc_d}</p>
      {tokenBlock}
      <PrivacyCenterClient dict={dict} locale={locale} />
      {showPush && (
        <section className="panel">
          <PushOptIn dict={dict} />
        </section>
      )}
    </>
  );
}
