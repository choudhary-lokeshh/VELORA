# REALTIME domain

## Purpose and scope

REALTIME owns presence policy/projections, live room/session orchestration, scoped RTC credential lifecycle, and call state. It does not own messages, social relationship truth, recordings, payment entitlement, or vendor-specific state as source truth.

## Flow and state

For authorized participants, create invitation/session `invited -> declined/timed_out` or `authorized -> joining -> active -> reconnecting/ending -> ended/failed`. Explicit accept and current participant/block/enforcement checks precede credentials. Issue least-privilege, short-lived provider credential only after revalidation. Presence is advisory and expires automatically. Disconnect/reconnect timeout transitions safely to ending/ended; provider webhook is reconciled idempotently.

## Safety, failures, data

Block/enforcement revokes future join and attempts provider removal; clients cannot bypass by retaining old credential beyond narrow TTL. No recording, transcription, or call content retention is assumed; any future feature requires explicit product, consent, retention, legal and provider decision. Do not expose network addresses unnecessarily. Rate-limit session creation; prevent room enumeration.

## Permissions/phase/open questions

Participants may manage only own session state; moderators/admin act through audited safety controls. Store minimal lifecycle/quality metadata, not media. Phase 2. `DECISION REQUIRED`: RTC provider, call eligibility, consent UX, emergency/safety controls, recording posture, retention. See [RTC lifecycle](../flows/rtc-lifecycle.md), [provider adapters](../architecture/06-provider-adapters.md).
