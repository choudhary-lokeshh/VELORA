'use client';

import { useCallback, useState } from 'react';

import type { ApiResult } from '@velora/api-client';

import type {
  AdminCreator,
  EnforcementReasonCode,
  RemovableObjectType,
} from '../api/contract';
import { failureMessage } from '../api/messages';
import { Dialog } from '../design/dialog';
import {
  Acknowledgement,
  Badge,
  Button,
  EmptyState,
  ErrorMessage,
  ErrorState,
  Fact,
  Facts,
  Field,
  Notice,
  PageHeader,
  Panel,
  PanelBody,
  PanelFoot,
  PanelHead,
  RowSkeleton,
  Scroller,
  Select,
  Table,
  TextInput,
  Toolbar,
} from '../design/primitives';
import { useApi, useToast } from '../app/providers';
import {
  creatorStatusLook,
  enforcementReasonLabels,
  formatDate,
  humanState,
  plural,
  removableObjectLabels,
  shortId,
} from './format';
import { useCollection, useSingleFlight } from './resource';

/**
 * The creator directory, and the enforcement that acts on it.
 *
 * Search is by **handle prefix** and nothing else, because that is what the
 * platform publishes: `adminSearch` matches the start of a public handle. It is
 * not a search over people — there is no name here, no email, no address, and
 * no consumer account — and the field says handle rather than search so nobody
 * types something expecting it to be found.
 *
 * Selecting a creator puts their identifier in the address, so a case that
 * names a target can be followed here and the browser's Back still works. A
 * deep link that names somebody outside the pages loaded says so rather than
 * pretending they do not exist.
 *
 * Every operation on this screen acts on somebody else's business. Each one
 * therefore names its exact target and effect at the moment of confirming,
 * carries a reason the platform publishes rather than free text, and is applied
 * by the owning domain — which may still refuse, and whose refusal is rendered
 * as a refusal.
 */

const creatorPageSize = 25;

export function Creators({
  selectedId,
}: {
  /** The creator named in the address, if any. */
  readonly selectedId: string | undefined;
}) {
  const api = useApi();
  const [handle, setHandle] = useState('');
  const [submitted, setSubmitted] = useState('');

  const load = useCallback(
    async (cursor: string | undefined) => {
      const result = await api.creators({
        ...(submitted.length === 0 ? {} : { adminSearch: submitted }),
        cursor,
        pageSize: creatorPageSize,
      });
      return result.kind === 'ok'
        ? {
            kind: 'ok' as const,
            value: {
              items: result.value.creators,
              nextCursor: result.value.nextCursor,
            },
          }
        : result;
    },
    [api, submitted],
  );
  const creators = useCollection<AdminCreator>(load);
  const selected = creators.items.find((entry) => entry.id === selectedId);

  return (
    <>
      <PageHeader
        lede="Creator business accounts as CREATORS holds them. No consumer account, no name, and no contact detail reaches this console."
        title="Creators"
      />

      <Toolbar>
        <form
          className="a-search"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(handle.trim().toLowerCase());
          }}
        >
          <Field
            hint="Matches the beginning of a public handle. It is the only thing this directory can be searched by."
            label="Handle"
          >
            {(control) => (
              <TextInput
                {...control}
                autoCapitalize="none"
                autoComplete="off"
                data-testid="creator-search"
                onChange={(event) => {
                  setHandle(event.target.value);
                }}
                placeholder="embervale"
                spellCheck={false}
                value={handle}
              />
            )}
          </Field>
          <Button
            data-testid="creator-search-submit"
            icon="search"
            type="submit"
          >
            Search
          </Button>
          {submitted.length === 0 ? null : (
            <Button
              data-testid="creator-search-clear"
              onClick={() => {
                setHandle('');
                setSubmitted('');
              }}
              tone="ghost"
            >
              Clear
            </Button>
          )}
        </form>
      </Toolbar>

      <div className="a-split">
        <Panel testId="creator-list">
          <PanelHead
            actions={
              creators.items.length === 0 ? undefined : (
                <span className="a-caption a-quiet a-numeric">
                  {plural(creators.items.length, 'loaded', 'loaded')}
                  {creators.hasMore ? ', more to come' : ''}
                </span>
              )
            }
            title={
              submitted.length === 0
                ? 'Every creator'
                : `Handles starting “${submitted}”`
            }
          />

          {creators.error !== undefined && creators.items.length === 0 ? (
            <PanelBody>
              <ErrorState
                body={creators.error}
                onRetry={creators.retryable ? creators.reload : undefined}
                testId="creator-list-failed"
              />
            </PanelBody>
          ) : creators.loading && creators.items.length === 0 ? (
            <PanelBody>
              <RowSkeleton rows={5} />
            </PanelBody>
          ) : creators.items.length === 0 ? (
            <PanelBody>
              <EmptyState
                body={
                  submitted.length === 0
                    ? 'No creator account exists on this platform.'
                    : 'No handle starts with that. Only the beginning of a handle is matched.'
                }
                icon="users"
                testId="creator-list-empty"
                title="Nothing to show"
              />
            </PanelBody>
          ) : (
            <PanelBody flush>
              <Scroller label="Creators">
                <Table>
                  <thead>
                    <tr>
                      <th scope="col">Handle</th>
                      <th scope="col">Status</th>
                      <th scope="col">Public page</th>
                      <th scope="col">Opened</th>
                      <th scope="col">
                        <span className="a-visually-hidden">Select</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {creators.items.map((entry) => (
                      <CreatorRow
                        entry={entry}
                        key={entry.id}
                        selected={entry.id === selectedId}
                      />
                    ))}
                  </tbody>
                </Table>
              </Scroller>
            </PanelBody>
          )}

          {creators.hasMore ? (
            <PanelFoot>
              <Button
                block
                busy={creators.loadingMore}
                data-testid="creator-list-more"
                onClick={creators.loadMore}
              >
                Load more
              </Button>
            </PanelFoot>
          ) : null}
        </Panel>

        {selectedId === undefined ? (
          <Panel testId="creator-none-selected">
            <PanelHead title="No creator selected" />
            <PanelBody>
              <p className="a-small a-muted">
                Choose a row to see what the platform holds for that account and
                what may be done to it.
              </p>
            </PanelBody>
          </Panel>
        ) : selected === undefined ? (
          <Panel testId="creator-not-loaded">
            <PanelHead title="Not on the pages loaded" />
            <PanelBody>
              <p className="a-small a-muted">
                The address names{' '}
                <span className="a-mono">{shortId(selectedId)}</span>, which is
                not among the creators loaded here. Search by handle, or load
                more of the directory.
              </p>
            </PanelBody>
          </Panel>
        ) : (
          <CreatorDetail creator={selected} onChanged={creators.reload} />
        )}
      </div>
    </>
  );
}

