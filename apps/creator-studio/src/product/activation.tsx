'use client';

import { useState, type ReactNode } from 'react';

import type { CreatorOnboardingState } from '@velora/creator-client';
import {
  creatorAdultGateMessage,
  failureMessage,
} from '@velora/creator-client';

import { Icon } from '../design/icons';
import {
  BlockedState,
  Button,
  Card,
  CardSkeleton,
  ErrorMessage,
  ErrorState,
  Notice,
} from '../design/primitives';
import { useApi, useCreator, useToast } from '../app/providers';
import { EntryLayout } from '../app/shell';
import { policyDocumentLabels, standingReasonLabels } from './format';
import { useRevalidateOnFocus, useSingleFlight } from './resource';

/**
 * Becoming a creator.
 *
 * Creator access is a capability on an existing VELORA account rather than a
 * second account, and every gate in front of it belongs to somebody else: the
 * adult decision is USERS', the policy versions are the platform's, and the
 * activation itself is CREATORS'. This screen walks the ladder the server
 * published and offers exactly the one control the current step allows.
 *
 * What it never does is imply what activation buys. A creator capability is not
 * payout eligibility, not identity verification, not monetisation approval, and
 * not permission to publish mature content — those are separate predicates the
 * server answers separately, and a welcome screen that blurred them would be
 * making a promise nobody authorised.
 */
export function Activation() {
  const creator = useCreator();
  const onboarding = creator.onboarding.value;

  // Answered once rather than answered now, for the same reason the public
  // page screen keeps its form: a failed activation re-reads, and a placeholder
  // in that window would unmount the card the refusal was written on.
  const answered =
    onboarding !== undefined ||
    creator.onboarding.missing ||
    creator.onboarding.error !== undefined;

  if (creator.onboarding.error !== undefined) {
    return (
      <EntryLayout>
        <Card>
          <ErrorState
            body={creator.onboarding.error}
            onRetry={
              creator.onboarding.retryable ? creator.reloadAll : undefined
            }
            testId="creator-status-failed"
            title="We could not load your creator account"
          />
        </Card>
      </EntryLayout>
    );
  }

  if (!answered) {
    return (
      <EntryLayout>
        <Card testId="activation-loading">
          <CardSkeleton rows={4} />
        </Card>
      </EntryLayout>
    );
  }

  return (
    <EntryLayout>
      {onboarding === undefined ? (
        <BecomeCreator />
      ) : (
        <ActivationStep onboarding={onboarding} />
      )}
    </EntryLayout>
  );
}

/**
 * The first step: there is no creator capability on this account yet.
 *
 * The server answers the same 404 for a creator who does not exist as it does
 * for a route that is not there, so this state is read from the absence rather
 * than from an error message — which is also why it is not rendered as a
 * failure.
 */
function BecomeCreator() {
  const api = useApi();
  const creator = useCreator();
  const toast = useToast();
  const { busy, run } = useSingleFlight();
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [blocked, setBlocked] = useState(false);

  /*
   * The refusal described a moment, not a standing fact, and it named a step
   * taken somewhere else. Before a capability exists there is nothing for the
   * server to publish, so no re-read can carry the news that the step is done:
   * `/v1/creator/onboarding` answers the same 404 either way, and the only
   * question that asks the gate is the activation itself.
   *
   * So the tab coming back is what restores the offer — the rule every other
   * server-owned value on this surface already follows. This asserts nothing
   * about the gate. It puts back the one control that can ask, instead of
   * leaving somebody who did exactly what the screen told them looking at the
   * screen that told them, with nothing on it.
   */
  useRevalidateOnFocus(() => {
    setBlocked(false);
  });

  // The gate answered, so the offer is withdrawn rather than left standing
  // under an error. It is the same screen the ladder shows once a capability
  // exists and the gate stops being met, because it is the same situation:
  // the next step is on VELORA. Here it carries a way back, because the person
  // may have finished on a phone and never left this tab.
  if (blocked) {
    return (
      <AdultGate
        onRetry={() => {
          setBlocked(false);
        }}
      />
    );
  }

  return (
    <Card>
      <div className="s-stack s-stack--2">
        <h1 className="s-title">Open Creator Studio</h1>
        <p className="s-small s-muted">
          Creator access sits on the VELORA account you just signed in with. It
          is never granted automatically, and turning it on changes nothing
          about your ordinary account.
        </p>
      </div>

      <ul className="s-stack s-stack--3" data-testid="creator-what-you-get">
        <ActivationPoint icon="user">
          A public creator page at your own handle, which stays a draft until
          you publish it.
        </ActivationPoint>
        <ActivationPoint icon="draft">
          A catalog of your work. Everything starts as a draft that only you can
          see.
        </ActivationPoint>
        <ActivationPoint icon="users">
          Private clubs you admit people to by invitation.
        </ActivationPoint>
      </ul>

      <Notice testId="creator-not-included" tone="quiet" title="Not included">
        Creator access is not payment approval, identity verification, or
        permission to publish mature content. Those are separate decisions, and
        none of them is available on VELORA yet.
      </Notice>

      {message === undefined ? null : (
        <ErrorMessage testId="creator-onboard-error">{message}</ErrorMessage>
      )}

      <Button
        block
        busy={busy}
        data-testid="creator-onboard"
        size="lg"
        tone="primary"
        onClick={() => {
          run(async () => {
            const result = await api.createAccount();
            // One refusal is not an error on this card: it is the answer that
            // this account may not hold creator access yet, and it has a screen
            // of its own. Reported as a red sentence about "your creator
            // access", it described a thing that does not exist and named
            // nothing the person could do next.
            if (
              result.kind === 'refused' &&
              result.code === 'ACCOUNT_NOT_ELIGIBLE'
            ) {
              setMessage(undefined);
              setBlocked(true);
              creator.reloadAll();
              return;
            }
            const failure = failureMessage(result);
            setMessage(failure);
            if (failure === undefined)
              toast.show('Creator access opened.', 'positive');
            creator.reloadAll();
          });
        }}
      >
        Become a creator
      </Button>
    </Card>
  );
}

