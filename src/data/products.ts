/**
 * Catalog data layer.
 *
 * This is the single source of truth for the storefront. It is a typed,
 * in-repo module on purpose (see README "Architecture"): the store renders
 * and sells with zero external infrastructure. A Postgres/S3-backed adapter
 * can later implement the same interfaces without touching pages.
 */

export type CategoryId =
  | "ebooks"
  | "audiobooks"
  | "templates"
  | "courses"
  | "music"
  | "software"
  | "design";

export interface ProductFormat {
  format: string; // e.g. "PDF", "MP3", "ZIP"
  sizeMB: number;
}

export interface Product {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  category: CategoryId;
  formats: ProductFormat[];
  priceUSD: number;
  compareAtUSD?: number;
  rating: number; // 0..5
  reviewsCount: number;
  badge?: "bestseller" | "new";
  includes: string[];
  preview: string;
  /** hue (0-360) used by the CSS-generated cover art */
  hue: number;
  publishedAt: string; // ISO date — drives "new releases" sort
  /** Primary language of the product content (ISO code). Default "en". */
  language?: string;
  // Manager's Office fields (Phase 4 upgrade) — populated from the DB /
  // overlay by lib/catalog.ts; absent on the static seed products.
  /** Unit cost in USD — profit accounting in the office. Default 0. */
  costUSD?: number;
  /** Scheduled publishing: ISO instant; the storefront hides the product until then. */
  publishAt?: string | null;
  /** Per-currency price overrides, e.g. { EUR: 21.5 } — amounts IN that currency. */
  priceOverrides?: Record<string, number>;
  /** Per-locale editorial translations, applied by the catalog resolver. */
  translations?: Record<string, { title?: string; subtitle?: string; description?: string }>;
}

/** The product's content language, defaulting to English. */
export function productLanguage(p: Product): string {
  return p.language ?? "en";
}

export interface Bundle {
  id: string;
  slug: string;
  title: string;
  description: string;
  productIds: string[];
  priceUSD: number;
  hue: number;
  badge?: "bestseller" | "new";
}

export const CATEGORIES: { id: CategoryId; icon: string }[] = [
  { id: "ebooks", icon: "📖" },
  { id: "audiobooks", icon: "🎧" },
  { id: "courses", icon: "🎓" },
  { id: "templates", icon: "🧩" },
  { id: "design", icon: "🎨" },
  { id: "software", icon: "💠" },
  { id: "music", icon: "🎵" },
];