function CreatorRow({
  entry,
  selected,
}: {
  readonly entry: AdminCreator;
  readonly selected: boolean;
}) {
  const status = creatorStatusLook(entry.status);
  return (
    <tr data-testid={`creator-${entry.id}`}>
      <td>
        <a
          className="a-table__link"
          href={`/creators?selected=${encodeURIComponent(entry.id)}`}
        >
          {entry.handle === undefined ? (
            <span className="a-quiet">no handle claimed</span>
          ) : (
            `@${entry.handle}`
          )}
        </a>
      </td>
      <td>
        <Badge
          icon={status.icon}
          testId={`creator-status-${entry.id}`}
          tone={status.tone}
        >
          {status.label}
        </Badge>
      </td>
      <td className="a-quiet">
        {entry.profilePublished ? 'Published' : 'Not published'}
      </td>
      <td className="a-numeric a-quiet">{formatDate(entry.createdAt)}</td>
      <td className="a-table__right">
        {selected ? (
          <Badge tone="accent">Selected</Badge>
        ) : (
          <span className="a-visually-hidden">Not selected</span>
        )}
      </td>
    </tr>
  );
}

/* =============================== Detail ============================== */

type Operation =
  | { readonly kind: 'suspend' }
  | { readonly kind: 'reinstate' }
  | { readonly kind: 'membership' }
  | { readonly kind: 'object' };

