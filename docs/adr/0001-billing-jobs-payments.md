# ADR 0001 — Billing that runs itself: scheduled runs, dunning as data, payments and reconciliation, demo mode

Date: 2026-09-09 · Status: accepted · Step 7 · Extends ARCHITECTURE §1.2 `billing`, §3 billing entities, D17, D20.

## Context

Step 2 gave the `billing` module gapless EUR invoices per contract and period, manual "mark as paid", an overdue roll and a dashboard widget. Everything after issue is manual: nobody generates the month, nobody chases a late building, a bank transfer is typed in by hand, and there is no document that tells a building what it owes. Step 8 (repair jobs and quotes) will need invoices created from a job and corrections (credit notes). The founder wants to explore the product with a year of believable data on the VPS without touching a real firm's records.

Constraints kept: money in integer cents, EUR; invoices are immutable after issue (D17: corrections are new documents); one owning module per table; side effects through events; every mutation tenant-scoped; operational vocabulary only in the UI.

## Decision

### 1. Entities and fields

| Table (owner) | Change |
| --- | --- |
| `invoice` (billing) | `+paymentReference` (immutable, `AE-<last 4 of EIK>-<6-digit number>`, unique per tenant, printed on every document), `+dunningStage` (0 = none, else the `position` of the last stage reached), `+dunningStageKey`, `+dunningAt`, `+lateFeeCents` (sum of adjustments, denormalised), `+creditedCents` (sum of credit notes), `+sourceType/sourceId` (`contract` today, `job` in step 8). `status` gains `partially_paid`. |
| `payment` (billing) | `+reference` (what the payer wrote), `+source` (`manual` \| `bank_import` \| `provider`), `+provider`, `+providerRef`, `+counterparty`, `+bankImportRowId`. |
| `credit_note` (billing, new) | id, tenantId, invoiceId, number (own gapless `credit_note_sequence`), issuedAt, amountCents, vatCents, totalCents, reason, createdByUserId. Reduces the open balance; the invoice row stays as issued. |
| `invoice_adjustment` (billing, new) | Late fees: id, tenantId, invoiceId, kind (`late_fee`), amountCents, reason, stageKey, createdAt. Increases the open balance without editing the invoice. |
| `dunning_stage` (billing, new) | System rows (`tenantId NULL`) and tenant rows: key, position, offsetDays (after due), channel (`email` \| `viber_link` \| `in_app`), templateKey, lateFeeRuleKey?, active. A tenant with at least one row uses its own list, else the system list. |
| `late_fee_rule` (billing, new) | key, kind (`flat` \| `percent`), amountCents, percentBp (basis points), graceDays, capCents?, enabled (default **false**); system + tenant rows like stages. |
| `bank_import`, `bank_import_row` (billing, new) | One import = filename, the column mapping used, status (`preview` \| `committed`), counts. Rows: bookedAt, amountCents, counterparty, description, extracted reference, `matchKind` (`reference` \| `amount_name` \| `manual` \| `none`), invoiceId?, buildingId?, paymentId?, status (`proposed` \| `matched` \| `unallocated` \| `ignored` \| `booked`). |
| `payment_link` (billing, new) | token, invoiceId, provider, url, amountCents, status (`open` \| `paid` \| `expired`), paidAt. Backs the hosted-page adapters. |
| `contract.billing` JSONB (registry) | `{cycle: monthly \| quarterly \| yearly, anchorDay?, exempt}`; registry owns the column and exposes it on `ContractDto`; billing only reads it. |
| `tenant.settings.billing` (tenancy) | `runDay` (1–28, default 1), `runEnabled` (true), `dueDays` (14; `invoiceDueDays` stays as the fallback), `bank {beneficiary, iban, bic, bankName}` (IBAN mod-97 checked), `paymentProvider` (`none` \| `demo` \| `iris` \| `stripe`), `bankCsvMapping` (last used mapping), `showPaymentOnPublicPage` (**false since step 8** — arrears are not for whoever scans the cabin QR; a firm opts in). |
| `tenant.features.demoMode` (tenancy) | New flag, off by default. |

### 2. State machines

