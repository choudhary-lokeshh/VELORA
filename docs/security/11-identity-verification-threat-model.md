# Identity verification threat model

## Scope and trust boundaries

This model covers VELORA's provider-neutral Identity Assurance core, hosted-provider handoff, callback receipt, evidence lifecycle, owner contracts, workers, reconciliation, and read-only Admin operations. Provider SDKs, dashboards, hosted pages, callbacks, retrieved results, redirects, users, operators, networks, and queues are untrusted inputs. PostgreSQL is durable truth; Redis/BullMQ is execution infrastructure only.

The domain intentionally stores no raw identity documents, exact birth dates, names, addresses, selfies, videos, biometric templates, tax IDs, bank data, callback bodies, or reusable hosted URLs.

## Threats and required controls

| Threat | Required control | Verification evidence |
|---|---|---|
| Cross-subject/Creator IDOR | Acting owner and opaque subject resolved server-side; exact-reference predicate includes owner and audience; absent and unauthorized responses indistinguishable | Cross-subject, cross-Creator, cross-audience tests |
| Client weakens assurance or chooses provider | Provider, workflow, policy, jurisdiction requirements, and threshold selected at composition/policy boundary; fields absent from public schemas | Contract/schema and hostile-input tests |
| Duplicate start creates duplicate external work | Caller key plus canonical digest, transaction lock, platform provider key, adapter lookup before retry | 50-way start and changed-input tests |
| Callback forgery or body mutation | Strict raw-body verification before parsing; provider/account/environment binding; constant-time secret comparison where applicable | Bad signature/body/account/environment tests |
| Callback replay, reorder, or duplicate | Unique event identity, freshness rule where provider supports it, append-only lifecycle precedence, stale supersession refusal | 50-way duplicate, reorder, stale-success tests |
| Callback payload exfiltration | Persist digest and normalized allow-list only; body discarded after verification; no body in logs/traces/dead letter | Column-list and log-redaction tests |
| Oversized/decompression/parser abuse | Byte limit before parse, bounded JSON depth/shape, no remote media fetch, fast `413` | Oversize and malformed payload tests |
| Redirect completion spoof | Redirect return is read-only; callback/retrieval produces evidence | Stale/forged return tests |
| Hosted-link theft or leakage | Short-lived one-subject links, return once, no logs/outbox/analytics/persistence, re-authorize resume | Redaction and response-scope tests |
| SSRF through provider URLs/references | Adapters call fixed configured origins through approved outbound port; no callback URL, redirect URL, provider URL, or evidence reference is fetched directly | Import/boundary tests and hostile URL tests |
| Production use of test provider/policy | Startup refusal for `local-test` in staging/production; unpublished jurisdiction policy fails closed | Configuration-startup tests |
| Provider I/O holds transaction/pool | External call after first commit and before second transaction; transaction activity asserted around adapter calls | Instrumented adapter and pool tests |
| Worker crash or multi-instance race | PostgreSQL lease, bounded attempts/backoff, lease-owner settlement, dead letter, reconciliation | Multi-worker/crash tests |
| Evidence resurrection or history rewrite | Immutable evidence, one-successor chain, expected current tip, validity/expiry constraints | Trigger/constraint and race tests |
| Provider result used as authorization | Owner re-authorizes and recomputes current predicate; no master eligibility boolean | Owner integration/regression tests |
| Biometric/PII overcollection | Forbidden-column assertion, minimized contracts/outbox/audit, no provider DTO in domain model | Schema and serialization tests |
| Admin enumeration/export/override | Aggregate and exact-reference reads only; no list/search/export/mutation routes; Admin audience plus ADR-0017 exact action | Route inventory and negative-audience tests |
| Log/audit leakage | Allow-listed structured fields; secrets, links, raw reasons, identity attributes, callback body redacted; audit separated from diagnostics | Canary-string log tests |
| Policy rollback or unknown jurisdiction | Versioned policy; attempt pins version; `UNKNOWN`/unpublished is refusal; a read-only comparison detects expiry, policy-version, or requirement change without effect; later approved owners assess their current requirement | Policy-version/re-verification and no-side-effect tests |
| Provider outage or ambiguous result | Recoverable lifecycle, lookup by provider key, bounded due-page reconciliation, normalized finding before repair; never infer success | Timeout/crash/recovery, missing-callback, retrieval-outage, and ambiguous-create tests |
| Reconciliation race, stale state, or unsafe repair | Short PostgreSQL row-lock claim marks only due-scan metadata; provider read is outside transaction; identity/state binding is rechecked and the callback path atomically applies only compatible append-only facts | Concurrent reconciliation, revocation-successor, malformed/mismatched-state, and transaction-boundary tests |

## Privacy and deletion

Provider-held data is governed by an approved per-country processing, retention, residency, biometric, deletion, and subprocessor decision. VELORA stores only the minimum normalized evidence needed to prove the platform decision and must be able to revoke/expire it without deleting history required by approved law or fraud controls.

Deletion and data-subject requests are coordinated by USERS for account lifecycle and executed by IDENTITY for its records/provider obligations. Legal hold is explicit, audited, and cannot be inferred from provider retention. No retention duration is invented before legal approval.

## Release blockers

Live verification remains blocked without approved provider, provider-specific ADR, written use-case eligibility where public terms are silent, jurisdiction policy, notices/consent, privacy/biometric/residency/retention/deletion review, production adapter, callback authentication design, operations owner, incident/reconciliation procedure, and approved phase/design handoff.

See [security baseline](01-security-baseline.md), [outbound networking](06-abuse-outbound-networking.md), [Identity operations](../operations/07-identity-verification-operations.md), and [provider eligibility](../compliance/09-identity-verification-provider-eligibility.md).
