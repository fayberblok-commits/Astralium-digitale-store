# Phase 5 — AI Employees — Report

**Status: COMPLETE.** Full gate green (lint 0/0 · typecheck 0 · **tests 338/338** · build OK · e2e **15/15** · i18n 669 keys × 40 locales, 0 unresolved · live verification **30/30 legs**). Nothing pushed, nothing deployed — per the owner's standing rule, publication waits for his approval.

---

## 0. Meta Model API verification (Step 0 — done BEFORE building)

**What could NOT be done:** Meta's official docs host, `dev.meta.ai`, is **blocked by this sandbox's fetch policy** — `browser.open` to dev.meta.ai failed with a policy denial in both research passes (start of phase and again at report time). The official pages themselves were therefore never rendered here. This is stated plainly: the contract below is corroborated, not first-party-rendered.

**What WAS verified, and from where** (all fetched/read in-session):

| Fact | Source |
|---|---|
| Base URL `https://api.meta.ai/v1`; auth = Bearer token from env `MODEL_API_KEY`; model id `muse-spark-1.3` (also `muse-spark-1.3-contributor`, `muse-spark-1.1`) | promptfoo provider docs (https://www.promptfoo.dev/docs/providers/meta/), LiteLLM provider docs, shipwithmuse developer guides citing Meta's docs, search-indexed summaries of dev.meta.ai |
| Three surfaces: `/v1/responses` (Meta's recommended default), `/v1/chat/completions` (OpenAI-compatible), `/v1/messages` (Anthropic-compatible) | promptfoo docs; shipwithmuse |
| `tool_choice` accepts **only `"auto"`** on the Meta API (anything else → HTTP 400); parallel tool calls on by default; `max_completion_tokens` is the canonical chat cap; `reasoning_effort` ∈ minimal/low/medium/high/xhigh; structured output via `response_format` json_schema (strict defaults false, recursive schemas rejected) | implementer docs corroborating Meta's API reference |
| Pricing (Standard): **$1.25/M input, $0.15/M cached, $4.25/M output**; Contributor: $0.10 / $0.002 / $0.20. Rate limits: 3,000 RPM / 4M TPM standard; 100 RPM / 3M TPM contributor | shipwithmuse pricing summary of Meta's pricing page; aicompare.ninja (sourcing dev.meta.ai, checked 2026-10-23) |
| Muse Spark emits a **non-standard SSE event** that trips strict OpenAI clients | shipwithmuse (documents community fixes); AvalAI provider notes |

**Design consequence (as the brief required):** the gateway implements the **Chat Completions contract** (the most widely corroborated surface) behind a provider interface with a **configurable base URL** (`AI_META_BASE_URL`), sends only `tool_choice: "auto"` and `max_completion_tokens`, and uses a **tolerant SSE parser** that skips unknown/non-JSON events. If Meta's live contract differs in detail, one adapter file (`src/lib/ai/openai-compatible.ts`) is the only place that changes. **No Meta API key exists in this project — nothing Meta-side is live-tested. That is a fact, not a caveat-in-passing: every live proof below uses the deterministic MOCK provider or a fake fetch.**

---

## 1. Architecture

One provider-independent gateway in `src/lib/ai/`, extending — not duplicating — the pre-existing grounded support engine (`src/services/ai-support.ts`, `ai-support-v2.ts`, `src/lib/support-tools.ts`, which are untouched):

| Module | Role |
|---|---|
| `types.ts` | Provider/message/tool-call/completion types; `AiProviderError`; `estimateCostUSD` with the published-rate table (unknown models priced at the standard rate, never free; the mock is deliberately priced at the standard rate so caps are exercisable offline) |
| `openai-compatible.ts` | One adapter serving Meta (primary) and any OpenAI-compatible fallback; injectable fetch (offline-testable); tolerant SSE parser |
| `mock.ts` | Deterministic scripted provider (tests/demos only, `AI_PROVIDER=mock`, env validator warns in production); includes deliberate misbehaviour cues used by the security suites |
| `config.ts` | Settings via the dual-mode config store: active provider, fallback on/off, models, caps, emergency stop; provider construction from **env keys only**; `getAiStatus()` never returns key material |
| `usage.ts` | Per-day ledger (cost/tokens/actions/conversations), cap evaluation (cap 0 = uncapped, owner-chosen) |
| `employees.ts` | Both rosters (names EN/AR, avatars, tones), owner-editable overrides for owner staff (enabled + instructions), deterministic keyword routers — the model never chooses its own privileges |
| `rag.ts` | Customer context from REAL sources only: DB-resolver catalog, policy FAQs, published blog posts; `dataBlock()` delimiters marking retrieved text as DATA; `detectInjection()` heuristics for logging/visibility |
| `tools.ts` | The typed tools layer (14 tools, zod inputs + JSON schemas, per-tool required permission) — see §3 |
| `actions.ts` | Preview → Apply/Approve → Undo engine with caps, emergency stop and a full audit trail |
| `conversations.ts` | Conversation log (customer + owner) for office quality review |
| `gateway.ts` | Owner-turn orchestration + primary→fallback failover completion |
| `customer.ts` | Customer-team engine — deterministic order verification first, tool-less grounded model call, HANDOFF escalation to a human ticket with the full transcript |

**Routes:** `POST /api/support/stream` + `/api/support/chat` branch to the customer team only when flag `ai_staff` is on AND a provider is configured AND the stop is off — otherwise the pre-existing engines answer byte-for-byte as before. Office: `GET/POST /api/admin/ai/config`, `POST /api/admin/ai/chat`, `GET/POST /api/admin/ai/actions`, `GET /api/admin/ai/conversations`. **UI:** a new settings-gated "AI Staff" section in the Manager's Office (`AiStaffPanel`), and ChatWidget gains the responding employee's name/avatar, conversation history, and a browser-TTS listen button (STT was already present from the earlier build). New flags `ai_staff` + `ai_owner_staff`, both default OFF; new rate limiters `aiChatIp` / `aiOwnerActor`; AI env group zod-validated; `.env.example` documents every new variable empty + commented. All 46 new UI strings are native en+ar i18n keys (EN fallback elsewhere, per the standing model).

## 2. Per-employee status

| Employee | Team | Tools | Status |
|---|---|---|---|
| Noura ✦ Greeter | Customer | none | ✅ Live via gateway; routing + grounded answers proven (live leg: greeter frame) |
| Sami 💎 Sales | Customer | none | ✅ RAG-grounded recommendations from the real catalog only |
| Layla 🛠️ Support | Customer | none | ✅ Policy-grounded; HANDOFF → ticket with transcript proven in tests |
| Omar 📦 Orders | Customer | none | ✅ Deterministic id+email / claim-code verification — zero model involvement in order facts |
| Mira 🎨 Designer | Owner | set_theme, set_banner, set_hero_text, set_home_sections, product_info | ✅ Preview→Apply→Undo proven live (palette round-trip on the real storefront) |
| Karim 📣 Marketer | Owner | create_coupon*, draft_blog_post, publish_blog_post*, product_info | ✅ Coupon approval gate proven live (Apply door refuses, 409; Approve publishes) |
| Dana 📊 Analyst | Owner | sales_summary, product_info | ✅ Read-only; live leg returns ledger figures inline |
| Yara 🌐 Translator | Owner | translate_product, product_info | ✅ Merge + undo proven in tests |
| Rami 🗂️ Product Manager | Owner | create_product_draft, update_product_price*, publish_product*, product_info | ✅ Drafts always inactive; price/publish approval-gated, proven in tests |
| Adam 🛡️ Security Monitor | Owner | security_summary | ✅ Read-only summary; cannot touch security settings (no such tool exists) |

\* = sensitive class: explicit owner Approve required.

## 3. The safety model (all test-proven)

- **Preview-first, always.** A model tool call can only create a preview (safe) or an approval request (sensitive). The store changes only at the owner's click in the office. The model is told in the tool result that nothing was applied.
- **The forbidden wall lives in the tool layer**, `tools.ts`: any unregistered name matching refund / bank / IBAN / secret / API key / password / credential / delete / remove / drop / purge / team / account / role / permission / flag / security / TOTP / session / payout / payment-key / Stripe / PayPal patterns is refused with `FORBIDDEN_TOOL` before any other check. A module-load self-check guarantees no registered tool trips the patterns (the one name collision, `security_summary`, is a registered read tool — the registry lookup wins by design, and a test proves it stays reachable).
- **Allow-lists + zod:** wrong-employee tool → `EMPLOYEE_NOT_ALLOWED`; bad/malformed args → `INVALID_INPUT`; unknown benign name → `UNKNOWN_TOOL`.
- **Undo:** snapshot tools (theme, banner, hero, sections, price, translation, coupon) restore exactly; irreversible-by-design tools (draft creation) say so in their preview.
- **Customer content is data, architecturally:** customer staff hold NO tools; customer text is only ever a user message or inside DATA blocks; owner-turn context never contains customer content — so text planted in a review/ticket/message has no channel to become a command. Injection attempts are logged (`ai_forbidden_attempt` security events — a kind added to the Phase 1 union) and conversations are flagged for review.
- **Audit:** every proposal/apply/approve/reject/undo writes an audit entry whose detail names the employee and states it acted on the owner's order; refusals of forbidden attempts are audited too. Apply/approve re-checks the *clicking* actor's per-tool permission server-side.
- **Budgets & stop:** daily cost cap + action cap checked before and during turns; emergency stop halts owner turns instantly and degrades the storefront to the grounded engine (proven live).

## 4. Bugs found & fixed along the way

1. **`src/lib/catalog.ts` (pre-existing, Phase 1/4):** in file mode, `listAdminProducts()` returned **un-edited seed products** — overlay edits (price, title, translations) were applied to the storefront list but not to the admin `all` list, so the office and any admin read model showed stale values while the storefront already showed the edit (DB mode unaffected). Found by the Phase 5 tools suite; fixed by applying the same overlay edits when building `all`, with a comment recording the find. This also makes the Phase 4 Products manager truthful in file mode.
2. **`tests/flags.test.mjs`:** hard-coded registry count 35 → updated to **37** for the two new flags (default-off posture assertions unchanged and passing).

## 5. Gate evidence (real outputs)

```
npm run lint        → 0 errors, 0 warnings
npm run typecheck   → clean
npm test            → 338 tests, 338 pass, 0 fail   (baseline 310 → +28 new)
npm run build       → exit 0 (Next build, 28 s)
npm run test:e2e    → E2E SMOKE: 15/15 checks passed
npm run check-i18n  → 669 keys · en 669/669 native · ar native · 0 unresolved across 40 locales
npm run scan:secrets→ 412 files; 0 hits in any Phase 5 file
                      (5 hits, all pre-existing fixture passwords inside
                       scripts/verify-phase1-security.mjs — a Phase 1 pentest
                       harness, unchanged by this phase)
node scripts/verify-phase5-ai.mjs → ALL 30 LEGS PASSED
```

New suites: `tests/phase11-ai-gateway.test.mjs` (10 — wire contract vs fake fetch incl. tolerant SSE, resolution honesty, cost math, caps, overrides, routing), `tests/phase11-ai-tools.test.mjs` (11 — preview/apply/undo flows, coupon gate, forbidden wall ×13 names, allow-list/zod codes, stop+cap, audit), `tests/phase11-ai-injection.test.mjs` (7 — EN+AR customer corpus → zero actions/changes; forced customer-path tool call dropped + logged; injection quoted into an owner turn refused; direct forbidden asks refused; disabled/stop/cap; happy paths; unconfigured honesty).

Live legs (production server, mock provider, file mode) include: customer stream with employee frame; injection → 0 actions + flagged conversation; theme preview → storefront unchanged → Apply → `data-palette="tropical-glow"` → Undo → restored; coupon Apply-door 409 → Approve → live in office coupons; sales summary inline; refund `FORBIDDEN_TOOL`; provider switch persists; emergency stop halts owner chat and degrades storefront (no employee frame); resume after release.

## 6. NOT live-tested — and why

- **Meta Model API itself: not live-tested. No `MODEL_API_KEY` exists** (the owner adds keys later, per his standing sequence). The adapter is proven against a fake fetch implementing the corroborated contract, and against the mock end-to-end.
- **Real provider failover** (Meta error → fallback): logic is unit-covered via provider resolution; a true two-provider failover needs two real keys.
- **Real refunds/disputes/Resend sends through AI flows:** AI staff can never refund (architectural); office manual flows unchanged from Phase 4.
- **DB-mode AI stores:** the AI settings/actions/conversations/usage stores use the same dual-mode config store whose DB mode Phase 4 verified live (43/43 legs); this phase's live run was file mode.
- **Physical touch devices / full screen-reader pass** for the new panel: not performed (panel reuses the office's established accessible patterns).

## 7. Remaining risks & notes

- **dev.meta.ai unverifiable from this sandbox** (policy block) — if Meta's live contract differs from the corroborated one, the single adapter file is the fix point; base URL and model are owner-editable without code.
- **Sensitive approvals use the office session's existing auth** (TOTP-hardened in Phase 1); adding a step-up re-auth specifically on Approve clicks is a reasonable future hardening, deliberately not invented in this phase.
- **Order-answer composer** in the customer engine reuses the pre-existing English templates from the verified lookup (figures/status are locale-independent data); full localization of that one deterministic composer is future work.
- **Rate/cost figures are estimates** from the published rate table; providers remain the source of truth for billing.
- The catalogue is still the starter/demo set (per the owner's earlier clarification) — AI staff recommend and edit exactly what the catalog contains, nothing more.

## 8. Files

New: `src/lib/ai/` (12 modules), `src/app/api/admin/ai/{config,chat,actions,conversations}/route.ts`, `src/components/admin/AiStaffPanel.tsx`, `tests/phase11-ai-{gateway,tools,injection}.test.mjs`, `scripts/verify-phase5-ai.mjs`.
Changed: `src/lib/flags.ts` (+2 flags), `src/lib/ratelimit.ts` (+2 limiters), `src/lib/env.ts` (AI zod group + summary), `src/lib/security-log.ts` (+`ai_forbidden_attempt` kind), `src/lib/catalog.ts` (file-mode `all` fix), `src/lib/ai/rag.ts` + `tools.ts` (`reviewsCount` field correction), support stream/chat routes (team branch + flag gate), `src/components/ChatWidget.tsx` (employee identity, history, TTS), office page (AI section), `src/i18n/dictionaries.ts` + `scripts/check-i18n.mjs` (+46 keys), `.env.example` (AI group), `README.md` (AI Staff section, env rows, flag list), `tests/flags.test.mjs` (count 37).

**Publication: NOT pushed, NOT deployed** — awaiting the owner's explicit approval, per his standing rule.
