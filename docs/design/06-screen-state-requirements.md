# Screen and component state requirements

## Purpose and authority

Define states every applicable screen and component must specify before implementation. Figma owns visual treatment and transition design; domain/flow documents own actual state and permission semantics.

## Component states

Every applicable component considers:

- default;
- hover, where pointer exists;
- focus and focus-visible;
- pressed/active;
- selected/current;
- disabled with reason or discoverable explanation where needed;
- loading and progress;
- error and validation error;
- success/confirmed;
- empty/no result;
- skeleton/placeholder where appropriate.

Also define read-only, unavailable by phase/country/channel, permission denied, stale/conflict, offline, rate-limited, pending approval, revoked, destructive confirmation, and partial/bulk outcome when relevant.

## Screen-level data lifecycle

Each screen specifies initial load, refresh, pagination/load-more, background refresh, optimistic behavior if safe, stale cache, partial dependency failure, no data, filtered no result, recoverable error, terminal error, session expiry, access/feature revocation, and navigation away/resume.

Optimistic UI is prohibited where it could misstate payment, entitlement, message acceptance, enforcement, verification, publication, role, deletion, payout, or other high-impact result. These screens show pending until authoritative confirmation.

## Forms and destructive actions

Forms define required/optional fields, format and semantic validation, character/content limits, async validation, unsaved changes, duplicate submit, idempotent retry, version conflict, disabled reason, server field/general error, success, and safe restoration. Errors preserve user input unless security/privacy requires removal.

Destructive/high-impact confirmation shows exact target, effect, reversibility, dependencies, approval/step-up status, and final owner-confirmed outcome. Generic color or wording cannot make ambiguous actions appear safe.

## Lists, tables, media, and async workflows

Lists/tables define zero data, zero filtered results, loading rows, pagination, stable sorting, selection across pages, partial bulk outcomes, inaccessible/deleted items, and privacy-safe not found. Studio/Admin tables retain scope and target during actions.

Media defines upload requested, transferring, paused/retrying, quarantined, processing, scan/review pending, rejected, published, restricted/removed, delivery denied, and expired link states. Async jobs define queued, running, retrying, awaiting user/approval, completed, failed, cancelled, and dead-letter/operational handling where exposed.

## Communication, commerce, and AI states

Messaging distinguishes accepted, persisted, delivery pending, delivered/read where supported, failed, and blocked/restricted. Notification delivery does not imply read. Calls distinguish invitation, ringing, accepted/declined/timed out, joining, active, reconnecting, ended, and abuse/safety termination.

Commerce distinguishes created, provider pending, entitlement delivery pending, finalized, failed, cancelled, refunded, disputed/chargeback, reconciliation pending, held/reversed, and payout states. AI distinguishes denied, admitted, generating, validating, awaiting tool authorization/approval, tool running, completed, refused, failed, cancelled, and budget exhausted; AI output is labeled and never shown as owner-confirmed effect until confirmed.

## Accessibility, analytics, and privacy

Every transition specifies accessible announcement/focus behavior and non-color cues. Analytics events use authoritative state names and minimized data; rendering state does not create product truth. Error messages do not reveal another user's status, internal enforcement reason, secret, or object existence.

## Handoff and cross-references

Figma handoff maps screens/components to applicable states and marks intentionally impossible states with product/domain rationale. Missing required state blocks implementation readiness.

See [Figma authority](03-figma-source-of-truth.md), [accessibility/motion](05-accessibility-motion.md), [API errors](../engineering/01-api-contracts.md), and authoritative [flows](../DOCS_INDEX.md#flow-security-and-lifecycle-authority).