export const PRODUCTS: Product[] = [
  {
    id: "p01",
    slug: "ai-profit-blueprint",
    title: "The AI Profit Blueprint",
    subtitle: "10 AI services you can sell this week",
    description:
      "A field-tested playbook for turning modern AI tools into sellable services: positioning, pricing, outreach scripts, delivery checklists and the exact prompts used to fulfil each service. Written for freelancers and small agencies who want revenue, not theory.",
    category: "ebooks",
    formats: [
      { format: "PDF", sizeMB: 14 },
      { format: "EPUB", sizeMB: 6 },
    ],
    priceUSD: 19,
    compareAtUSD: 49,
    rating: 4.8,
    reviewsCount: 214,
    badge: "bestseller",
    includes: ["142-page PDF + EPUB", "10 ready-to-sell service offers", "Outreach & DM scripts", "Pricing calculator sheet", "Lifetime updates"],
    preview:
      "Chapter 1 — The services market is not 'AI tools', it is outcomes. Clients pay for a finished landing page, a week of content, a support inbox that answers itself. This book shows you how to package ten of those outcomes…",
    hue: 222,
    publishedAt: "2026-08-14",
  },
  {
    id: "p02",
    slug: "deep-focus-masterclass",
    title: "Deep Focus: The Productivity Masterclass",
    subtitle: "6.5 hours of video + workbook",
    description:
      "A complete video course on designing your day for deep work: attention audits, environment design, shutdown rituals and a 30-day implementation plan, taught with real before/after schedules.",
    category: "courses",
    formats: [
      { format: "MP4 (1080p)", sizeMB: 2400 },
      { format: "PDF workbook", sizeMB: 9 },
    ],
    priceUSD: 79,
    compareAtUSD: 149,
    rating: 4.9,
    reviewsCount: 386,
    badge: "bestseller",
    includes: ["42 video lessons (6.5 h)", "Deep-work planner workbook", "30-day challenge plan", "Private community access", "Certificate of completion"],
    preview:
      "Lesson 1 opens with a simple test: open your calendar from last week and count the blocks longer than 90 minutes. Most knowledge workers find zero. By lesson 6 you will have three per week…",
    hue: 262,
    publishedAt: "2026-07-02",
  },
  {
    id: "p03",
    slug: "midnight-lofi-collection",
    title: "Midnight Lo-Fi Collection Vol. 1",
    subtitle: "24 royalty-free tracks",
    description:
      "Twenty-four warm, dusty lo-fi instrumentals mastered for focus sessions, study streams and late-night work. Full commercial license for creators included — use them in videos, podcasts and apps.",
    category: "music",
    formats: [
      { format: "MP3 (320 kbps)", sizeMB: 210 },
      { format: "WAV", sizeMB: 980 },
      { format: "License PDF", sizeMB: 1 },
    ],
    priceUSD: 12,
    compareAtUSD: 24,
    rating: 4.7,
    reviewsCount: 158,
    includes: ["24 tracks (MP3 + WAV)", "Full commercial license", "Stems for 6 flagship tracks", "Loop-ready edits"],
    preview:
      "Track 1 'Cassette Rain' — vinyl crackle, a Rhodes line in D minor and rain recorded through an open window in Lisbon. Preview the first 30 seconds on this page before you buy.",
    hue: 288,
    publishedAt: "2026-05-19",
  },
  {
    id: "p04",
    slug: "the-silent-ocean-audiobook",
    title: "The Silent Ocean — Audiobook",
    subtitle: "A novel, narrated in studio quality",
    description:
      "An award-nominated literary thriller set aboard a research vessel that stops answering radio calls. Eleven hours of studio narration with a full cast of two narrators and an original score.",
    category: "audiobooks",
    formats: [
      { format: "MP3", sizeMB: 640 },
      { format: "M4B (chaptered)", sizeMB: 590 },
    ],
    priceUSD: 24,
    compareAtUSD: 39,
    rating: 4.8,
    reviewsCount: 201,
    badge: "new",
    includes: ["11 h 04 min narration", "Chaptered M4B + MP3", "Printable chapter map", "Author afterword (bonus chapter)"],
    preview:
      "Chapter One. The last transmission from the RV Calypso was forty-one seconds long, and thirty of those seconds were silence. Then a voice — Dr. Maren Ilves, chief scientist — said: 'Tell them the ocean answered.'",
    hue: 199,
    publishedAt: "2026-10-01",
  },
  {
    id: "p05",
    slug: "notion-creator-templates",
    title: "Notion Ultimate Creator Templates",
    subtitle: "18 systems for content creators",
    description:
      "Eighteen production-grade Notion systems: content pipelines, sponsorship CRM, finance tracker, launch planner and more. Duplicate them into your workspace in one click and follow the video setup guides.",
    category: "templates",
    formats: [
      { format: "Notion link pack (PDF)", sizeMB: 3 },
      { format: "MP4 guides", sizeMB: 480 },
    ],
    priceUSD: 29,
    compareAtUSD: 59,
    rating: 4.9,
    reviewsCount: 512,
    badge: "bestseller",
    includes: ["18 Notion templates", "Video setup guides", "Icon + cover pack", "Free updates for 1 year"],
    preview:
      "Template 1 — The Content Pipeline: ideas enter from a capture inbox, get scored on effort/impact, and flow into filming, editing and publishing boards with automatic due dates…",
    hue: 160,
    publishedAt: "2026-06-11",
  },
  {
    id: "p06",
    slug: "astral-ui-kit-pro",
    title: "Astral UI Kit Pro",
    subtitle: "240 components for Figma + code",
    description:
      "A luxury-grade UI kit with 240 components in dark and light themes: commerce, dashboards, marketing and mobile patterns, with design tokens, auto-layout throughout, and matching CSS variables for developers.",
    category: "design",
    formats: [
      { format: "FIG", sizeMB: 86 },
      { format: "CSS tokens (ZIP)", sizeMB: 2 },
    ],
    priceUSD: 49,
    compareAtUSD: 99,
    rating: 4.8,
    reviewsCount: 97,
    badge: "new",
    includes: ["240 Figma components", "Dark + light themes", "Design tokens (CSS/JSON)", "Icon set (320 glyphs)", "Commercial license"],
    preview:
      "Open the 'Commerce' page in the preview file: product cards, a glass checkout sheet and a gold-gradient primary action system you can re-skin in one variable change.",
    hue: 43,
    publishedAt: "2026-10-12",
  },
  {
    id: "p07",
    slug: "promptforge-studio",
    title: "PromptForge Studio",
    subtitle: "Desktop prompt manager for power users",
    description:
      "A fast desktop app (Windows, macOS, Linux) to organise, version and test prompts across providers, with variables, folders, run history and one-click copy into any tool. No subscription — buy once.",
    category: "software",
    formats: [
      { format: "Windows (EXE)", sizeMB: 74 },
      { format: "macOS (DMG)", sizeMB: 79 },
      { format: "Linux (AppImage)", sizeMB: 76 },
    ],
    priceUSD: 59,
    compareAtUSD: 119,
    rating: 4.7,
    reviewsCount: 143,
    includes: ["All 3 desktop platforms", "Lifetime v1 updates", "500 starter prompt library", "License for 3 devices"],
    preview:
      "Create a prompt once with {{variables}}, test it against two models side by side, and keep the winning version — PromptForge keeps every run, cost and result searchable.",
    hue: 190,
    publishedAt: "2026-04-08",
  },
  {
    id: "p08",
    slug: "french-for-travelers",
    title: "French for Travelers — Audio Course",
    subtitle: "Speak from day one, 8 hours of audio",
    description:
      "A practical audio course built around the 40 conversations travellers actually have: cafés, trains, hotels, markets and emergencies. Native speakers, slow + natural speed for every dialogue.",
    category: "courses",
    formats: [
      { format: "MP3", sizeMB: 430 },
      { format: "PDF phrasebook", sizeMB: 5 },
    ],
    priceUSD: 39,
    compareAtUSD: 79,
    rating: 4.6,
    reviewsCount: 88,
    includes: ["96 audio lessons (8 h)", "Printable phrasebook", "Pronunciation drills", "Offline-friendly files"],
    preview:
      "Lesson 1 — At the café. You will learn to order, ask for the bill and handle the three follow-up questions baristas actually ask, at slow speed first, then at street speed.",
    hue: 350,
    publishedAt: "2026-03-15",
    language: "fr",
  },
  {
    id: "p09",
    slug: "digital-marketing-playbook-2026",
    title: "Digital Marketing Playbook 2026",
    subtitle: "Channels, funnels and numbers that matter",
    description:
      "A 210-page operator's manual for 2026 marketing: paid social economics, SEO after AI answers, email systems, landing-page teardowns and a full metrics glossary with benchmarks by industry.",
    category: "ebooks",
    formats: [
      { format: "PDF", sizeMB: 22 },
      { format: "EPUB", sizeMB: 8 },
    ],
    priceUSD: 27,
    compareAtUSD: 54,
    rating: 4.7,
    reviewsCount: 264,
    includes: ["210-page PDF + EPUB", "12 funnel teardown case studies", "Benchmark tables (2026)", "Swipe file of 60 ads"],
    preview:
      "Chapter 3 — Your funnel is leaking at the second click, not the first. We analysed 40 stores and the pattern is embarrassingly consistent; here is the audit we run, step by step…",
    hue: 24,
    publishedAt: "2026-08-28",
  },
  {
    id: "p10",
    slug: "piano-dreams-album",
    title: "Piano Dreams — Solo Piano Album",
    subtitle: "12 original compositions + sheet music",
    description:
      "Twelve intimate solo-piano compositions recorded on a 1962 Steinway, plus the complete sheet music so you can play them yourself. Includes personal and commercial listening licenses.",
    category: "music",
    formats: [
      { format: "FLAC", sizeMB: 310 },
      { format: "MP3 (320 kbps)", sizeMB: 96 },
      { format: "Sheet music PDF", sizeMB: 12 },
    ],
    priceUSD: 9,
    compareAtUSD: 18,
    rating: 4.9,
    reviewsCount: 176,
    includes: ["12 tracks (FLAC + MP3)", "Complete sheet music", "Composer notes per track"],
    preview:
      "'Nocturne in Blue' was written in one sitting after a night train to Vienna. The left hand never hurries; the melody arrives like something remembered rather than played.",
    hue: 230,
    publishedAt: "2026-02-20",
  },
  {
    id: "p11",
    slug: "brand-identity-mega-pack",
    title: "Brand Identity Mega Pack",
    subtitle: "60 logo suites, fonts & guidelines",
    description:
      "Sixty complete, editable logo suites with paired fonts, colour palettes and mini brand-guideline documents — built for founders and designers who need a credible identity this week, not this quarter.",
    category: "design",
    formats: [
      { format: "AI + EPS (ZIP)", sizeMB: 240 },
      { format: "Figma", sizeMB: 64 },
      { format: "Font files", sizeMB: 18 },
    ],
    priceUSD: 69,
    compareAtUSD: 139,
    rating: 4.8,
    reviewsCount: 229,
    badge: "bestseller",
    includes: ["60 logo suites", "12 licensed display fonts", "Palette + guideline docs", "Extended commercial license"],
    preview:
      "Suite 07 'Meridian' — a geometric wordmark with a champagne gradient foil variant, shown across storefront, app icon and packaging mockups in the preview gallery.",
    hue: 36,
    publishedAt: "2026-05-30",
  },
  {
    id: "p12",
    slug: "data-analysis-with-python",
    title: "Data Analysis with Python — Full Course",
    subtitle: "14 hours, real datasets, portfolio projects",
    description:
      "From spreadsheets to confident analysis: pandas, visualisation, statistics that matter and four portfolio projects on real public datasets. Includes all notebooks, solutions and a career guide.",
    category: "courses",
    formats: [
      { format: "MP4 (1080p)", sizeMB: 5200 },
      { format: "Notebooks (ZIP)", sizeMB: 140 },
    ],
    priceUSD: 89,
    compareAtUSD: 179,
    rating: 4.9,
    reviewsCount: 341,
    badge: "new",
    includes: ["118 lessons (14 h)", "4 portfolio projects", "All notebooks + solutions", "Certificate of completion"],
    preview:
      "Project 1: you receive a messy 2-million-row retail dataset and one question — why did March underperform? Watch the full first section free in the preview player.",
    hue: 142,
    publishedAt: "2026-10-20",
  },
];

