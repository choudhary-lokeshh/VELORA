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

## Phase/cross-references

V1. Phase 2 premium priority; Phase 3 advanced filters/paid visibility. `DECISION REQUIRED`: decline/reappearance and signal expiry policy. See [DISCOVERY](../domains/discovery.md), [MESSAGING](../domains/messaging.md), [Trust & Safety](../domains/trust-safety.md), [consumer product](../product/02-consumer-product.md).