function CreatorDetail({
  creator,
  onChanged,
}: {
  readonly creator: AdminCreator;
  readonly onChanged: () => void;
}) {
  const [operation, setOperation] = useState<Operation | undefined>(undefined);
  const status = creatorStatusLook(creator.status);

  return (
    <div className="a-stack a-stack--5">
      <Panel testId="creator-detail">
        <PanelHead
          actions={
            <Badge
              icon={status.icon}
              testId="creator-detail-status"
              tone={status.tone}
            >
              {status.label}
            </Badge>
          }
          title={
            creator.handle === undefined
              ? 'No handle claimed'
              : `@${creator.handle}`
          }
        />
        <PanelBody>
          <Facts>
            <Fact
              term="Account"
              testId="creator-detail-id"
              value={<span className="a-mono">{creator.id}</span>}
            />
            <Fact term="Opened" value={formatDate(creator.createdAt)} />
            {creator.activatedAt === undefined ? null : (
              <Fact
                term="Active since"
                value={formatDate(creator.activatedAt)}
              />
            )}
            {creator.suspendedAt === undefined ? null : (
              <Fact
                term="Suspended"
                testId="creator-detail-suspended"
                value={formatDate(creator.suspendedAt)}
              />
            )}
            {creator.statusReason === undefined ? null : (
              <Fact term="Reason" value={humanState(creator.statusReason)} />
            )}
            <Fact
              term="Public page"
              value={creator.profilePublished ? 'Published' : 'Not published'}
            />
          </Facts>
          <p className="a-caption a-quiet">
            This is everything the platform publishes about a creator to an
            operator. There is no catalog, no club list, no member, and no
            consumer account behind it.
          </p>
        </PanelBody>
      </Panel>

      <Panel testId="creator-operations">
        <PanelHead
          lede="Each is applied by the owning domain with your session and a reason, and each is kept on the enforcement record."
          title="Operations"
        />
        <PanelBody>
          {creator.status === 'suspended' ? (
            <Button
              block
              data-testid="creator-reinstate"
              icon="undo"
              onClick={() => {
                setOperation({ kind: 'reinstate' });
              }}
            >
              Lift the suspension
            </Button>
          ) : (
            <Button
              block
              data-testid="creator-suspend"
              icon="ban"
              onClick={() => {
                setOperation({ kind: 'suspend' });
              }}
              tone="danger"
            >
              Suspend this creator
            </Button>
          )}

          <Button
            block
            data-testid="creator-remove-object"
            onClick={() => {
              setOperation({ kind: 'object' });
            }}
          >
            Remove something they published
          </Button>

          <Button
            block
            data-testid="creator-revoke-membership"
            onClick={() => {
              setOperation({ kind: 'membership' });
            }}
          >
            Revoke a club membership
          </Button>

          <Notice testId="creator-operations-note" tone="quiet">
            There is no control here that edits a creator's own content, price,
            or profile. An operator removes or restricts; only the creator
            writes.
          </Notice>
        </PanelBody>
      </Panel>

      {operation === undefined ? null : (
        <OperationDialog
          creator={creator}
          onClose={() => {
            setOperation(undefined);
          }}
          onDone={() => {
            setOperation(undefined);
            onChanged();
          }}
          operation={operation}
        />
      )}
    </div>
  );
}

const operationTitles: Readonly<Record<Operation['kind'], string>> = {
  membership: 'Revoke a club membership',
  object: 'Remove something this creator published',
  reinstate: 'Lift this suspension',
  suspend: 'Suspend this creator',
};

/**
 * One privileged operation, confirmed with everything the record will keep.
 *
 * The exact target and the exact effect are on the screen at the moment of
 * confirming, which `docs/design/06-screen-state-requirements.md` requires and
 * which matters most here: this is the only place in the product where a
 * control takes something away from somebody who is not the person pressing it.
 */