function ActivationPoint({
  children,
  icon,
}: {
  readonly children: ReactNode;
  readonly icon: 'draft' | 'user' | 'users';
}) {
  return (
    <li className="s-point">
      <span className="s-point__mark">
        <Icon name={icon} size="sm" />
      </span>
      <span className="s-small s-muted">{children}</span>
    </li>
  );
}

/**
 * The gate that Creator Studio cannot open, wherever it is reached from.
 *
 * One component for both arrivals — the refusal of a first activation, and the
 * ladder step for a capability whose evidence stopped being enough — because
 * they are the same fact about the same account, and two screens saying it
 * would eventually say it differently. The reason is rendered when the server
 * published one; before a capability exists there is none to publish, and the
 * sentence for that case says where to go rather than guessing which gate it
 * was.
 *
 * `onRetry` is given by exactly one of the two arrivals, and the asymmetry is
 * the point. Once a capability exists the server publishes this step and
 * withdraws it by itself, so a control here would be a control that fails.
 * Before one exists nothing is published and the activation request *is* the
 * question, so a control here is the only way to ask it again.
 */
function AdultGate({
  onRetry,
  reason,
}: {
  readonly onRetry?: (() => void) | undefined;
  readonly reason?: string | undefined;
}) {
  return (
    <Card>
      <BlockedState
        label="One step on VELORA"
        testId="creator-adult-gate"
        title="Finish this on VELORA first"
      >
        <p>{creatorAdultGateMessage(reason)}</p>
        <p>
          VELORA decides who is an adult, not Creator Studio, so there is
          nothing here that could complete it for you.
        </p>
        {onRetry === undefined ? null : (
          <Button
            data-testid="creator-adult-gate-retry"
            onClick={onRetry}
            tone="secondary"
          >
            I have finished on VELORA
          </Button>
        )}
      </BlockedState>
    </Card>
  );
}

/**
 * Every remaining rung of the ladder the server published.
 *
 * Each branch offers one control or none. A step whose next action belongs to a
 * different surface — the adult decision is a USERS decision — offers no
 * control at all, because a button here would be a button that fails.
 */
function ActivationStep({
  onboarding,
}: {
  readonly onboarding: CreatorOnboardingState;
}) {
  const status = onboarding.account.status;

  if (status === 'suspended' || status === 'closed') {
    return (
      <Card>
        <BlockedState
          label={status === 'closed' ? 'Closed' : 'Suspended'}
          testId="creator-standing-blocked"
          title={
            status === 'closed'
              ? 'This creator account is closed'
              : 'This creator account is suspended'
          }
        >
          <p>
            {onboarding.account.statusReason === undefined
              ? 'VELORA has restricted this creator account.'
              : (standingReasonLabels[onboarding.account.statusReason] ??
                'VELORA has restricted this creator account.')}
          </p>
          <p>
            Anything you have already made is still yours. Nothing here can
            change this decision.
          </p>
        </BlockedState>
      </Card>
    );
  }

  if (onboarding.step === 'adult_eligibility') {
    return <AdultGate reason={onboarding.adultGateReason} />;
  }

  return <AcceptPolicies documents={onboarding.outstandingPolicies} />;
}

/**
 * The creator policies, accepted by version.
 *
 * The exact versions the server named travel back with the acknowledgement, so
 * accepting is an acceptance of what was on the screen rather than of whatever
 * is current when the request lands.
 */
function AcceptPolicies({
  documents,
}: {
  readonly documents: CreatorOnboardingState['outstandingPolicies'];
}) {
  const api = useApi();
  const creator = useCreator();
  const toast = useToast();
  const { busy, run } = useSingleFlight();
  const [message, setMessage] = useState<string | undefined>(undefined);

  return (
    <Card>
      <div className="s-stack s-stack--2">
        <h1 className="s-title">Accept the creator policies</h1>
        <p className="s-small s-muted">
          These apply to everything you publish on VELORA as a creator. You are
          accepting the versions listed here.
        </p>
      </div>

      <ul
        className="s-stack s-stack--2"
        data-testid="creator-outstanding-policies"
      >
        {documents.map((document) => (
          <li
            className="s-inline s-inline--between"
            key={`${document.key}@${document.version}`}
          >
            <span className="s-small">
              {policyDocumentLabels[document.key] ?? document.key}
            </span>
            <span className="s-caption s-quiet s-numeric">
              Version {document.version}
            </span>
          </li>
        ))}
      </ul>

      {message === undefined ? null : (
        <ErrorMessage testId="creator-policy-error">{message}</ErrorMessage>
      )}

      <Button
        block
        busy={busy}
        data-testid="creator-accept-policies"
        size="lg"
        tone="primary"
        onClick={() => {
          run(async () => {
            const failure = failureMessage(
              await api.acknowledgePolicies(documents),
            );
            setMessage(failure);
            if (failure === undefined) {
              toast.show('Creator access is active.', 'positive');
            }
            creator.reloadAll();
          });
        }}
      >
        Accept and continue
      </Button>
    </Card>
  );
}
