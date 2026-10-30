import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary } from "../../../i18n/dictionaries";
import { isLocale } from "../../../i18n/locales";
import { getFlag } from "../../../lib/flags";
import LicenseClient from "../../../components/LicenseClient";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const dict = getDictionary(locale);
  return { title: dict.license_t, description: dict.license_d };
}

export default async function LicensePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  if (!(await getFlag("license_keys"))) notFound();
  const dict = getDictionary(locale);
  return (
    <>
      <h1 style={{ marginTop: 28 }}>{dict.license_t}</h1>
      <p className="muted" style={{ maxWidth: 620 }}>{dict.license_d}</p>
      <LicenseClient dict={dict} />
    </>
  );
}
