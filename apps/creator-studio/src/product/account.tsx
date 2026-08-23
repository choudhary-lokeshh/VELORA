'use client';

import { useCallback } from 'react';

import type { CreatorMatureReadiness } from '@velora/creator-client';

import {
  Badge,
  BlockedState,
  Button,
  Card,
  CardHead,
  CardSkeleton,
  CreatorAvatar,
  ErrorState,
  InfoRow,
  Notice,
  PageHeader,
} from '../design/primitives';
import { useApi, useCreator, useSession } from '../app/providers';
import {
  creatorStandingLook,
  formatDate,
  matureBlockerLabels,
  standingReasonLabels,
} from './format';
import { useResource } from './resource';

/**
 * The creator's own account, and the facts about it that are not the work.
 *
 * Standing, the session, and what VELORA does not currently allow live here
 * rather than on Home, because none of them is something a creator acts on
 * daily. What is deliberately absent is a notification centre: the notification
 * contract is a consumer-audience one that refuses a Creator Studio credential
 * outright, so there is no creator notification to list and a bell here would
 * be the first fabricated thing on the surface.
 */
export function Account() {
  const creator = useCreator();
  const session = useSession();
  const onboarding = creator.onboarding.value;
  const profile = creator.profile.value;
  const account = onboarding?.account;
  const standing =
    account === undefined ? undefined : creatorStandingLook(account.status);

  return (
    <>
      <PageHeader
        lede="Your creator account, and what it can currently do."
        title="Account"
      />

      <Card testId="account-identity">
        <div className="s-account-identity">
          <CreatorAvatar
            displayName={profile?.displayName ?? 'Your account'}
            seed={profile?.handle ?? 'creator'}
            size="md"
          />
          <div className="s-stack s-stack--1">
            <p className="s-subheading s-wrap">
              {profile?.displayName ?? 'No public name yet'}
            </p>
            <p className="s-small s-quiet s-wrap">
              {profile === undefined
                ? 'You have not claimed a handle.'
                : `@${profile.handle}`}
            </p>
          </div>
        </div>

        <Notice
          testId="account-separate"
          tone="quiet"
          title="Two identities, one account"
        >
          Your creator identity and your ordinary VELORA identity belong to the
          same account but are separate things. What you publish here does not
          change your VELORA profile, and nothing here shows it.
        </Notice>
      </Card>

      <Card testId="account-standing">
        <CardHead
          actions={
            standing === undefined ? undefined : (
              <Badge
                icon={standing.icon}
                testId="creator-standing"
                tone={standing.tone}
              >
                {standing.label}
              </Badge>
            )
          }
          title="Creator access"
        />

        {creator.onboarding.error !== undefined ? (
          <ErrorState
            body={creator.onboarding.error}
            onRetry={
              creator.onboarding.retryable ? creator.reloadAll : undefined
            }
            testId="account-standing-failed"
          />
        ) : account === undefined ? (
          <CardSkeleton rows={2} />
        ) : (
          <>
            {account.statusReason === undefined ? null : (
              <p
                className="s-small s-muted"
                data-testid="creator-standing-reason"
              >
                {standingReasonLabels[account.statusReason] ??
                  'VELORA has restricted this creator account.'}
              </p>
            )}
            <dl className="s-stack">
              <InfoRow
                term="Opened"
                testId="account-created"
                value={formatDate(account.createdAt)}
              />
              {account.activatedAt === undefined ? null : (
                <InfoRow
                  term="Active since"
                  testId="account-activated"
                  value={formatDate(account.activatedAt)}
                />
              )}
              <InfoRow
                term="Creator policies"
                value={
                  onboarding?.outstandingPolicies.length === 0
                    ? 'Accepted'
                    : 'Not accepted'
                }
              />
            </dl>
            <p className="s-caption s-quiet">
              Creator access is not identity verification, payment approval, or
              permission to publish mature content. Each of those is a separate
              decision, and none of them is available on VELORA yet.
            </p>
          </>
        )}
      </Card>

      <MatureContent />

      <Card testId="account-session">
        <CardHead
          lede="Creator Studio sessions are shorter than the ones on VELORA itself, so this ends sooner than you may expect."
          title="This session"
        />
        <Button
          busy={session.busy}
          data-testid="auth-sign-out"
          icon="logOut"
          onClick={session.signOut}
        >
          Sign out
        </Button>
        <p className="s-caption s-quiet">
          This signs you out of Creator Studio on this device. It does not sign
          you out of VELORA.
        </p>
      </Card>
    </>
  );
}

/**
 * Why mature content is unavailable.
 *
 * There is no upload control here and no toggle, because there is nothing a
 * creator could do that would work. What there is instead is the list of what
 * actually stands in the way, each owned by somebody who is not the creator, so
 * nobody is left assuming the remaining work is theirs.
 *
 * The two mobile surfaces are shown separately from the blockers. Both app
 * stores prohibit the content class outright with no published approval path,
 * so their ineligibility is a permanent fact about those surfaces rather than
 * something anybody is working through, and listing it as a blocker would imply
 * otherwise.
 */
function MatureContent() {
  const api = useApi();
  const load = useCallback(async () => api.matureReadiness(), [api]);
  const readiness = useResource<CreatorMatureReadiness>(load);
  const value = readiness.value;

  if (readiness.error !== undefined) {
    return (
      <Card>
        <ErrorState
          body={readiness.error}
          onRetry={readiness.retryable ? readiness.reload : undefined}
          testId="mature-readiness-failed"
        />
      </Card>
    );
  }

  if (value === undefined) {
    return (
      <Card testId="mature-readiness-loading">
        <CardSkeleton rows={3} />
      </Card>
    );
  }

  return (
    <Card testId="mature-readiness-detail">
      <CardHead title="What VELORA does not allow yet" />
      <BlockedState
        label="Not available"
        testId="mature-readiness-state"
        title="Mature content cannot be published on VELORA"
      >
        <p>What stands in the way, none of it yours to finish:</p>
        <ul className="s-bullets" data-testid="mature-blockers">
          {value.blockers.map((blocker) => (
            <li key={blocker}>{matureBlockerLabels[blocker] ?? blocker}</li>
          ))}
        </ul>
        <p data-testid="mature-ineligible-surfaces">
          The iOS and Android apps could never carry it in any case: both stores
          prohibit it outright, with no approval path published.
        </p>
      </BlockedState>
    </Card>
  );
}
