'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';

import type { AccountDetail, WalletDetail } from '../api/contract';
import { ConfirmDialog } from '../design/dialog';
import {
  Badge,
  BlockedState,
  Button,
  EmptyState,
  ErrorState,
  Fact,
  Facts,
  Field,
  PageHeader,
  Panel,
  PanelBody,
  PanelHead,
  PanelSkeleton,
  Reference,
  Scroller,
  Table,
  TextArea,
} from '../design/primitives';
import { useApi, useOperator, useToast } from '../app/providers';
import {
  accountStatusLook,
  formatDateTime,
  humanState,
  shortId,
} from './format';
import { ActivityStream } from './activity';
import { useResource, useSingleFlight } from './resource';

/**
 * One account, in every operational term and none that are not.
 *
 * This is the screen an operator opens when somebody has a problem, and its
 * shape is a privacy decision rather than a layout one. What is here: lifecycle,
 * sessions, devices, live state, safety counts, connection counts, coin
 * position, commerce counts, support counts, where the account came from, and
 * a coherent timeline of what happened to it.
 *
 * What is deliberately absent, and absent in the contract as well as here: the
 * person's name, their biography, their photographs, their languages, their
 * availability, their matching declaration, any message they have sent, the
 * narrative of any report about them, the text of any ticket they opened, and
 * any push token. Every one of those is either reachable through the case,
 * ticket, or moderation record that justifies reading it — which is a different
 * route with a different capability and its own audit — or is not an operator's
 * business at all.
 *
 * The counts are the point. "Four reports name this account" is an operational
 * fact an operator acts on; what a reporter wrote is evidence that belongs with
 * the case it produced.
 */