function OperationDialog({
  creator,
  onClose,
  onDone,
  operation,
}: {
  readonly creator: AdminCreator;
  readonly onClose: () => void;
  readonly onDone: () => void;
  readonly operation: Operation;
}) {
  const api = useApi();
  const toast = useToast();
  const { busy, run } = useSingleFlight();
  const [reasonCode, setReasonCode] =
    useState<EnforcementReasonCode>('platform_integrity');
  const [membershipId, setMembershipId] = useState('');
  const [objectType, setObjectType] =
    useState<RemovableObjectType>('creator_profile');
  const [objectId, setObjectId] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);

  const needsObjectId = objectType !== 'creator_profile';
  const blocked =
    !acknowledged ||
    (operation.kind === 'membership' && membershipId.trim().length === 0) ||
    (operation.kind === 'object' &&
      needsObjectId &&
      objectId.trim().length === 0);

  const submit = () => {
    run(async () => {
      let result: ApiResult<unknown>;
      switch (operation.kind) {
        case 'suspend': {
          result = await api.suspendCreator({
            creatorId: creator.id,
            reasonCode,
          });
          break;
        }
        case 'reinstate': {
          result = await api.reinstateCreator({
            creatorId: creator.id,
            reasonCode,
          });
          break;
        }
        case 'membership': {
          result = await api.revokeClubMembership({
            creatorId: creator.id,
            membershipId: membershipId.trim(),
            reasonCode,
          });
          break;
        }
        default: {
          result = await api.removeCreatorObject({
            creatorId: creator.id,
            ...(needsObjectId ? { objectId: objectId.trim() } : {}),
            objectType,
            reasonCode,
          });
        }
      }
      const failure = failureMessage(result, {
        conflict:
          'This account changed since the page read it. Nothing was applied. Reload and look at the current state.',
      });
      setMessage(failure);
      if (failure === undefined) {
        toast.show('The owning domain applied it and recorded it.', 'positive');
        onDone();
      }
    });
  };

  return (
    <Dialog
      onClose={onClose}
      testId="operation-dialog"
      title={operationTitles[operation.kind]}
    >
      <p className="a-small a-muted">
        Target{' '}
        <span className="a-mono">
          {creator.handle === undefined
            ? shortId(creator.id)
            : `@${creator.handle}`}
        </span>
        .{' '}
        {operation.kind === 'suspend'
          ? 'Their public page comes down, their catalog stops being reachable, and they can no longer publish. Anything they made stays theirs.'
          : operation.kind === 'reinstate'
            ? 'They can publish again. Nothing that was taken down comes back on its own.'
            : operation.kind === 'membership'
              ? 'One person loses access to one club immediately. They are not told who decided it.'
              : 'The object stops being reachable to everybody. The creator keeps the record of it.'}
      </p>

      {message === undefined ? null : (
        <ErrorMessage testId="operation-error">{message}</ErrorMessage>
      )}

      <div className="a-stack a-stack--4">
        {operation.kind === 'object' ? (
          <>
            <Field label="What to remove">
              {(control) => (
                <Select
                  {...control}
                  data-testid="operation-object-type"
                  onChange={(event) => {
                    setObjectType(event.target.value as RemovableObjectType);
                  }}
                  value={objectType}
                >
                  {Object.entries(removableObjectLabels).map(
                    ([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ),
                  )}
                </Select>
              )}
            </Field>
            {needsObjectId ? (
              <Field
                hint="Paste the identifier you already hold. There is no browsing surface over a creator's catalog here."
                label="Object"
              >
                {(control) => (
                  <TextInput
                    {...control}
                    data-testid="operation-object-id"
                    onChange={(event) => {
                      setObjectId(event.target.value);
                    }}
                    spellCheck={false}
                    value={objectId}
                  />
                )}
              </Field>
            ) : null}
          </>
        ) : null}

        {operation.kind === 'membership' ? (
          <Field
            hint="Paste the membership identifier you already hold. This console does not list who is in a club."
            label="Membership"
          >
            {(control) => (
              <TextInput
                {...control}
                data-testid="operation-membership-id"
                onChange={(event) => {
                  setMembershipId(event.target.value);
                }}
                spellCheck={false}
                value={membershipId}
              />
            )}
          </Field>
        ) : null}

        <Field
          hint="A category the platform publishes. It is recorded and it is not free text."
          label="Reason"
        >
          {(control) => (
            <Select
              {...control}
              data-testid="operation-reason"
              onChange={(event) => {
                setReasonCode(event.target.value as EnforcementReasonCode);
              }}
              value={reasonCode}
            >
              {(
                [
                  'underage_risk',
                  'harassment',
                  'sexual_content_violation',
                  'impersonation',
                  'spam_or_scam',
                  'platform_integrity',
                ] as const
              ).map((value) => (
                <option key={value} value={value}>
                  {enforcementReasonLabels[value]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Acknowledgement
          checked={acknowledged}
          onChange={setAcknowledged}
          testId="operation-acknowledge"
        >
          I am acting on {shortId(creator.id)} with my own session, and this is
          kept on the enforcement record.
        </Acknowledgement>
      </div>

      <div className="a-dialog__actions">
        <Button disabled={busy} onClick={onClose} tone="ghost">
          Cancel
        </Button>
        <Button
          busy={busy}
          data-testid="operation-submit"
          disabled={blocked}
          onClick={submit}
          tone={operation.kind === 'reinstate' ? 'primary' : 'danger'}
        >
          {operationTitles[operation.kind]}
        </Button>
      </div>
    </Dialog>
  );
}
