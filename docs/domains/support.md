# SUPPORT domain

## Purpose and scope

SUPPORT owns what somebody asked VELORA for help with, and what an operator did about it. It owns nothing else, and the list of things it deliberately does not own is the important part: no enforcement, no report, no case, no evidence, no decision, and no account status. Those belong to [TRUST & SAFETY](trust-safety.md), [MODERATION](moderation.md), and [USERS](users.md), and a support ticket that could reach any of them would be an enforcement path with none of the audit, dual control, or appeal rights the real one carries.

The domain exists for the flattest complaint in the whole random-video category: there is no way to reach anybody. Reviews of competitor products say it in the same words over and over — "there is no support", "they tell you to email and nobody replies". An address in a policy document is not a support path, because the person using it can never tell whether anything happened. So the whole domain is shaped around one property: **after somebody submits, they hold a reference they can read back and a status that is the server's answer rather than a promise a screen made.**

## Not the safety surface

A report and a ticket are not the same thing and are never merged.

A report is evidence about another person. Its reporter is deliberately told nothing about what happened next, because an outcome told to a reporter is an outcome the reported person can work out. A ticket is somebody asking about their own account, and the whole point is that they *are* told what happened.

The two have different owners, different lifecycles, and opposite disclosure rules, so folding either into the other would break one of them. Both consumer surfaces say so where somebody might get it wrong: the Help screen points anybody being harassed at reporting the person instead, which reaches moderation, carries evidence, and can block them in the same act.

## Flow and state

`received -> in_review -> resolved | closed`, with reopening permitted from either settled state.

`received` is an honest state rather than a polite one: the platform holds the ticket and nobody has looked. Saying anything warmer while nobody is looking is the lie that makes a person stop believing every later status too. `resolved` means an operator decided it is answered; `closed` means it ended without one, which is a different fact and is not disguised as the first.

Which moves are permitted is a map rather than a free assignment, because a status is a claim about what happened and not every sequence of claims is coherent — a ticket does not become unlooked-at again. A move to the status a ticket already holds is answered idempotently and records no lifecycle entry: an append-only history full of entries that describe no change is a history nobody can read. A note supplied alongside one is still recorded, because an operator writing one meant to write it.

## Nothing here depends on anything that can be switched off

There is no provider, no adapter registry, no configuration value, and no environment in which this domain is unavailable. A ticket is a row in VELORA's own database, answered by VELORA's own operators through [Platform Admin](../surfaces/04-platform-admin.md).

That was a deliberate choice over any hosted help desk, and the reasoning is the same one that made the domain necessary: the one path a person uses when everything else about the product has failed them must not itself depend on something that can fail, cost money, or be switched off. A support flow that refuses because a vendor is unreachable is the exact failure the reviews are complaining about.

It also costs nothing to run, which matters while the owner budget is what it is.

## Retry safety, and why it matters more here

Submission is idempotent on the submitter's own client identifier, enforced by a unique index over owner and key rather than by a prior read. That is the ordinary pattern in this repository, and it carries more weight here than almost anywhere else: the connection that lost the response is very often the thing being reported, and a person who taps again must not end up with two tickets and no idea which one anybody is reading.

A retry is answered before any bound is consulted, so somebody whose response was lost is never refused for a submission they already made.

## Bounds

Two, and they stop different things. `supportTicketRateLimitCount` (10 per 24 hours) stops a burst. `maximumOpenSupportTickets` (5) stops a backlog nobody could answer being built one ticket a day, and it is the tighter of the two so it is the one that normally applies. Neither removes or alters anything already submitted: reaching a bound refuses a further submission for a while, and that is all.

Nothing is gated on standing. An account that is restricted, whose adult assurance has lapsed, or that is mid-deletion may still open a ticket — those are exactly the accounts most likely to need one, and requiring good standing would deny help to precisely the people asking why they cannot use the product. This is the same rule TRUST & SAFETY applies to blocking and reporting, for the same reason.

## The reference