export function AccountDetailScreen({
  accountId,
}: {
  readonly accountId: string;
}) {
  const api = useApi();
  const operator = useOperator();
  const toast = useToast();
  const load = useCallback(
    async () => api.accountDetail(accountId),
    [accountId, api],
  );
  const mayRead = operator.may('users.read');
  const detail = useResource<AccountDetail>(load, { enabled: mayRead });
  const { busy, run } = useSingleFlight();
  const [revoking, setRevoking] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);

  const revoke = () => {
    const trimmed = reason.trim();
    if (trimmed.length < 8) {
      setReasonError('Say why, in at least eight characters.');
      return;
    }
    run(async () => {
      const result = await api.revokeAccountSessions({
        accountId,
        reason: trimmed,
      });
      setRevoking(false);
      setReason('');
      setReasonError(undefined);
      if (result.kind !== 'ok') {
        toast.show('No session was revoked.', 'critical');
        return;
      }
      detail.reload();
      // What actually happened, in the platform's numbers rather than a "Done".
      toast.show(
        `${String(result.value.sessions)} browser session(s) and ${String(
          result.value.families,
        )} device sign-in(s) ended.`,
        'positive',
      );
    });
  };

  // Fail closed while the standing answer is still in flight, and stay closed
  // when it says this operator may not open a record. The server refuses the
  // read either way; not asking is simply not spending a request to be told so.
  if (!operator.known || !mayRead) return <AccountBlocked />;

  if (detail.missing) {
    return (
      <Panel>
        <PanelBody>
          <EmptyState
            body="No account matches that identifier."
            testId="account-missing"
            title="Not found"
          />
        </PanelBody>
      </Panel>
    );
  }
  if (detail.error !== undefined && detail.value === undefined) {
    return (
      <Panel>
        <PanelBody>
          <ErrorState
            body={detail.error}
            onRetry={detail.retryable ? detail.reload : undefined}
            testId="account-failed"
          />
        </PanelBody>
      </Panel>
    );
  }
  if (detail.value === undefined) return <PanelSkeleton />;

  const account = detail.value;
  const look = accountStatusLook(account.account.status);

  return (
    <>
      <PageHeader
        lede="Operational facts only. No name, photograph, message, report narrative, ticket text, or push token appears on this screen."
        title="Account"
      />

      <Panel testId="account-identity">
        <PanelHead
          actions={<Badge tone={look.tone}>{look.label}</Badge>}
          title={
            <Reference
              short={shortId(account.account.id)}
              testId="account-id"
              value={account.account.id}
            />
          }
        />
        <PanelBody>
          <Facts>
            <Fact
              term="Created"
              value={formatDateTime(account.account.createdAt)}
            />
            <Fact
              term="Status changed"
              value={formatDateTime(account.account.statusChangedAt)}
            />
            <Fact
              term="Reason"
              value={
                account.account.statusReason === undefined
                  ? '—'
                  : humanState(account.account.statusReason)
              }
            />
            <Fact term="Region" value={account.account.region ?? '—'} />
            <Fact
              term="Profile"
              value={account.profileComplete ? 'Completed' : 'Not completed'}
            />
            <Fact
              term="Closure requested"
              value={
                account.account.deletionRequestedAt === undefined
                  ? 'No'
                  : formatDateTime(account.account.deletionRequestedAt)
              }
            />
            <Fact
              term="Arrived via"
              value={
                account.acquisition === undefined
                  ? 'Not recorded'
                  : `${account.acquisition.source}${
                      account.acquisition.viaInvitation ? ' (invitation)' : ''
                    }`
              }
            />
            <Fact
              term="Creator capability"
              value={
                account.creator === undefined ? (
                  'None'
                ) : (
                  <Link href={`/creators?adminSearch=${account.creator.id}`}>
                    {account.creator.handle ?? shortId(account.creator.id)}
                  </Link>
                )
              }
            />
          </Facts>
        </PanelBody>
      </Panel>

      <div className="a-grid a-grid--narrow">
        <Panel testId="account-safety">
          <PanelHead title="Safety" />
          <PanelBody>
            <Facts>
              <Fact term="Reports about" value={account.safety.reportsAbout} />
              <Fact term="Reports made" value={account.safety.reportsMade} />
              <Fact
                term="Blocked by others"
                value={account.safety.blocksReceived}
              />
              <Fact term="Blocks placed" value={account.safety.blocksMade} />
              <Fact term="Appeals" value={account.safety.appeals} />
            </Facts>
            {account.safety.enforcements.length === 0 ? null : (
              <p className="a-caption a-quiet">
                Enforcement:{' '}
                {account.safety.enforcements
                  .map(
                    (row) => `${humanState(row.label)} ×${String(row.total)}`,
                  )
                  .join(', ')}
              </p>
            )}
          </PanelBody>
        </Panel>

        <Panel testId="account-connections">
          <PanelHead title="Connections" />
          <PanelBody>
            <Facts>
              <Fact
                term="Conversations"
                value={account.connections.conversations}
              />
              {account.connections.introductions.map((row) => (
                <Fact
                  key={row.label}
                  term={humanState(row.label)}
                  value={row.total}
                />
              ))}
            </Facts>
          </PanelBody>
        </Panel>

        <Panel testId="account-commerce">
          <PanelHead title="Commerce" />
          <PanelBody>
            <Facts>
              <Fact
                term="Coins available"
                value={account.wallet?.available ?? 'No position'}
              />
              <Fact
                term="Coins reserved"
                value={account.wallet?.reserved ?? '—'}
              />
              {account.commerce.payments.map((row) => (
                <Fact
                  key={`payment-${row.label}`}
                  term={`Payments ${humanState(row.label).toLowerCase()}`}
                  value={row.total}
                />
              ))}
              {account.commerce.subscriptions.map((row) => (
                <Fact
                  key={`subscription-${row.label}`}
                  term={`Memberships ${humanState(row.label).toLowerCase()}`}
                  value={row.total}
                />
              ))}
            </Facts>
          </PanelBody>
        </Panel>

        <Panel testId="account-support">
          <PanelHead title="Support" />
          <PanelBody>
            {account.support.length === 0 ? (
              <EmptyState
                body="This account has never opened a ticket."
                testId="account-support-empty"
                title="No tickets"
              />
            ) : (
              <Facts>
                {account.support.map((row) => (
                  <Fact
                    key={row.label}
                    term={humanState(row.label)}
                    value={row.total}
                  />
                ))}
              </Facts>
            )}
          </PanelBody>
        </Panel>
      </div>

      <Panel testId="account-live">
        <PanelHead
          actions={
            account.live.participation === undefined ? undefined : (
              <Badge tone="positive">
                {humanState(account.live.participation.state)}
              </Badge>
            )
          }
          title="Live"
        />
        {account.live.encounters.length === 0 ? (
          <PanelBody>
            <EmptyState
              body="This account has never been matched."
              testId="account-live-empty"
              title="No encounters"
            />
          </PanelBody>
        ) : (
          <PanelBody flush>
            <Scroller label="Recent encounters">
              <Table>
                <thead>
                  <tr>
                    <th scope="col">Encounter</th>
                    <th scope="col">Medium</th>
                    <th scope="col">Started</th>
                    <th scope="col">Ended</th>
                  </tr>
                </thead>
                <tbody>
                  {account.live.encounters.map((encounter) => (
                    <tr
                      data-testid={`account-encounter-${encounter.id}`}
                      key={encounter.id}
                    >
                      <th scope="row">
                        <Link href={`/platform/live/${encounter.id}`}>
                          {shortId(encounter.id)}
                        </Link>
                      </th>
                      <td>{humanState(encounter.medium)}</td>
                      <td className="a-numeric a-caption a-quiet">
                        {formatDateTime(encounter.startedAt)}
                      </td>
                      <td className="a-caption a-quiet">
                        {encounter.endReason === undefined
                          ? humanState(encounter.state)
                          : humanState(encounter.endReason)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Scroller>
          </PanelBody>
        )}
      </Panel>

      <Panel testId="account-sessions">
        <PanelHead
          actions={
            operator.may('sessions.revoke') ? (
              <Button
                data-testid="account-revoke-sessions"
                onClick={() => {
                  setRevoking(true);
                  setReason('');
                  setReasonError(undefined);
                }}
                size="sm"
                tone="danger"
              >
                Revoke all sessions
              </Button>
            ) : undefined
          }
          title="Sessions and devices"
        />
        <PanelBody flush>
          <Scroller label="Sessions">
            <Table>
              <thead>
                <tr>
                  <th scope="col">Session</th>
                  <th scope="col">Audience</th>
                  <th scope="col">Last active</th>
                  <th scope="col">State</th>
                </tr>
              </thead>
              <tbody>
                {account.sessions.length === 0 ? (
                  <tr>
                    <td colSpan={4}>
                      <span className="a-caption a-quiet">
                        No session has ever been created for this account.
                      </span>
                    </td>
                  </tr>
                ) : (
                  account.sessions.map((session) => (
                    <tr
                      data-testid={`account-session-${session.id}`}
                      key={session.id}
                    >
                      <th scope="row">{shortId(session.id)}</th>
                      <td>{humanState(session.audience)}</td>
                      <td className="a-numeric a-caption a-quiet">
                        {formatDateTime(session.lastActiveAt)}
                      </td>
                      <td>
                        <Badge
                          tone={
                            session.revokedAt === undefined
                              ? 'positive'
                              : 'neutral'
                          }
                        >
                          {session.revokedAt === undefined
                            ? 'Live'
                            : humanState(session.revocationReason ?? 'revoked')}
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </Scroller>
        </PanelBody>
        <PanelBody flush>
          <Scroller label="Push devices">
            <Table>
              <thead>
                <tr>
                  <th scope="col">Device</th>
                  <th scope="col">Platform</th>
                  <th scope="col">Last seen</th>
                  <th scope="col">State</th>
                </tr>
              </thead>
              <tbody>
                {account.devices.length === 0 ? (
                  <tr>
                    <td colSpan={4}>
                      <span className="a-caption a-quiet">
                        No device is registered for notifications.
                      </span>
                    </td>
                  </tr>
                ) : (
                  account.devices.map((device) => (
                    <tr
                      data-testid={`account-device-${device.id}`}
                      key={device.id}
                    >
                      {/* The identifier, never the token. A console with a copy
                          button beside a push credential is a console that
                          eventually leaks one. */}
                      <th scope="row">{shortId(device.id)}</th>
                      <td>{humanState(device.platform)}</td>
                      <td className="a-numeric a-caption a-quiet">
                        {formatDateTime(device.lastSeenAt)}
                      </td>
                      <td>
                        <Badge
                          tone={
                            device.disabledAt === undefined
                              ? 'positive'
                              : 'neutral'
                          }
                        >
                          {device.disabledAt === undefined
                            ? 'Active'
                            : humanState(device.disableReason ?? 'disabled')}
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </Scroller>
        </PanelBody>
      </Panel>

      {operator.may('wallet.read') ? (
        <AccountWallet accountId={accountId} />
      ) : null}

      <ActivityStream subject={accountId} testId="account-timeline" />

      {revoking ? (
        <ConfirmDialog
          busy={busy}
          confirmLabel="Revoke every session"
          onCancel={() => {
            setRevoking(false);
          }}
          onConfirm={revoke}
          testId="account-revoke-confirm"
          title="Sign this account out everywhere"
        >
          <p>
            Every browser session and every signed-in device for this account
            ends immediately. The person can sign in again; nothing about their
            account changes.
          </p>
          <p>This is written to the operator audit with your reason.</p>
          <Field
            error={reasonError}
            hint="At least eight characters. The next operator reads this."
            label="Reason"
          >
            {(control) => (
              <TextArea
                {...control}
                data-testid="account-revoke-reason"
                onChange={(event) => {
                  setReason(event.target.value);
                  setReasonError(undefined);
                }}
                rows={3}
                value={reason}
              />
            )}
          </Field>
        </ConfirmDialog>
      ) : null}
    </>
  );
}

/**
 * One account's coin position and the journal behind it.
 *
 * Both the stored balance and the sum the entries imply are shown, because the
 * operator question that matters is not "what is the balance" but "does the
 * balance follow from what happened". A screen that showed only the first could
 * not answer the second.
 *
 * Amounts are the platform's decimal strings all the way to the browser. A coin
 * balance is an exact integer that outgrows what a JSON number carries safely,
 * and a console that parsed one as a float would eventually show somebody a
 * balance that is wrong and be unable to explain why.
 */
function AccountWallet({ accountId }: { readonly accountId: string }) {
  const api = useApi();
  const load = useCallback(
    async () => api.wallet({ accountId }),
    [accountId, api],
  );
  const wallet = useResource<WalletDetail>(load);

  if (wallet.missing) {
    return (
      <Panel testId="account-wallet">
        <PanelHead title="Coins" />
        <PanelBody>
          <EmptyState
            body="This account has no coin position. Nothing has ever been credited to it."
            testId="account-wallet-empty"
            title="No wallet"
          />
        </PanelBody>
      </Panel>
    );
  }
  if (wallet.error !== undefined && wallet.value === undefined) {
    return (
      <Panel testId="account-wallet">
        <PanelHead title="Coins" />
        <PanelBody>
          <ErrorState
            body={wallet.error}
            onRetry={wallet.retryable ? wallet.reload : undefined}
            testId="account-wallet-failed"
          />
        </PanelBody>
      </Panel>
    );
  }
  if (wallet.value === undefined) return <PanelSkeleton />;

  const agrees =
    wallet.value.entriesTotal ===
    String(BigInt(wallet.value.available) + BigInt(wallet.value.reserved));

  return (
    <Panel testId="account-wallet">
      <PanelHead
        actions={
          <Badge tone={agrees ? 'positive' : 'critical'}>
            {agrees ? 'Balance agrees with journal' : 'Balance disagrees'}
          </Badge>
        }
        title="Coins"
      />
      <PanelBody>
        <Facts>
          <Fact term="Available" value={wallet.value.available} />
          <Fact term="Reserved" value={wallet.value.reserved} />
          <Fact term="Journal total" value={wallet.value.entriesTotal} />
        </Facts>
      </PanelBody>
      <PanelBody flush>
        <Scroller label="Coin ledger">
          <Table>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Reason</th>
                <th scope="col">Direction</th>
                <th className="a-table__right" scope="col">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {wallet.value.entries.length === 0 ? (
                <tr>
                  <td colSpan={4}>
                    <span className="a-caption a-quiet">
                      No coins have ever moved on this account.
                    </span>
                  </td>
                </tr>
              ) : (
                wallet.value.entries.map((entry, index) => (
                  <tr
                    data-testid={`account-ledger-${String(index)}`}
                    key={`${entry.transactionId}-${String(index)}`}
                  >
                    <th className="a-numeric" scope="row">
                      {formatDateTime(entry.occurredAt)}
                    </th>
                    <td>{humanState(entry.reason)}</td>
                    <td>{humanState(entry.direction)}</td>
                    <td className="a-table__right a-numeric">{entry.amount}</td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </Scroller>
      </PanelBody>
    </Panel>
  );
}

/** Shown when the operator lacks the capability to open an account at all. */
function AccountBlocked() {
  return (
    <Panel>
      <PanelBody>
        <BlockedState testId="account-blocked" title="Not your capability">
          Opening an account record needs the <code>users.read</code>{' '}
          capability.
        </BlockedState>
      </PanelBody>
    </Panel>
  );
}
