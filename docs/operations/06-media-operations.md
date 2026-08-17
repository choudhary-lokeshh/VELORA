# Media operations

## Purpose and authority

Define what an operator does about the media platform's owed work: what each backlog class means, what is safe to do about it, and what is deliberately not offered. [MEDIA](../domains/media.md) owns bytes and their technical lifecycle; ADMIN reads that state and holds one action. Nothing here authorizes an operator to change what an asset is, who may see it, or whether it exists.

**Nobody can reach this surface today, in any environment.** Every Platform Admin route requires the Platform Admin audience *and* a fresh phishing-resistant assurance, no approved verifier produces one, and the routes fail closed rather than degrading to something weaker. What follows describes behaviour that exists and is tested; it is not yet a procedure anybody can carry out. Until admin sign-in is decided in [decisions required](../decisions/DECISIONS_REQUIRED.md), this is a specification of the operator surface rather than a live runbook, and it is written now so that the first person to reach it is not also the first person to work out what the screen means.

This document does not select storage, delivery, scanning, or paging vendors, and does not set alert routing or on-call ownership. Those remain `DECISION REQUIRED` in [platform health](05-platform-health.md), and the [media threat model](../security/10-media-threat-model.md) gate on operational readiness is not satisfied until a named owner and a route exist.

## What an operator sees

The media panel on [Platform Admin](../surfaces/04-platform-admin.md) reports counts by state, the adapters this process composed, whether the environment can accept media at all, the disagreements with the provider nobody could safely correct, and — the part worth watching — every class of owed work with the age of its oldest member and the age at which that becomes late.

There is no list, no search, and no identifier of any kind on it. An operator who could page through everybody's media would have a browsing surface over private images however it was labelled.

## Backlog classes and what each one means

Every class below reports even when it is empty. Nothing owed is a fact worth seeing: a class that only appeared when unhealthy could not be told apart from a signal that stopped arriving.

| Class | What is waiting | Late when | First thing to check |
|---|---|---|---|
| `inspect_pending` | Uploaded objects not yet examined | Past the stall bound | Whether the worker fleet is running and claiming |
| `scan_pending` | Objects awaiting a malware verdict | Past the stall bound | Whether an approved scanner is composed at all |
| `process_pending` | Assets owed their derivative set | Past the stall bound | Processing failures and dead letters of the same kind |
| `delete_pending` | Objects owed destruction at the provider | Past the stall bound | Provider reachability, then dead letters |
| `purge_pending` | Addresses a delivery layer has been asked to forget | Past the stall bound | Whether the delivery adapter is `unavailable` |
| `reconcile_pending` | Audits owed against the provider | Past the stall bound | Whether the reconciliation cycle is running |
| `purge_unanswered` | Purges asked for with no outcome recorded | Past the purge-stall bound | That the delivery layer answers at all; an unanswered purge is not a purge |
| `drift_open` | Disagreements nobody could safely correct | Past the attention bound | The finding's kind — each is a different question |
| `lifecycle_stalled` | Assets the platform took on and has not finished | Past the stall bound | Dead-lettered duties for those assets |

The thresholds are the deadlines the platform's own sweeps run on, published so an alert rule need not invent one, and they are named and asserted in [MEDIA](../domains/media.md). A dashboard threshold shorter than the platform's own would page about work that is proceeding; a longer one would stay quiet while reconciliation was already repairing.

**Dead-lettered duties are not a backlog and carry no age threshold.** They are work the platform gave up on after its bounded attempts, actionable the instant they appear. They are reported by count under what needs a person.

**An asset awaiting an upload is not stalled.** Somebody choosing a file owes the next move, not the platform, and it has its own far longer sweep.

## Looking at one asset

The detail read answers about one asset whose identifier the operator already holds — from a drift finding, a report, or a support conversation, never from browsing. It carries the technical lifecycle and the instant it last changed, the asset class, the objects the platform believes exist, the duties owed against it, the drift findings raised about it, whether a legal hold stands, and — where they apply — the deletion request instant, the readiness instant, and the machine-readable rejection reason.

