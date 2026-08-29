'use client';

import { useCallback, useState } from 'react';

import type { AdminAccount, AdminAccountList } from '../api/contract';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Notice,
  PageHeader,
  Panel,
  PanelBody,
  PanelFoot,
  PanelHead,
  Reference,
  RowSkeleton,
  Scroller,
  Segmented,
  Table,
  Toolbar,
} from '../design/primitives';
import { useApi } from '../app/providers';
import {
  accountStatusLook,
  accountStatusReasonLabels,
  formatDate,
  humanState,
  plural,
  shortId,
  totalOf,
} from './format';
import { useCollection } from './resource';

/**
 * Consumer accounts, bounded to the ones the platform has decided about.
 *
 * This screen exists because a Trust & Safety operator has to be able to see
 * who is under restriction, why, and since when — and until now this console
 * could act on a consumer account through a case and never look at one.
 *
 * **It is deliberately not a directory of everybody.** With no status chosen,
 * the platform answers with the accounts it has itself decided are not in good
 * standing: restricted, awaiting deletion, deactivated, erased. That is an
 * enforcement work list bounded by the platform's own decisions rather than by
 * whatever somebody types, which is the difference between an operations tool
 * and a browsing surface over private material. Choosing a status widens it to
 * that status — including `active` — because an operator sometimes has to
 * confirm that an account they hold an identifier for is fine, and the counts
 * beside the list make the size of what they are asking for obvious.
 *
 * **Nothing here publishes a person.** No name, no handle, no contact detail,
 * no profile, no photograph, and no locale — the contract does not carry them.
 * Region is here because it is jurisdiction, and an operator deciding whether a
 * restriction may be lifted needs it.
 *
 * The reason is USERS' coarse vocabulary and stays coarse. The finding behind a
 * safety restriction lives with the enforcement record and reaches an operator
 * through the case that produced it, beside the evidence — which is the only
 * place it can honestly be read.
 */

const accountPageSize = 25;

type StatusFilter =
  | 'attention'
  | 'active'
  | 'pending_profile'
  | 'restricted'
  | 'deletion_pending';

const statusOptions: readonly { label: string; value: StatusFilter }[] = [
  { label: 'Needs attention', value: 'attention' },
  { label: 'Restricted', value: 'restricted' },
  { label: 'Deletion pending', value: 'deletion_pending' },
  { label: 'Pending profile', value: 'pending_profile' },
  { label: 'Active', value: 'active' },
];