Tables below are the specification; the office UI renders states, filters and stages from `GET /billing/config` (system defaults merged with the tenant's rows), never from a hard-coded list.

**Invoice**

| From | To | Trigger | Who | Side effects / events |
| --- | --- | --- | --- | --- |
| — | `issued` | billing run (cron) or "run now for month X" | system, owner, office | number + reference taken in one transaction; `InvoiceIssued` |
| `issued` / `partially_paid` | `overdue` | daily roll when `dueAt < today` and open > 0 | system | `InvoiceOverdue` (once per invoice) |
| `issued` | `partially_paid` (an `overdue` invoice stays `overdue`) | payment < open | owner, office, bank import, provider | `payment` row, `PaymentRecorded`; `PaymentMatched` when it came from an import or a provider |
| any open | `paid` | payment ≥ open, or a credit note that closes the balance | same | remainder above the balance becomes an unallocated `payment` for the building; `PaymentRecorded {settled:true}` |
| any open | same state, balance changes | credit note / late fee | owner, office (credit note); system (late fee via a stage) | `credit_note` / `invoice_adjustment` row; `CreditNoteIssued` |
| `issued` / `overdue` | `void` | owner, with reason, only while nothing is paid | owner | a credit note for the full amount is the normal correction; void is for an invoice issued by mistake |

`open = total + lateFee − credited − paid`. Dunning stops at `paid` / `void`.

**Dunning (per invoice, data-driven)**

| Condition | Action | Who | Events |
| --- | --- | --- | --- |
| open > 0, `today ≥ dueAt + stage.offsetDays`, `invoice.dunningStage < stage.position` | set `dunningStage/Key/At`; if `stage.lateFeeRuleKey` names an enabled rule, `today ≥ dueAt + rule.graceDays` and no adjustment exists for this stage: add the fee (capped) | `billing.dunning` daily | `DunningStageReached {stageKey, channel, templateKey, offsetDays, lateFeeCents}` |
| invoice paid / void | nothing (the job only sees open invoices) | — | — |

The stage's `channel` and `templateKey` travel in the event; the notifications subscriber uses them instead of the fixed template key of the rule matrix, so a tenant can add a fourth stage or move the Viber step without code.

**Bank import row**: `proposed` (auto-match found) or `unallocated` (none) → `matched` (person picks an invoice or a building) → on commit `booked` (a `payment` row with `source=bank_import`); rows still unallocated stay in the import and can be matched later; `ignored` never becomes a payment.

**Payment link**: `open` → `paid` (adapter webhook or the demo page; payment `source=provider`) or `expired` after 30 days.

### 3. `PaymentProvider` port

```ts
interface PaymentProvider {
  readonly name: 'none' | 'demo' | 'iris' | 'stripe'
  capabilities(): { enabled: boolean; hostedPage: boolean; webhooks: boolean; note?: string }
  createPaymentLink(input: PaymentLinkInput): Promise<{ url: string; provider: string }>
  handleWebhook(req: WebhookRequest): Promise<PaymentEvent | null> // {kind, token | providerRef, amountCents, at}
}
```

Adapters live in `platform/adapters/payments/`. `none` answers `enabled:false`; documents show bank details + EPC QR only. `demo` serves `/pay/demo/:token` (a card form) and records `source=provider, provider=demo` — only for tenants with `features.demoMode`; otherwise the route is 404. `iris` and `stripe` are wired (config keys `IRIS_*`, `STRIPE_*`, webhook route `/webhooks/payments/:provider`) but answer `enabled:false` with a TODO until an integration is contracted. Which adapter a tenant uses is `settings.billing.paymentProvider`.

### 4. Reconciliation rules

1. Reference: a row whose description or reference contains `AE-xxxx-nnnnnn` (case-insensitive, separators tolerated) matches that invoice while it is open.
2. Amount + name: the exact open amount and a counterparty that contains the customer's name (normalised: case, quotes, legal-form suffixes) with exactly one candidate.
3. Everything else waits for a person. Partial and over-payments are accepted on commit (the remainder is unallocated for the building).

### 5. Jobs

| Job | Cron (Sofia) | Idempotency |
| --- | --- | --- |
| `billing.run` | `0 6 * * *`; acts when `today.day ≥ runDay` (clamped to month length) and the month is not generated yet, so a missed run catches up | `generate(period)` skips existing (contract, periodStart); numbering in one transaction |
| `billing.dunning` | `30 6 * * *` | stage position on the invoice; one adjustment per (invoice, stage) |
| `tenancy.demoReset` | `0 4 * * *`, tenants with `demoMode` only | deletes operational data (never registry, users, settings), regenerates, audit `tenant.demoReset` |

### 6. Demo mode

A tenant feature. It allows the `demo` payment adapter, shows a "ДЕМО" banner in both apps and opts the tenant into the nightly reset. `POST /admin/tenants/:id/demo-data` runs the generator (`apps/api/src/demo/`, the composition-root level next to `jobs.ts`): registry sample data only when the tenant is empty, then a year of visits (checklist snapshots, placeholder photos), callbacks, defects, inspections, invoices per month with a paid/partial/overdue mix, payments with bank-style references, dunning history and notifications. `SEED_DEMO` calls the same generator, so there is one source of truth.

### 7. Migration and backfill

One migration adds the columns, enum values and tables. Backfill: `paymentReference` for existing invoices from the tenant's EIK and number (immutable afterwards); `dunningStage = 0`; `billing.dueDays` absent → the code falls back to `invoiceDueDays`; system rows for stages (+3 reminder, +14 second reminder, +30 final notice) and one disabled late-fee rule are written by the seed (`ensureSystemBillingDefaults`, idempotent by key). No data is deleted or rewritten.

## Consequences

- Invoices remain append-only: every correction is a row of its own with a number or a stage key, and the statement is a pure fold over invoices, adjustments, credit notes and payments.
- The dunning schedule, channels, templates and fees are rows; the state machine and stage list reach the UI as data, so a tenant can be changed without a deploy.
- Step 8 gets `createInvoice({sourceType:'job', lines})` and `issueCreditNote()` as the two entry points it needs; nothing in step 8 should touch numbering or payments directly. *(Done in step 8 as `billing.issueInvoice`; `invoice.contractId` became nullable — migration `20260910000000`; the jobs module reaches it only through its `InvoiceIssuer` port, see `HANDOFF-STEP8.md`.)*

## Deferred (deliberately)

Real IRIS/Stripe integrations; MT940/camt.053 imports (CSV only); automatic e-mailing of the invoice document (documents stay HTML print pages); SEPA direct debit; multi-currency; VAT-regime edge cases (reverse charge); accounting export (Microinvest/Ajur) — the CSV datasets already carry the numbers; refunds of provider payments; per-contact opt-out from dunning e-mails.
