# Discovery and mutual introductions flow

## Purpose

Authoritative flow for V1 candidate presentation and mutual introduction. DISCOVERY owns state; Trust & Safety owns block/enforcement eligibility.

## Preconditions

Actor account active, profile/region/adult gates satisfied, not restricted, and action is within rate/usage policy. Candidate data is only a projection; every action rechecks current eligibility.

## Main flow

1. DISCOVERY builds candidate set using preferences/policy and excludes self, blocks, enforcement, unavailable/ineligible accounts, and other forbidden pairs.
2. Candidate presentation records policy/ranking version for audit/measurement with minimized data.
3. Actor sends one-sided introduction signal; repeat client request returns existing signal.
4. On reciprocal valid signal, atomically transition pair to mutual introduction and publish connection fact.
5. MESSAGING may create/activate authorized conversation from connection fact.

## Alternate and error flows

Actor withdraws or recipient declines before mutual transition; stale/unavailable candidate returns denial. Decline is idempotent, closes that pending signal according to retention/reappearance policy, and does not disclose a private reason. A block/report/enforcement occurring before or during action wins and closes/restricts pair. Two simultaneous reciprocal signals produce one mutual introduction. Ranking failure may return no candidates; never return policy-ineligible substitute. Paid priority can affect ordering only if later approved, never eligibility or recipient obligation.

## Security, data, events

Expose only policy-approved profile fields; do not reveal why target is absent or restricted. Pair state has unique unordered pair/expected version and idempotency key. Events: candidate presented, signal lifecycle, mutual intro created/closed. Analytics keeps no unnecessary private preference payload.

## Implemented V1 candidate presentation

Candidate data is read through the consumer directory USERS publishes rather than from profile tables, so one module knows what a profile is. Every approved eligibility condition is enforced in a single statement rather than filtered afterwards, because a filter applied after paging changes how many results a page holds and a filter a caller forgets is a person shown to somebody who should never have seen them.

Ordering is deterministic and explainable — coarse region match, shared language count, bucketed availability freshness, then a per-viewer tie-break that rotates on a fixed window — and paging compares a single composed sort key, so the order is stable while a reader moves through it. Nothing purchasable affects eligibility or order.

A pass is private and expiring, is never disclosed to the other person, and produces no reputation. Introduction signals and the mutual transition are implemented. A pending signal expires at the earlier of the originating availability window and twenty-four hours, enforced in the predicate of the mutual transition; after that it cannot complete an introduction, is closed with reason `expired` rather than rewritten, and the pair may be introduced again. A signal revalidates the target at the moment it is sent; a reciprocal signal completes the pair through a compare-and-set against the other person's own signal, so nobody can complete their own introduction and two simultaneous reciprocal signals produce exactly one mutual introduction. A decline closes the introduction privately and suppresses the pair for the usual window; a withdrawal closes it and suppresses nothing. A live pair is excluded from both people's feeds.

## Phase/cross-references

V1. Phase 2 premium priority; Phase 3 advanced filters/paid visibility. Signal expiry is decided; `DECISION REQUIRED`: decline/reappearance policy. See [DISCOVERY](../domains/discovery.md), [MESSAGING](../domains/messaging.md), [Trust & Safety](../domains/trust-safety.md), [consumer product](../product/02-consumer-product.md).
