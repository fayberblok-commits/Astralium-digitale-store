import Link from "next/link";
import type { Product } from "@/db/schema";
import { categoryLabel, type LocaleCode } from "@/lib/i18n";
import { convertFromUsd, formatAmount } from "@/lib/money";
import { ratingOf } from "@/lib/store";
import { WishlistButton } from "@/components/wishlist-button";

const GRADIENTS: Record<string, string> = {
  nebula: "from-[#1b1740] via-[#2b1f55] to-[#090a1c]",
  gold: "from-[#3a2b14] via-[#6d5222] to-[#100b04]",
  emerald: "from-[#0d2e2a] via-[#134e42] to-[#050f0d]",
  violet: "from-[#26123b] via-[#51216b] to-[#0c0614]",
  solar: "from-[#3a1d12] via-[#7a3b18] to-[#120705]",
  ocean: "from-[#0b2440] via-[#134a6b] to-[#040d17]",
  ivory: "from-[#2a2620] via-[#4a4235] to-[#12100c]",
};

export function CoverArt({
  title,
  coverStyle,
  glyph,
  compact = false,
  className = "",
}: {
  title: string;
  coverStyle: string;
  glyph: string;
  compact?: boolean;
  className?: string;
}) {
  const gradient = GRADIENTS[coverStyle] ?? GRADIENTS.nebula;
  return (
    <div
      className={`relative isolate overflow-hidden rounded-2xl border border-[rgba(217,178,106,0.28)] bg-gradient-to-br ${gradient} ${className}`}
      aria-hidden="true"
    >
      <div className="cover-sheen absolute inset-0 opacity-60" />
      <div className="absolute inset-0 opacity-40 [background-image:radial-gradient(1px_1px_at_20%_25%,#fff,transparent),radial-gradient(1.4px_1.4px_at_72%_18%,#f0dcae,transparent),radial-gradient(1px_1px_at_84%_70%,#fff,transparent),radial-gradient(1px_1px_at_36%_82%,#fff,transparent)]" />
      <div className="absolute inset-3 rounded-xl border border-[rgba(240,220,174,0.22)]" />
      <div className={`relative flex h-full flex-col justify-between ${compact ? "p-4" : "p-5 sm:p-6"}`}>
        <div className="flex items-center justify-between text-[9px] uppercase tracking-[0.28em] text-[#e9d7ad]/80">
          <span>Astralium</span>
          <span>Digital</span>
        </div>
        <div className="flex flex-1 items-center justify-center py-4">
          <span className={compact ? "text-3xl" : "text-5xl"}>{glyph}</span>
        </div>
        <div>
          <div className="mb-2 h-px w-10 bg-[#e9d7ad]/50" />
          <p className={`font-display leading-tight text-[#f7f0dd] ${compact ? "text-sm" : "text-lg"}`}>{title}</p>
          <p className="mt-1.5 text-[9px] uppercase tracking-[0.24em] text-[#d8c8a2]/70">Limited digital edition</p>
        </div>
      </div>
    </div>
  );
}

export function StarRating({ value, count }: { value: number; count?: number }) {
  const rounded = Math.round(value);
  return (
    <div className="flex items-center gap-1.5 text-xs text-[#d8c8a2]">
      <span className="tracking-[0.12em]" aria-hidden="true">
        {"★★★★★".slice(0, rounded)}
        <span className="text-white/20">{"★★★★★".slice(rounded)}</span>
      </span>
      <span className="text-[#9d99ad]">
        {value.toFixed(1)}
        {typeof count === "number" ? ` (${count})` : ""}
      </span>
    </div>
  );
}