export function Accounts() {
  const api = useApi();
  const [status, setStatus] = useState<StatusFilter>('attention');

  const load = useCallback(
    async (cursor: string | undefined) => {
      const result = await api.accounts({
        cursor,
        pageSize: accountPageSize,
        ...(status === 'attention' ? {} : { status }),
      });
      return result.kind === 'ok'
        ? {
            kind: 'ok' as const,
            value: {
              items: result.value.accounts,
              meta: result.value,
              nextCursor: result.value.nextCursor,
            },
          }
        : result;
    },
    [api, status],
  );
  const accounts = useCollection<AdminAccount, AdminAccountList>(load);
  const counts = accounts.meta?.statusCounts ?? [];

  return (
    <>
      <PageHeader
        lede="Consumer accounts as USERS holds them. No name, no handle, and no contact detail reaches this console."
        title="Accounts"
      />

      <Toolbar testId="accounts-filter">
        <Segmented
          label="Filter by account status"
          onChange={setStatus}
          options={statusOptions}
          value={status}
        />
      </Toolbar>

      {/*
        The denominator. A work list of four restricted accounts means something
        different on a platform of forty and on one of forty thousand, and the
        list alone cannot say which this is.
      */}
      <Panel testId="accounts-population">
        <PanelHead
          actions={
            counts.length === 0 ? undefined : (
              <span className="a-caption a-quiet a-numeric">
                {plural(totalOf(counts), 'account', 'accounts')}
              </span>
            )
          }
          lede="Every consumer account on the platform, by the standing USERS publishes for it."
          title="The whole population"
        />
        {counts.length === 0 ? (
          <PanelBody>
            <p
              className="a-small a-muted"
              data-testid="accounts-population-empty"
            >
              No account exists in this environment yet.
            </p>
          </PanelBody>
        ) : (
          <PanelBody flush>
            <Scroller label="Accounts by standing">
              <Table>
                <thead>
                  <tr>
                    <th scope="col">Standing</th>
                    <th className="a-table__right" scope="col">
                      Accounts
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {counts.map((row) => (
                    <tr key={row.state}>
                      <td>{accountStatusLook(row.state).label}</td>
                      <td className="a-table__right a-numeric">
                        <span data-testid={`accounts-count-${row.state}`}>
                          {row.count}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Scroller>
          </PanelBody>
        )}
      </Panel>

      <Panel testId="account-list">
        <PanelHead
          actions={
            accounts.items.length === 0 ? undefined : (
              <span className="a-caption a-quiet a-numeric">
                {plural(
                  accounts.items.length,
                  'account loaded',
                  'accounts loaded',
                )}
                {accounts.hasMore ? ', more to come' : ''}
              </span>
            )
          }
          lede={
            status === 'attention'
              ? 'Every account the platform has decided is not in good standing, newest first.'
              : 'Accounts in the standing you asked for, newest first.'
          }
          title={status === 'attention' ? 'Needs attention' : 'Accounts'}
        />

        {accounts.error !== undefined && accounts.items.length === 0 ? (
          <PanelBody>
            <ErrorState
              body={accounts.error}
              onRetry={accounts.retryable ? accounts.reload : undefined}
              testId="account-list-failed"
            />
          </PanelBody>
        ) : accounts.loading && accounts.items.length === 0 ? (
          <PanelBody>
            <RowSkeleton rows={5} />
          </PanelBody>
        ) : accounts.items.length === 0 ? (
          <PanelBody>
            <EmptyState
              body={
                status === 'attention'
                  ? 'No account is restricted, awaiting deletion, deactivated, or erased.'
                  : 'No account is in that standing.'
              }
              testId="account-list-empty"
              title={
                status === 'attention'
                  ? 'Nothing needs attention'
                  : 'Nothing in that standing'
              }
            />
          </PanelBody>
        ) : (
          <PanelBody flush>
            <Scroller label="Accounts">
              <Table>
                <thead>
                  <tr>
                    <th scope="col">Account</th>
                    <th scope="col">Standing</th>
                    <th scope="col">Reason</th>
                    <th scope="col">Region</th>
                    <th scope="col">Opened</th>
                    <th scope="col">Standing changed</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.items.map((account) => (
                    <AccountRow account={account} key={account.id} />
                  ))}
                </tbody>
              </Table>
            </Scroller>
          </PanelBody>
        )}

        {accounts.hasMore ? (
          <PanelFoot>
            <Button
              block
              busy={accounts.loadingMore}
              data-testid="account-list-more"
              onClick={accounts.loadMore}
            >
              Load more
            </Button>
          </PanelFoot>
        ) : null}
      </Panel>

      <Notice icon="lock" testId="accounts-no-actions" title="What is not here">
        There is no operation on a consumer account anywhere on this screen.
        Restricting one and letting it back in are TRUST &amp; SAFETY decisions
        that carry a case, a reason, an appeal path, and a record, so they are
        taken on the case that produced them and nowhere else. There is also no
        search, no export, and no way to reach a profile, a photograph, or a
        message from here.
      </Notice>
    </>
  );
}

function AccountRow({ account }: { readonly account: AdminAccount }) {
  const standing = accountStatusLook(account.status);
  return (
    <tr data-testid={`account-${account.id}`}>
      <td>
        <Reference
          short={shortId(account.id)}
          testId={`account-${account.id}-reference`}
          value={account.id}
        />
      </td>
      <td>
        <Badge
          icon={standing.icon}
          testId={`account-${account.id}-status`}
          tone={standing.tone}
        >
          {standing.label}
        </Badge>
      </td>
      <td>
        {account.statusReason === undefined ? (
          <span className="a-quiet">—</span>
        ) : (
          (accountStatusReasonLabels[account.statusReason] ??
          humanState(account.statusReason))
        )}
      </td>
      <td>
        {account.region === undefined ? (
          <span className="a-quiet">Not stated</span>
        ) : (
          <span className="a-mono">{account.region}</span>
        )}
      </td>
      <td className="a-numeric a-quiet">{formatDate(account.createdAt)}</td>
      <td className="a-numeric a-quiet">
        {formatDate(account.statusChangedAt)}
      </td>
    </tr>
  );
}
