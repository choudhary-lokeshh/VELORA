import type { IconName } from '../design/icons';
import type { Tone } from '../design/primitives';

/**
 * Turning what the contract carries into what an operator reads.
 *
 * Two rules run through this module, and the second is the one that matters.
 *
 * **A state is presented, never interpreted.** Most operational reads publish
 * `state` as an open string — the owning domain's own vocabulary — so a
 * hand-written lookup here would silently print a raw `provider_pending` the
 * day a domain adds one. Instead the value is humanised: underscores become
 * spaces and the first letter is capitalised. That is a presentation transform
 * and nothing more; it adds no meaning the server did not send, and a state
 * nobody here has seen before still reads as a state.
 *
 * **Colour is only ever the server's judgement.** It would be easy to tone a
 * row red because its state contains "failed", and easy to be wrong: one
 * domain's `failed` is terminal and another's is retried in ninety seconds.
 * The only judgements on this surface are the ones the contract publishes —
 * `breached` on a backlog, a case's own priority, a creator's own status — and
 * they are the only things that get a colour. Everything else is a count in
 * plain ink, which on a console is the difference between a signal and a
 * decorated table.
 */

/* ============================== States =============================== */

/**
 * A domain's own state vocabulary, made readable without being reinterpreted.
 *
 * `provider_pending` becomes "Provider pending". Nothing is mapped, dropped, or
 * renamed, so a state added upstream tomorrow reads correctly today.
 */
