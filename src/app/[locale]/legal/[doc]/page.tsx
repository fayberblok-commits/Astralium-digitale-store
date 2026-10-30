import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LEGAL_DOCS, getLegalDoc, getMessagingPrivacy } from "../../../../data/legal";
import { getDictionary } from "../../../../i18n/dictionaries";
import { LOCALE_CODES } from "../../../../i18n/locales";

export function generateStaticParams() {
  return LOCALE_CODES.flatMap((locale) => LEGAL_DOCS.map((d) => ({ locale, doc: d.slug })));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; doc: string }>;
}): Promise<Metadata> {
  const { doc } = await params;
  const found = getLegalDoc(doc);
  return { title: found?.title ?? "Legal" };
}

export default async function LegalPage({
  params,
}: {
  params: Promise<{ locale: string; doc: string }>;
}) {
  const { locale, doc } = await params;
  const found = getLegalDoc(doc);
  if (!found) notFound();
  const dict = getDictionary(locale);
  return (
    <article className="legal-body" style={{ marginTop: 30 }}>
      <h1>{found.title}</h1>
      <p className="muted">Last updated: {found.updated}</p>
      <div className="notice" role="note">{dict.legal_note}</div>
      {found.body.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
      {doc === "privacy" &&
        (() => {
          const mp = getMessagingPrivacy(locale);
          return (
            <section>
              <h2>{mp.title}</h2>
              {mp.body.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </section>
          );
        })()}
    </article>
  );
}