export const BUNDLES: Bundle[] = [
  {
    id: "b01",
    slug: "creator-bundle",
    title: "The Creator Bundle",
    description: "Everything a content creator needs: Notion systems, the Astral UI kit and a full brand identity pack.",
    productIds: ["p05", "p06", "p11"],
    priceUSD: 99,
    hue: 275,
    badge: "bestseller",
  },
  {
    id: "b02",
    slug: "business-growth-bundle",
    title: "Business Growth Bundle",
    description: "Sell AI services, market them properly and stay focused while you scale: blueprint + playbook + masterclass.",
    productIds: ["p01", "p09", "p02"],
    priceUSD: 89,
    hue: 210,
  },
  {
    id: "b03",
    slug: "calm-evenings-bundle",
    title: "Calm Evenings Bundle",
    description: "An audiobook, a lo-fi collection and a piano album — an evening of quiet, beautifully made.",
    productIds: ["p04", "p03", "p10"],
    priceUSD: 34,
    hue: 320,
    badge: "new",
  },
];

export interface Testimonial {
  name: string;
  country: string;
  quote: string;
  productSlug: string;
  rating: number;
}

export const TESTIMONIALS: Testimonial[] = [
  { name: "Lena K.", country: "Germany", quote: "Checkout took under a minute and the files were in my inbox before my coffee cooled. The Blueprint paid for itself with my first client.", productSlug: "ai-profit-blueprint", rating: 5 },
  { name: "Omar S.", country: "UAE", quote: "Finally a digital store that prices fairly in my region and just works. The Notion templates saved me a full week of setup.", productSlug: "notion-creator-templates", rating: 5 },
  { name: "Yuki T.", country: "Japan", quote: "The audiobook quality is superb and re-downloading from my account a month later took ten seconds. This is how digital should feel.", productSlug: "the-silent-ocean-audiobook", rating: 5 },
  { name: "María G.", country: "Spain", quote: "I bought the Python course on my phone at midnight and started lesson one immediately. Clear, honest, beautifully produced.", productSlug: "data-analysis-with-python", rating: 5 },
];