It carries `ownerDomain` and never an owner identifier. A technical incident does not become a file on somebody.

Each object carries its key, its role, its state, its variant kind, the size and format where those were measured, when it was last verified against the provider, and the purge request instant and outcome where one was asked for. **The object key is deliberately present.** A key is not a credential — delivery requires a signature minted against current server truth, and key knowledge is nowhere in the authorization model, which is why keys are random rather than derived. An operator whose delivery layer is still serving something taken down has to be able to name the object to their provider, and withholding it would push them to query the database by hand.

Each obligation carries its kind, its state, its attempt count, when it next becomes available, and its failure reason where it has one. That last field is what answers "why is this stuck" without anybody reading a log.

The lists are bounded and `truncated` says so when a bound was reached. An operator deciding on a partial picture that looked complete is the failure that flag exists to prevent.

## What an operator may do about it

One action: ask the delivery layer to forget every public address of one asset. It destroys nothing, denies nothing that was not already denied at the origin, is idempotent, and records its own obligations as the audit. It is reached with an asset identifier the operator already has from a drift finding, a report, or a support conversation. Asking twice owes it once, so zero owed is a success rather than a failure to report.

Everything else is the platform's own work to redo. A stalled asset is repaired by the ordinary pipeline being owed its duty again under its own lease and attempt bound — not by an operator performing the work, and not by reconciliation doing it directly. Origin denial never waits for a cache: a held or removed asset stops being authorized the moment any authority says so, and a cache that has not been told is a visible obligation rather than a hole in the decision.

## The shapes an operator actually meets

**Every upload is being refused.** Check the adapters first. `MEDIA_MALWARE_SCANNER` defaults to `unavailable`, which refuses, and a refusal quarantines rather than passing — an environment with no scanning position accepts no media at all, by design. `MEDIA_STORAGE_PROVIDER` behaves the same way and staging and production reject any other value. This is not degradation and there is nothing to repair in the media platform.

**`scan_pending` is climbing and a scanner is composed.** Then the scanner is reachable and not answering, and the duties are backing off toward their attempt bound. What arrives at that bound is a dead letter, not a longer wait.

**An asset is quarantined.** Quarantine is terminal for delivery: it is never processed, never owes a `process` duty, and cannot reach any state a surface would act on. The rejection reason on the detail read is the machine-readable one, and what the uploader was told is deliberately coarser — the difference between "your file is not a JPEG" and "your file claimed to be a JPEG and its bytes are a PNG" is useful to an attacker and to nobody else, and it is not a discrepancy to reconcile. There is nothing an operator does to a quarantined asset; no override exists, and its absence is the decision.

**Somebody's image is missing and the asset says `ready`.** Then it is not a media fault. `ready` is a claim about bytes and nothing more; delivery composes it with the owning domain's association, the viewer's entitlement, and Trust and Safety's current answer, and a refusal reports every closed gate rather than the first. Take it to the owning domain or to [moderation operations](02-moderation-operations.md). Nothing on this surface can grant delivery, and nothing on it should be changed in the attempt.

**A drift finding is open.** Each kind is a different question, and what is safe to do about one is unsafe for another:

| Kind | What it says | What follows from it |
|---|---|---|
| `orphaned_object` | Bytes at a closed upload window's key that no record claims | Written after the authorization lapsed, so they describe nothing; the platform destroys them rather than adopting them |
| `original_missing` | The record says an original is present; the provider has nothing | Not repairable by copying — the ordinary pipeline is owed a duty and reaches its own verdict |
| `variant_missing` | The record says a derivative is present; the provider has nothing | Rebuildable from the original, at the recorded processing version and to the key the record already names |
| `original_size_mismatch` | The provider's size for an original is not the inspected size | The bytes are not what was measured; the record about them is wrong |
| `variant_size_mismatch` | The provider's size for a derivative is not what was written | As above, for a derivative |
| `undeleted_object` | The record says destroyed; the provider still holds it | The destruction is owed again |
| `stalled_lifecycle` | The platform owes a move and nothing is carrying it | Look for the dead-lettered duty against that asset |
| `stale_purge` | A purge was asked for long ago and no outcome was ever recorded | The delivery layer is not answering; escalate as below |