`VS-XXXX-XXXX`, drawn from Crockford's base32 without `I`, `L`, `O`, and `U`. The first three are the characters a person reads back wrong or types as a digit; the fourth is excluded so a random string cannot spell something somebody has to say out loud to support.

It is generated rather than derived from a counter. A sequential reference would tell every person who ever opened a ticket how many the platform has ever had, which is a business fact nobody decided to publish. Forty bits of choice against a small table makes a collision rare rather than impossible, so it is checked and retried a bounded number of times; the unique index is still the guarantee and the check only keeps the ordinary case off it. The shape is a database CHECK as well as a generator rule, because a reference that did not match would be one nobody could type back into the surface that validates it.

## What comes back, and what never does

The owner's own words come back. That is the one place this contract deliberately differs from the safety one: a report's narrative is evidence about somebody else and echoing it would turn an evidence store into a readable one, while a ticket is a person's account of their own problem and being able to re-read it is most of what "see your ticket" means.

What never comes back to a consumer is an operator's note, an operator's identity, a queue, or anything about how the ticket is being handled. There is no field for any of them in the consumer contract, so no response can carry one.

**No response-time promise appears anywhere.** There is no `respondBy`, no `slaHours`, and no queue position, because VELORA has nobody on a rota and a deadline it cannot keep is worse than no deadline at all. Both consumer surfaces say what is true instead: a person reads every one of these, and this screen will say what is actually happening to it.

## Data and immutability

`support_tickets` holds one request for help. Its status moves and nothing else about it does — what somebody wrote, who wrote it, and the reference they were given are the record, and a trigger refuses an update to any of them. `support_ticket_events` is the working record and is append-only, enforced by a trigger rather than by convention: this is what an operator relies on when a person says "somebody already told me it was fixed", and a record that can be edited is not that record.

The owner is an opaque consumer account reference with no foreign key, on the rule [data ownership](../architecture/05-data-ownership.md) records.

**Nothing here is a channel.** There is no address column, no phone number, no device identifier, no attachment, and no outbound message record, and an integration test enumerates the columns and asserts their absence rather than trusting a validator. A ticket is answered by an operator reading it and moving its status, which the owner reads back through their own ticket.

Retention is `DECISION REQUIRED / LEGAL REVIEW REQUIRED`, like every other personal-data class in this repository. Nothing expires, there is no sweep, and no correctness rule depends on a row being physically gone, so an approved schedule later applies as a deletion pass.

## Operator surface

Three routes under `/v1/admin/support/`, behind the Platform Admin audience and a fresh phishing-resistant assurance like every other operator route: read the queue, read one ticket with its history, move one ticket and optionally record why. There is deliberately no fourth. An operator cannot delete a ticket, cannot edit what somebody wrote, cannot reassign one, and cannot reach an account, an enforcement, or a balance from here.

The queue is oldest first, which is the opposite of the order the person who wrote it sees. That is deliberate: somebody wants their most recent question and an operator wants the one that has been waiting longest.

The operator view carries the owner's account identifier, which is the one field the owner's own view does not — an operator has to be able to look the person up through the existing account surface in order to help them. There is still no address, no display name, and no device detail.

## Observability

One signal, `support.ticket.opened`, carrying the category and the reference. The subject and the description are the person's own words about their own problem and have no business in a log line; a test asserts that neither reaches one.

## Phase and open questions

V1 is this: a ticket, a reference, a status, an append-only history, and the smallest operator surface that makes one answerable. `DECISION REQUIRED`: retention duration, whether a consumer may add to a ticket after submitting, and whether an operator reply should ever be published to the owner rather than only a status. None of those is needed for the property this domain exists to provide.

## Cross-references

[Platform Admin](../surfaces/04-platform-admin.md), [Consumer Web](../surfaces/01-consumer-web.md), [Consumer Mobile](../surfaces/02-consumer-mobile.md), [TRUST & SAFETY](trust-safety.md), [MODERATION](moderation.md), [USERS](users.md), [data ownership](../architecture/05-data-ownership.md), [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md).