export const FAQS: { q: string; a: string }[] = [
  { q: "How do I receive my products?", a: "Instantly. The moment payment is confirmed you get download buttons on the success page and a signed download link by email. Links are personal, time-limited and can be re-issued any time from your account page." },
  { q: "What payment methods do you accept?", a: "Cards, Apple Pay, Google Pay, Link and local methods via Stripe, plus PayPal where available. The fastest methods for your country and device are shown first at checkout." },
  { q: "What is your refund policy?", a: "14-day money-back guarantee on every product, no questions asked. One click from your account or a single email to support — refunds also revoke download access." },
  { q: "Can I re-download later?", a: "Yes. Your account keeps a permanent re-download centre for everything you bought (unless a product page states otherwise). Download links are re-issued securely on request." },
  { q: "Do prices include taxes?", a: "Prices are shown in your currency. Applicable VAT/GST/sales tax for digital goods is calculated and shown clearly before you pay — never as a surprise afterwards." },
  { q: "Can I use products commercially?", a: "Many products include a commercial license (music, templates, design assets). Each product page lists exactly what its license allows; see the License page for the full terms." },
];

/* ── Adapter-shaped accessors (swap for DB queries later) ─────────────── */
export function getProductBySlug(slug: string): Product | undefined {
  return PRODUCTS.find((p) => p.slug === slug);
}
export function getProductById(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}
export function getBundleBySlug(slug: string): Bundle | undefined {
  return BUNDLES.find((b) => b.slug === slug);
}
export function getBundleById(id: string): Bundle | undefined {
  return BUNDLES.find((b) => b.id === id);
}
export function bundleProducts(bundle: Bundle): Product[] {
  return bundle.productIds
    .map((id) => getProductById(id))
    .filter((p): p is Product => Boolean(p));
}
export function bundleSavings(bundle: Bundle): number {
  const sum = bundleProducts(bundle).reduce((s, p) => s + p.priceUSD, 0);
  return Math.max(0, Math.round((sum - bundle.priceUSD) * 100) / 100);
}
export function relatedProducts(product: Product, count = 3): Product[] {
  return PRODUCTS.filter((p) => p.category === product.category && p.id !== product.id)
    .concat(PRODUCTS.filter((p) => p.category !== product.category && p.id !== product.id))
    .slice(0, count);
}