export function humanState(state: string): string {
  const spaced = state.replaceAll('_', ' ').trim();
  if (spaced.length === 0) return state;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/* ============================= Durations ============================= */

/**
 * How old the oldest owed item is, said the way an operator would say it.
 *
 * Coarse on purpose. "Forty-five seconds" and "a minute" are the same fact for
 * somebody deciding whether to escalate, and precision here would be precision
 * about something nobody needs it for.
 */
export function formatAge(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return 'unknown';
  if (seconds < 60) {
    return `${String(Math.max(1, Math.round(seconds)))}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${String(hours)}h`;
  return `${String(Math.floor(hours / 24))}d`;
}

/** A date and a time, without the seconds nobody needs. */
export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** How long until a deadline, or that it has passed. */
export function formatRemaining(
  value: string,
  now: number = Date.now(),
): string {
  const remaining = new Date(value).getTime() - now;
  if (Number.isNaN(remaining)) return 'unknown';
  if (remaining <= 0) return 'closed';
  return `${formatAge(remaining / 1000)} left`;
}

/* ============================== Counting ============================= */

/** A count and the thing it counted, agreeing in number. */
export function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

export function totalOf(rows: readonly { readonly count: number }[]): number {
  return rows.reduce((total, row) => total + row.count, 0);
}

/* ========================== Published judgements ===================== */

export interface StateLook {
  readonly icon: IconName;
  readonly label: string;
  readonly tone: Tone;
}

/**
 * A case's priority, which the contract publishes as a closed enum and which
 * the platform itself treats as a judgement. This is one of the few places a
 * colour is honest.
 */
const casePriority: Readonly<Record<string, StateLook>> = {
  high: { icon: 'alert', label: 'High', tone: 'caution' },
  low: { icon: 'clock', label: 'Low', tone: 'neutral' },
  normal: { icon: 'clock', label: 'Normal', tone: 'neutral' },
  untriaged: { icon: 'queue', label: 'Untriaged', tone: 'info' },
  urgent: { icon: 'alert', label: 'Urgent', tone: 'critical' },
};

export function casePriorityLook(priority: string): StateLook {
  return (
    casePriority[priority] ?? {
      icon: 'info',
      label: humanState(priority),
      tone: 'neutral',
    }
  );
}

/** A case's position in its own workflow. Closed enum, no judgement implied. */
export const caseStateLabels: Readonly<Record<string, string>> = {
  closed: 'Closed',
  decided: 'Decided',
  investigating: 'Investigating',
  new: 'New',
  triaged: 'Triaged',
};

export const queueLabels: Readonly<Record<string, string>> = {
  consumer_conduct: 'Consumer conduct',
  creator_content: 'Creator content',
  creator_identity: 'Creator identity',
};

export const targetTypeLabels: Readonly<Record<string, string>> = {
  club: 'Club',
  consumer_account: 'Consumer account',
  conversation: 'Conversation',
  creator_content: 'Creator item',
  creator_profile: 'Creator profile',
};

/**
 * A creator's standing, which CREATORS publishes as a closed enum and which is
 * the whole reason an operator is looking at the row.
 */
const creatorStatus: Readonly<Record<string, StateLook>> = {
  active: { icon: 'check', label: 'Active', tone: 'positive' },
  applicant: { icon: 'clock', label: 'Applicant', tone: 'neutral' },
  closed: { icon: 'lock', label: 'Closed', tone: 'neutral' },
  suspended: { icon: 'ban', label: 'Suspended', tone: 'critical' },
};

export function creatorStatusLook(status: string): StateLook {
  return (
    creatorStatus[status] ?? {
      icon: 'info',
      label: humanState(status),
      tone: 'neutral',
    }
  );
}

/**
 * A consumer account's standing, which USERS publishes as a closed enum.
 *
 * Toned because it is the platform's own judgement about the account and the
 * whole reason an operator is reading the row. `pending_profile` is toned
 * neutral rather than as a problem: somebody part-way through joining is not a
 * case, and colouring them as one would put ordinary sign-ups in a work queue.
 */
const accountStatus: Readonly<Record<string, StateLook>> = {
  active: { icon: 'check', label: 'Active', tone: 'positive' },
  deactivated: { icon: 'lock', label: 'Deactivated', tone: 'neutral' },
  deletion_pending: {
    icon: 'clock',
    label: 'Deletion pending',
    tone: 'caution',
  },
  erased: { icon: 'lock', label: 'Erased', tone: 'neutral' },
  pending_profile: { icon: 'clock', label: 'Pending profile', tone: 'neutral' },
  restricted: { icon: 'ban', label: 'Restricted', tone: 'critical' },
};

export function accountStatusLook(status: string): StateLook {
  return (
    accountStatus[status] ?? {
      icon: 'info',
      label: humanState(status),
      tone: 'neutral',
    }
  );
}

/**
 * Why an account is not active, in USERS' own coarse vocabulary.
 *
 * Deliberately coarse and never expanded here. The finding behind a safety
 * restriction lives with the enforcement record in TRUST & SAFETY and reaches
 * an operator through the case that produced it, beside the evidence it rests
 * on — which is the only place it can honestly be read.
 */
export const accountStatusReasonLabels: Readonly<Record<string, string>> = {
  eligibility_failed: 'Eligibility failed',
  onboarding_incomplete: 'Onboarding incomplete',
  safety_enforcement: 'Safety enforcement',
  user_requested: 'Requested by the account holder',
};

/** What a club is doing, in PRIVATE CLUBS' own vocabulary. */
export const clubLifecycleLabels: Readonly<Record<string, string>> = {
  closed: 'Closed',
  draft: 'Draft',
  published: 'Published',
};

/** How somebody came to hold a membership. */
export const membershipSourceLabels: Readonly<Record<string, string>> = {
  admin_grant: 'Granted by an operator',
  billing: 'Bought',
  creator_invite: 'Invited by the creator',
};

/** What a payment bought, in the vocabulary the creator's earnings split by. */
export const resourceTypeLabels: Readonly<Record<string, string>> = {
  club: 'Club membership',
  gift: 'Gift',
};

/**
 * Which of the two records an audit row came out of.
 *
 * Named for the record rather than for a severity, because neither record is
 * more serious than the other and one of them is simply everything AUTH has
 * seen.
 */
export const auditStreamLabels: Readonly<Record<string, string>> = {
  decision: 'Moderation decisions',
  security: 'Authentication and session events',
};

const appealState: Readonly<Record<string, StateLook>> = {
  received: { icon: 'queue', label: 'Received', tone: 'info' },
  refused: { icon: 'x', label: 'Refused', tone: 'neutral' },
  under_review: { icon: 'clock', label: 'Under review', tone: 'caution' },
  upheld: { icon: 'check', label: 'Upheld', tone: 'positive' },
  withdrawn: { icon: 'undo', label: 'Withdrawn', tone: 'neutral' },
};

export function appealStateLook(state: string): StateLook {
  return (
    appealState[state] ?? {
      icon: 'info',
      label: humanState(state),
      tone: 'neutral',
    }
  );
}

/* ============================== Vocabulary =========================== */

/**
 * The reason codes an enforcement or a decision may carry.
 *
 * Restated in an operator's words and never expanded. Each one is a policy
 * category the platform publishes; writing an explanation here would be writing
 * policy in a stylesheet's neighbour.
 */
export const enforcementReasonLabels: Readonly<Record<string, string>> = {
  harassment: 'Harassment',
  impersonation: 'Impersonation',
  insufficient_evidence: 'Insufficient evidence',
  no_violation_found: 'No violation found',
  platform_integrity: 'Platform integrity',
  requires_specialist_review: 'Requires specialist review',
  sexual_content_violation: 'Sexual content violation',
  spam_or_scam: 'Spam or scam',
  underage_risk: 'Underage risk',
};

/**
 * The reason codes a *reporter* may choose, in an operator's words.
 *
 * Deliberately a separate map from the enforcement one above. A report is an
 * allegation and an enforcement is a finding, the two vocabularies are not the
 * same list, and rendering a reporter's choice through the enforcement labels
 * silently mislabelled every one that had no enforcement twin.
 */
export const reportReasonLabels: Readonly<Record<string, string>> = {
  harassment: 'Harassment or bullying',
  hate_or_abuse: 'Hate or abuse',
  impersonation: 'Impersonation or fake profile',
  other: 'Something else',
  sexual_content_violation: 'Sexual content violation',
  spam_or_scam: 'Spam or scam',
  threats_or_violence: 'Threats or violence',
  underage_concern: 'May be under 18',
};

export const decisionActionLabels: Readonly<Record<string, string>> = {
  escalate: 'Escalate',
  no_action: 'No action',
  restrict_capability: 'Restrict a capability',
  revoke_restriction: 'Revoke a restriction',
  temporary_hold: 'Temporary hold',
  unpublish: 'Unpublish',
};

export const enforcementScopeLabels: Readonly<Record<string, string>> = {
  account_restriction: 'Account restriction',
  club_membership_revocation: 'Club membership revocation',
  conversation_closure: 'Conversation closure',
  creator_object_removal: 'Creator object removal',
  creator_suspension: 'Creator suspension',
};

/**
 * Where a cardholder claim has got to, and whether it still needs an answer.
 *
 * `lost` is a statement about where the money is rather than about who was
 * right. That is the only reading that makes the accounting consequence
 * unambiguous, and an operator scanning this column is reading it for exactly
 * that.
 */
const disputeState: Readonly<Record<string, StateLook>> = {
  lost: { icon: 'alert', label: 'Lost', tone: 'critical' },
  opened: { icon: 'queue', label: 'Open', tone: 'caution' },
  under_review: { icon: 'clock', label: 'Under review', tone: 'info' },
  withdrawn: { icon: 'check', label: 'Withdrawn', tone: 'neutral' },
  won: { icon: 'check', label: 'Won', tone: 'positive' },
};

export function disputeStateLook(state: string): StateLook {
  return (
    disputeState[state] ?? {
      icon: 'info',
      label: humanState(state),
      tone: 'neutral',
    }
  );
}

/**
 * Why a cardholder says they are claiming, normalized from whatever their
 * provider called it.
 *
 * Restated rather than expanded. VELORA does not know whether a claim is
 * correct, and a label that implied it did would be the console taking a side
 * before anybody had looked.
 */
export const disputeReasonLabels: Readonly<Record<string, string>> = {
  duplicate: 'Charged twice',
  fraudulent: 'Not authorised by the cardholder',
  other: 'Another reason the provider did not classify',
  product_not_received: 'Says they did not receive it',
  product_unacceptable: 'Says it was not what was described',
  subscription_cancelled: 'Says the subscription was already cancelled',
  unrecognized: 'Does not recognise the charge',
};

export const refundReasonLabels: Readonly<Record<string, string>> = {
  dispute_resolution: 'Dispute resolution',
  duplicate_charge: 'Duplicate charge',
  not_delivered: 'Not delivered',
  operator_correction: 'Operator correction',
};

export const removableObjectLabels: Readonly<Record<string, string>> = {
  club: 'A club',
  creator_content: 'One catalog item',
  creator_profile: 'The public profile',
};

export const identityPurposeLabels: Readonly<Record<string, string>> = {
  adult_assurance: 'Adult assurance',
  commercial_kyc: 'Commercial KYC',
  creator_identity: 'Creator identity',
  depicted_person_adult_assurance: 'Depicted person, adult assurance',
  depicted_person_identity: 'Depicted person, identity',
};

/**
 * An opaque identifier, shortened for a table and never for an audit record.
 *
 * An operator carrying an identifier between systems needs all of it, so every
 * shortened value on this surface sits beside a control that copies the whole
 * one.
 */
export function shortId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}…`;
}