export function PriceTag({
  usdCents,
  currency,
  locale,
  compareAtCents,
  large = false,
}: {
  usdCents: number;
  currency: string;
  locale: LocaleCode;
  compareAtCents?: number | null;
  large?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className={`tabular font-semibold text-[#f0dcae] ${large ? "text-3xl" : "text-base"}`}>
        {formatAmount(convertFromUsd(usdCents, currency), currency, locale)}
      </span>
      {compareAtCents && compareAtCents > usdCents ? (
        <span className="tabular text-xs text-[#8a869c] line-through">
          {formatAmount(convertFromUsd(compareAtCents, currency), currency, locale)}
        </span>
      ) : null}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        {eyebrow ? <p className="mb-2 text-[11px] uppercase tracking-[0.32em] text-[#d9b26a]">{eyebrow}</p> : null}
        <h2 className="font-display text-2xl text-[#f6f1e3] sm:text-3xl">{title}</h2>
        {description ? <p className="mt-3 text-sm leading-relaxed text-[#a8a4b8]">{description}</p> : null}
      </div>
      {action ? (
        <Link href={action.href} className="btn-ghost self-start whitespace-nowrap">
          {action.label}
          <span aria-hidden="true">←</span>
        </Link>
      ) : null}
    </div>
  );
}

export function ProductCard({
  product,
  locale,
  currency,
  labels,
}: {
  product: Product;
  locale: LocaleCode;
  currency: string;
  labels: { details: string; save: string; soldOut?: string };
}) {
  const rating = ratingOf(product);
  return (
    <article className="glass card-lift group relative flex flex-col rounded-2xl p-3">
      <Link href={`/product/${product.slug}`} className="block">
        <CoverArt
          title={locale === "ar" ? product.title : product.titleEn || product.title}
          coverStyle={product.coverStyle}
          glyph={product.coverGlyph}
          className="aspect-[4/3] w-full"
          compact
        />
      </Link>
      <div className="mt-3 flex flex-1 flex-col px-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-[0.22em] text-[#a99c83]">{categoryLabel(product.category, locale)}</span>
          <div className="flex items-center gap-1">
            {product.status !== "active" ? <span className="chip">مسودة</span> : null}
            <WishlistButton slug={product.slug} label={labels.save} compact />
          </div>
        </div>
        <h3 className="mt-1.5 line-clamp-2 text-sm font-semibold leading-snug text-[#f4efe3]">
          <Link href={`/product/${product.slug}`}>{locale === "ar" ? product.title : product.titleEn || product.title}</Link>
        </h3>
        {product.subtitle ? (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[#9d99ad]">
            {locale === "ar" ? product.subtitle : product.subtitleEn || product.subtitle}
          </p>
        ) : null}
        <div className="mt-2">{rating > 0 ? <StarRating value={rating} count={product.ratingCount} /> : null}</div>
        <div className="mt-auto flex items-center justify-between gap-2 pt-3">
          <PriceTag usdCents={product.priceCents} compareAtCents={product.compareAtCents} currency={currency} locale={locale} />
          <Link
            href={`/product/${product.slug}`}
            className="rounded-full border border-[rgba(217,178,106,0.28)] px-3 py-1.5 text-[11px] text-[#eeddb5] transition hover:bg-[rgba(217,178,106,0.12)]"
          >
            {labels.details}
          </Link>
        </div>
      </div>
    </article>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: { href: string; label: string } }) {
  return (
    <div className="glass flex flex-col items-center gap-3 rounded-2xl px-6 py-12 text-center">
      <span className="text-3xl" aria-hidden="true">
        ✦
      </span>
      <h3 className="font-display text-xl text-[#f4efe3]">{title}</h3>
      <p className="max-w-md text-sm leading-relaxed text-[#a8a4b8]">{description}</p>
      {action ? (
        <Link href={action.href} className="btn-gold mt-2">
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

export function Alert({ tone = "info", children }: { tone?: "info" | "success" | "error"; children: React.ReactNode }) {
  const styles =
    tone === "success"
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
      : tone === "error"
        ? "border-rose-400/30 bg-rose-400/10 text-rose-100"
        : "border-[rgba(217,178,106,0.3)] bg-[rgba(217,178,106,0.08)] text-[#f0dcae]";
  return <div className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${styles}`}>{children}</div>;
}