A finding stays outstanding until it is settled, and settling it says which of three things happened — repaired, owed, or already gone by the time anybody looked. Nothing closes one because somebody looked at it, and a repeat observation bumps an occurrence count rather than filing a second row: a count climbing on one finding is the same fault seen again, not new faults.

**A duty is dead-lettered.** It is retained as evidence rather than dropped, and it is never resurrected automatically — owing it again would reset its attempts and it would dead-letter again, one cycle at a time, for ever. A dead letter is a decision somebody has to make, which is exactly why it carries no age threshold.

## What is deliberately not offered

- **No deletion.** Destroying somebody's bytes is the owning domain's decision or a legal process, and an operator button that did it would destroy the evidence an appeal needs.
- **No legal hold.** The mechanism exists and the database refuses to record a held asset as deleted; the *authority* does not. An operator placing a hold with no enforcement record behind it would be an unaudited action on evidence. See the open decision in [decisions required](../decisions/DECISIONS_REQUIRED.md).
- **No asset list or search**, for the reason above.
- **No provider console step in any procedure here.** Where the record and the provider disagree, the record is repaired through the platform so the repair is bounded, idempotent, and audited; provider state never overwrites product or safety truth.

## What must not leave this surface

The platform is built so that no raw media byte, signed delivery credential, upload token, provider secret, or EXIF value reaches a log line. An operator working an incident must not undo that by hand.

- **Do not copy an image, a derivative, or a delivery address into a ticket, a chat, or an incident document.** A private delivery credential is a bearer token for as long as it lives, and a public derivative address is permanent and immutable by design.
- **An object key may be named to the provider**, because that conversation is why it is on the screen. That is not a reason to paste it anywhere else.
- **`ownerDomain` is the only provenance this surface carries, and it is enough.** Do not go and find out whose asset it is in order to write it down; a technical incident that acquires a person's name has become something else.
- **A quarantine reason is internal.** It describes what an upload's bytes turned out to be, and it is written for a diagnosis rather than for repetition.

## Failure, incidents, and open decisions

An environment whose adapters report `unavailable` is not degraded — it is refusing media by design, and every upload fails closed. Treat a sudden change in adapter names as a configuration incident rather than a media incident.

A rising `purge_unanswered` count with a healthy `purge_pending` count means the delivery layer is accepting requests and answering none, which is the failure the outcome column exists to make visible. Escalate through [incident response](04-incident-response.md) where content that was taken down may still be served; the bound on that exposure is the credential window recorded in [ADR-0023](../decisions/ADR-0023-media-platform-architecture.md), and any claim of instant revocation that does not name it is false.

**Where each escalation goes.** Anything where content that was taken down may still be reachable goes to [incident response](04-incident-response.md) immediately, because the origin refusing does nothing about bytes a cache is already serving. Anything where the platform's answer and a safety decision disagree goes to [moderation operations](02-moderation-operations.md); Safety owns the decision and MEDIA owns only the bytes. Anything where the record and the provider disagree in a way no automatic repair covers is already an open drift finding, and that finding is the escalation.

`DECISION REQUIRED`: alert routing, on-call ownership, and paging thresholds above the platform's own. `LEGAL REVIEW REQUIRED`: retention durations for quarantined originals, deleted-asset evidence, and objects under a Safety legal hold.

## Cross-references

See [MEDIA](../domains/media.md), [media threat model](../security/10-media-threat-model.md), [media upload and delivery](../security/04-media-upload-delivery.md), [platform health](05-platform-health.md), [incident response](04-incident-response.md), [moderation operations](02-moderation-operations.md), [Platform Admin surface](../surfaces/04-platform-admin.md), [jobs, idempotency, and concurrency](../engineering/03-jobs-idempotency-concurrency.md), and [ADR-0023](../decisions/ADR-0023-media-platform-architecture.md).
