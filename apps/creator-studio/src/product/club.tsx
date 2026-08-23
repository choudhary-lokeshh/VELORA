'use client';

import { useCallback, useEffect, useState } from 'react';

import type {
  ClubInviteList,
  CreatorClub,
  CreatorContent,
} from '@velora/creator-client';
import { failureMessage, isOk } from '@velora/creator-client';

import { ConfirmDialog } from '../design/dialog';
import { Icon } from '../design/icons';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHead,
  CardSkeleton,
  Chip,
  EmptyState,
  ErrorMessage,
  ErrorState,
  Field,
  IconButton,
  ListRow,
  Metric,
  Notice,
  PageHeader,
  RowSkeleton,
  TextArea,
  TextInput,
} from '../design/primitives';
import { useApi, useCreator, useToast } from '../app/providers';
import {
  clubLifecycleLook,
  clubLifecycleMeaning,
  contentLifecycleLook,
  formatDate,
  formatDateTime,
  formatRemaining,
  hasExpired,
  membershipSourceLabels,
  plural,
} from './format';
import { clubDescriptionMaximum, clubNameBounds } from './clubs';
import { useCollection, useResource, useSingleFlight } from './resource';

/**
 * One club, and everything the creator may know about it.
 *
 * What a creator sees here is the shape of their own access control: how many
 * people currently hold access, where each of those grants came from, and which
 * invitations are still live. What they never see is who those people are.
 * There is no name, no identifier, and no behaviour on this screen, because
 * member privacy is not a setting a creator turns off — the contract does not
 * publish it and this surface does not ask.
 */

const lookupPageSize = 50;
const lookupPageLimit = 20;
const memberPageSize = 25;

export function ClubScreen({ clubId }: { readonly clubId: string }) {
  const api = useApi();
  const [pages, setPages] = useState(1);

  const load = useCallback(
    async (cursor: string | undefined) => {
      const result = await api.clubs({ cursor, pageSize: lookupPageSize });
      return result.kind === 'ok'
        ? {
            kind: 'ok' as const,
            value: {
              items: result.value.clubs,
              nextCursor: result.value.nextCursor,
            },
          }
        : result;
    },
    [api],
  );
  const clubs = useCollection<CreatorClub>(load);
  const club = clubs.items.find((entry) => entry.id === clubId);
  const exhausted = !clubs.hasMore || pages >= lookupPageLimit;
  const { loadMore, loading, loadingMore } = clubs;
  const found = club !== undefined;

  useEffect(() => {
    if (found || exhausted || loading || loadingMore) return;
    setPages((count) => count + 1);
    loadMore();
  }, [exhausted, found, loadMore, loading, loadingMore]);

  if (clubs.error !== undefined && club === undefined) {
    return (
      <>
        <PageHeader title="Club" />
        <Card>
          <ErrorState
            body={clubs.error}
            onRetry={clubs.retryable ? clubs.reload : undefined}
            testId="club-lookup-failed"
          />
        </Card>
      </>
    );
  }

  if (club === undefined && (!clubs.settled || !exhausted)) {
    return (
      <>
        <PageHeader title="Club" />
        <Card testId="club-lookup-loading">
          <CardSkeleton rows={5} />
        </Card>
      </>
    );
  }

  if (club === undefined) {
    return (
      <>
        <PageHeader title="Club" />
        <Card>
          <EmptyState
            actions={
              <ButtonLink href="/clubs" tone="primary">
                Back to your clubs
              </ButtonLink>
            }
            body="It may have been closed, or the address may be wrong. Nothing was changed."
            icon="users"
            testId="club-not-found"
            title="That club is not one of yours"
          />
        </Card>
      </>
    );
  }

  return <ClubDetail club={club} onChanged={clubs.reload} />;
}

function ClubDetail({
  club,
  onChanged,
}: {
  readonly club: CreatorClub;
  readonly onChanged: () => void;
}) {
  const creator = useCreator();
  const lifecycle = clubLifecycleLook(club.lifecycle);
  const closed = club.lifecycle === 'closed';
  const editable = creator.canWrite && !closed;

  return (
    <>
      <PageHeader
        eyebrow="Private clubs"
        lede={clubLifecycleMeaning[club.lifecycle]}
        title={club.name}
      />

      <div className="s-inline s-inline--tight">
        <Badge
          icon={lifecycle.icon}
          testId="club-lifecycle"
          tone={lifecycle.tone}
        >
          {lifecycle.label}
        </Badge>
        <Chip icon="link">/{club.slug}</Chip>
        <span className="s-caption s-quiet">
          Created {formatDate(club.createdAt)}
        </span>
      </div>

      {closed ? (
        <Notice testId="club-closed" title="This club is closed" tone="quiet">
          Nobody can be admitted and nothing here can be changed. Anything you
          published to it is still yours.
        </Notice>
      ) : null}

      <div className="s-split">
        <div className="s-stack s-stack--6">
          <ClubAccess club={club} editable={editable} />
          <ClubInvitations club={club} editable={editable} />
          <ClubContent club={club} />
        </div>

        <div className="s-stack s-stack--6">
          <Card testId="club-summary">
            <CardHead
              lede="Counted from live entitlements, every time this page is read."
              title="Access right now"
            />
            <Metric
              caption="people who currently hold access"
              testId="club-member-count"
              value={club.memberCount}
            />
          </Card>

          <ClubLifecycle club={club} onChanged={onChanged} />
          {closed ? null : <ClubSettings club={club} onChanged={onChanged} />}
        </div>
      </div>
    </>
  );
}

/* ============================= Lifecycle ============================= */

function ClubLifecycle({
  club,
  onChanged,
}: {
  readonly club: CreatorClub;
  readonly onChanged: () => void;
}) {
  const api = useApi();
  const creator = useCreator();
  const toast = useToast();
  const { busy, run } = useSingleFlight();
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [confirmingClose, setConfirmingClose] = useState(false);

  if (!creator.canWrite || club.lifecycle === 'closed') return null;

  const setLifecycle = (
    lifecycle: 'draft' | 'published' | 'closed',
    confirmation: string,
  ) => {
    run(async () => {
      const failure = failureMessage(
        await api.setClubLifecycle({
          clubId: club.id,
          lifecycle,
          version: club.version,
        }),
        {
          conflict:
            'This club changed somewhere else since this page was loaded. Reload and try again.',
        },
      );
      setMessage(failure);
      if (failure === undefined) toast.show(confirmation, 'positive');
      onChanged();
    });
  };

  return (
    <Card testId="club-lifecycle-actions">
      <CardHead
        lede={
          club.lifecycle === 'published'
            ? 'Your club is listed on your public page. People still only get in by invitation.'
            : 'Nobody can see this club or be admitted to it.'
        }
        title="Visibility"
      />
      {message === undefined ? null : (
        <ErrorMessage testId="club-lifecycle-error">{message}</ErrorMessage>
      )}
      <div className="s-inline s-inline--tight">
        {club.lifecycle === 'draft' ? (
          <Button
            busy={busy}
            data-testid="club-publish"
            onClick={() => {
              setLifecycle('published', 'Club published.');
            }}
            tone="primary"
          >
            Publish
          </Button>
        ) : (
          <Button
            busy={busy}
            data-testid="club-unpublish"
            onClick={() => {
              setLifecycle('draft', 'Club is a draft again.');
            }}
          >
            Return to draft
          </Button>
        )}
        <Button
          data-testid="club-close"
          disabled={busy}
          onClick={() => {
            setConfirmingClose(true);
          }}
          tone="ghost"
        >
          Close permanently
        </Button>
      </div>

      {confirmingClose ? (
        <ConfirmDialog
          busy={busy}
          confirmLabel="Close it permanently"
          onCancel={() => {
            setConfirmingClose(false);
          }}
          onConfirm={() => {
            setConfirmingClose(false);
            setLifecycle('closed', 'Club closed.');
          }}
          testId="club-close-confirm"
          title={`Close “${club.name}”?`}
        >
          <p>
            Nobody will be admitted again, no new invitation can be issued, and
            this cannot be undone.
          </p>
          <p>
            {club.memberCount === 0
              ? 'Nobody currently holds access to it.'
              : `${plural(club.memberCount, 'person currently holds', 'people currently hold')} access.`}
          </p>
        </ConfirmDialog>
      ) : null}
    </Card>
  );
}

/**
 * The club's own details.
 *
 * The address is absent rather than disabled. It is fixed at creation because
 * it appears in links other people keep, and a greyed-out field invites
 * somebody to look for the setting that would enable it.
 */
function ClubSettings({
  club,
  onChanged,
}: {
  readonly club: CreatorClub;
  readonly onChanged: () => void;
}) {
  const api = useApi();
  const creator = useCreator();
  const toast = useToast();
  const { busy, run } = useSingleFlight();
  const [name, setName] = useState(club.name);
  const [description, setDescription] = useState(club.description ?? '');
  const [touched, setTouched] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);

  const version = club.version;
  useEffect(() => {
    setName(club.name);
    setDescription(club.description ?? '');
  }, [club, version]);

  if (!creator.canWrite) return null;

  const trimmedName = name.trim();
  const nameError =
    !touched || trimmedName.length >= clubNameBounds.minimum
      ? undefined
      : 'Give the club a name of at least two characters.';
  const blocked =
    trimmedName.length < clubNameBounds.minimum ||
    description.length > clubDescriptionMaximum;
  const changed =
    trimmedName !== club.name ||
    description.trim() !== (club.description ?? '');

  return (
    <Card testId="club-settings">
      <CardHead title="Details" />
      {message === undefined ? null : (
        <ErrorMessage testId="club-settings-error">{message}</ErrorMessage>
      )}
      <form
        className="s-stack s-stack--5"
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (blocked) return;
          run(async () => {
            const failure = failureMessage(
              await api.saveClub({
                clubId: club.id,
                ...(description.trim().length === 0
                  ? {}
                  : { description: description.trim() }),
                name: trimmedName,
                slug: club.slug,
                version: club.version,
              }),
              {
                conflict:
                  'This club changed somewhere else since this page was loaded. Reload and try again.',
              },
            );
            setMessage(failure);
            if (failure === undefined) toast.show('Saved.', 'positive');
            onChanged();
          });
        }}
      >
        <Field
          count={{
            length: trimmedName.length,
            maximum: clubNameBounds.maximum,
          }}
          error={nameError}
          label="Name"
        >
          {(control) => (
            <TextInput
              {...control}
              data-testid="club-edit-name"
              maxLength={clubNameBounds.maximum}
              name="name"
              onChange={(event) => {
                setName(event.target.value);
              }}
              value={name}
            />
          )}
        </Field>

        <Field
          count={{
            length: description.length,
            maximum: clubDescriptionMaximum,
          }}
          hint="What somebody is joining. It appears on your public page."
          label="Description"
          optional
        >
          {(control) => (
            <TextArea
              {...control}
              data-testid="club-edit-description"
              maxLength={clubDescriptionMaximum}
              name="description"
              onChange={(event) => {
                setDescription(event.target.value);
              }}
              rows={3}
              value={description}
            />
          )}
        </Field>

        <div className="s-form-actions">
          <Button
            busy={busy}
            data-testid="club-save"
            disabled={!changed}
            tone="primary"
            type="submit"
          >
            Save changes
          </Button>
          {changed ? (
            <span className="s-caption s-quiet" data-testid="club-unsaved">
              You have unsaved changes.
            </span>
          ) : null}
        </div>
        <p className="s-field__hint">
          The address /{club.slug} is fixed, because other people already have
          links that use it.
        </p>
      </form>
    </Card>
  );
}

/* =============================== Access ============================== */

/**
 * Who holds access, without saying who anybody is.
 *
 * A creator sees how many grants are live, where each came from, and when it
 * was made, and can withdraw one. There is deliberately no name, handle, or
 * identifier: the contract publishes none, and a surface that displayed one
 * would be the place a member privacy decision quietly got made.
 */
function ClubAccess({
  club,
  editable,
}: {
  readonly club: CreatorClub;
  readonly editable: boolean;
}) {
  const api = useApi();
  const toast = useToast();
  const { busy, run } = useSingleFlight();
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [confirming, setConfirming] = useState<string | undefined>(undefined);

  const load = useCallback(
    async (cursor: string | undefined) => {
      const result = await api.clubMembers(club.id, {
        cursor,
        pageSize: memberPageSize,
      });
      return result.kind === 'ok'
        ? {
            kind: 'ok' as const,
            value: {
              items: result.value.memberships,
              nextCursor: result.value.nextCursor,
            },
          }
        : result;
    },
    [api, club.id],
  );
  const members = useCollection(load);
  const live = members.items.filter((entry) => entry.state === 'active');

  return (
    <Card flush testId="club-access">
      <CardHead
        lede="Everyone here was admitted by an invitation you issued. VELORA does not tell you who they are."
        title="Access"
      />

      {message === undefined ? null : (
        <div className="s-card__pad">
          <ErrorMessage testId="club-access-error">{message}</ErrorMessage>
        </div>
      )}

      {members.error !== undefined && members.items.length === 0 ? (
        <ErrorState
          body={members.error}
          onRetry={members.retryable ? members.reload : undefined}
          testId="club-members-failed"
        />
      ) : members.loading && members.items.length === 0 ? (
        <RowSkeleton rows={2} />
      ) : live.length === 0 ? (
        <EmptyState
          body="Issue an invitation below and whoever holds it is admitted once."
          icon="users"
          testId="club-no-members"
          title="Nobody has access yet"
        />
      ) : (
        <ul className="s-list">
          {live.map((entry) => (
            <li key={entry.id}>
              <ListRow
                aside={
                  editable ? (
                    <Button
                      data-testid={`club-revoke-${entry.id}`}
                      disabled={busy}
                      onClick={() => {
                        setConfirming(entry.id);
                      }}
                      size="sm"
                      tone="ghost"
                    >
                      Withdraw
                    </Button>
                  ) : undefined
                }
              >
                <span
                  className="s-subheading"
                  data-testid={`club-member-source-${entry.id}`}
                >
                  {membershipSourceLabels[entry.source] ?? 'Admitted by VELORA'}
                </span>
                <span className="s-caption s-quiet">
                  Since {formatDate(entry.grantedAt)}
                </span>
              </ListRow>
            </li>
          ))}
        </ul>
      )}

      {members.hasMore ? (
        <div className="s-card__pad s-card__pad--block">
          <Button
            block
            busy={members.loadingMore}
            data-testid="club-members-more"
            onClick={members.loadMore}
          >
            Load more
          </Button>
        </div>
      ) : null}

      {confirming === undefined ? null : (
        <ConfirmDialog
          busy={busy}
          confirmLabel="Withdraw access"
          onCancel={() => {
            setConfirming(undefined);
          }}
          onConfirm={() => {
            const membershipId = confirming;
            setConfirming(undefined);
            run(async () => {
              const failure = failureMessage(
                await api.revokeClubMembership({
                  clubId: club.id,
                  membershipId,
                }),
              );
              setMessage(failure);
              if (failure === undefined)
                toast.show('Access withdrawn.', 'positive');
              members.reload();
            });
          }}
          testId="club-revoke-confirm"
          title="Withdraw this person's access?"
        >
          <p>
            They lose access to {club.name} and to anything you have published
            to it. You can issue them a new invitation later.
          </p>
        </ConfirmDialog>
      )}
    </Card>
  );
}

/* ============================ Invitations ============================ */

/**
 * Invitations, treated as the bearer secrets they are.
 *
 * The secret exists in exactly one place for exactly as long as it takes to
 * copy it: the server does not store it, this surface does not persist it, and
 * nothing writes it to the console or to a diagnostic. It is masked until
 * somebody asks to see it, because the most likely place an invitation leaks is
 * a shoulder or a screen share.
 *
 * The listing that follows never carries a secret. It carries only what the
 * contract publishes about an invitation: when it was made, when it expires,
 * and whether it has been used or withdrawn.
 */
function ClubInvitations({
  club,
  editable,
}: {
  readonly club: CreatorClub;
  readonly editable: boolean;
}) {
  const api = useApi();
  const toast = useToast();
  const { busy, run } = useSingleFlight();
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [issued, setIssued] = useState<
    { readonly expiresAt: string; readonly secret: string } | undefined
  >(undefined);
  const [confirming, setConfirming] = useState<string | undefined>(undefined);

  const load = useCallback(
    async () => api.clubInvites(club.id),
    [api, club.id],
  );
  const invites = useResource<ClubInviteList>(load);
  const rows = invites.value?.invites ?? [];
  const live = rows.filter(
    (entry) =>
      entry.redeemedAt === undefined &&
      entry.revokedAt === undefined &&
      !hasExpired(entry.expiresAt),
  );
  const spent = rows.filter(
    (entry) =>
      entry.redeemedAt !== undefined ||
      entry.revokedAt !== undefined ||
      hasExpired(entry.expiresAt),
  );

  return (
    <Card flush testId="club-invitations">
      <CardHead
        actions={
          editable && club.lifecycle === 'published' ? (
            <Button
              busy={busy}
              data-testid="club-invite"
              icon="plus"
              onClick={() => {
                run(async () => {
                  const result = await api.issueClubInvite(club.id);
                  const failure = failureMessage(result);
                  setMessage(failure);
                  if (isOk(result)) {
                    setIssued({
                      expiresAt: result.value.invite.expiresAt,
                      secret: result.value.secret,
                    });
                  }
                  invites.reload();
                });
              }}
              size="sm"
              tone="primary"
            >
              New invitation
            </Button>
          ) : undefined
        }
        lede="An invitation admits one person, once. It is complimentary — nothing on VELORA can be bought."
        title="Invitations"
      />

      {editable && club.lifecycle !== 'published' ? (
        <div className="s-card__pad">
          <Notice testId="club-invite-blocked" tone="quiet">
            Publish the club before inviting anybody. Somebody admitted to a
            draft club would have nothing to open.
          </Notice>
        </div>
      ) : null}

      {message === undefined ? null : (
        <div className="s-card__pad">
          <ErrorMessage testId="club-invite-error">{message}</ErrorMessage>
        </div>
      )}

      {issued === undefined ? null : (
        <IssuedInvitation
          expiresAt={issued.expiresAt}
          onDone={() => {
            setIssued(undefined);
          }}
          secret={issued.secret}
        />
      )}

      {invites.error !== undefined ? (
        <ErrorState
          body={invites.error}
          onRetry={invites.retryable ? invites.reload : undefined}
          testId="club-invites-failed"
        />
      ) : invites.loading && invites.value === undefined ? (
        <RowSkeleton rows={2} />
      ) : rows.length === 0 ? (
        <EmptyState
          body="Whoever holds one is admitted once, and it stops working the moment they use it."
          icon="ticket"
          testId="club-no-invites"
          title="No invitations yet"
        />
      ) : (
        <ul className="s-list">
          {live.map((entry) => (
            <li key={entry.id}>
              <ListRow
                aside={
                  editable ? (
                    <Button
                      data-testid={`club-revoke-invite-${entry.id}`}
                      disabled={busy}
                      onClick={() => {
                        setConfirming(entry.id);
                      }}
                      size="sm"
                      tone="ghost"
                    >
                      Withdraw
                    </Button>
                  ) : undefined
                }
              >
                <span className="s-inline s-inline--tight">
                  <Badge icon="ticket" tone="accent">
                    Unused
                  </Badge>
                  <span className="s-caption s-quiet">
                    {formatRemaining(entry.expiresAt)}
                  </span>
                </span>
                <span className="s-caption s-quiet">
                  Issued {formatDateTime(entry.createdAt)}
                </span>
              </ListRow>
            </li>
          ))}
          {spent.map((entry) => (
            <li key={entry.id}>
              <ListRow testId={`club-invite-spent-${entry.id}`}>
                <span className="s-inline s-inline--tight">
                  {entry.redeemedAt !== undefined ? (
                    <Badge icon="check" tone="positive">
                      Used
                    </Badge>
                  ) : entry.revokedAt !== undefined ? (
                    <Badge icon="x" tone="neutral">
                      Withdrawn
                    </Badge>
                  ) : (
                    <Badge icon="clock" tone="neutral">
                      Expired
                    </Badge>
                  )}
                  <span className="s-caption s-quiet">
                    {entry.redeemedAt !== undefined
                      ? `Used ${formatDateTime(entry.redeemedAt)}`
                      : entry.revokedAt !== undefined
                        ? `Withdrawn ${formatDateTime(entry.revokedAt)}`
                        : `Expired ${formatDateTime(entry.expiresAt)}`}
                  </span>
                </span>
                <span className="s-caption s-quiet">
                  Issued {formatDateTime(entry.createdAt)}
                </span>
              </ListRow>
            </li>
          ))}
        </ul>
      )}

      {confirming === undefined ? null : (
        <ConfirmDialog
          busy={busy}
          confirmLabel="Withdraw it"
          onCancel={() => {
            setConfirming(undefined);
          }}
          onConfirm={() => {
            const inviteId = confirming;
            setConfirming(undefined);
            run(async () => {
              const failure = failureMessage(
                await api.revokeClubInvite({ clubId: club.id, inviteId }),
              );
              setMessage(failure);
              if (failure === undefined) {
                toast.show('Invitation withdrawn.', 'positive');
              }
              invites.reload();
            });
          }}
          testId="club-invite-revoke-confirm"
          title="Withdraw this invitation?"
        >
          <p>
            If you have already sent it to somebody, it stops working for them
            immediately.
          </p>
        </ConfirmDialog>
      )}
    </Card>
  );
}

/**
 * The one moment the secret exists on a screen.
 *
 * Masked by default, revealed deliberately, copied with one control, and
 * dismissed by the creator rather than by a timer that could take it away
 * mid-copy. Nothing here logs it, stores it, or puts it in an address.
 */
function IssuedInvitation({
  expiresAt,
  onDone,
  secret,
}: {
  readonly expiresAt: string;
  readonly onDone: () => void;
  readonly secret: string;
}) {
  const toast = useToast();
  const [revealed, setRevealed] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  return (
    <div className="s-secret" data-testid="club-invite-secret">
      <p className="s-secret__head">
        <span className="s-point__mark">
          <Icon name="ticket" size="sm" />
        </span>
        <span className="s-subheading">Copy this now</span>
      </p>
      <p className="s-small s-muted s-measure">
        This invitation is shown once. VELORA does not store it and cannot show
        it to you again. Anybody who has it can use it, so send it to one person
        the way you would send a key.
      </p>

      <div className="s-secret__row">
        <code
          className="s-secret__value"
          data-testid="club-invite-secret-value"
          data-revealed={revealed ? 'true' : 'false'}
        >
          {revealed ? secret : '•'.repeat(Math.min(secret.length, 40))}
        </code>
        <IconButton
          data-testid="club-invite-reveal"
          label={revealed ? 'Hide the invitation' : 'Show the invitation'}
          name={revealed ? 'eyeOff' : 'eye'}
          onClick={() => {
            setRevealed((current) => !current);
          }}
        />
      </div>

      <div className="s-inline s-inline--tight">
        <Button
          data-testid="club-invite-copy"
          icon="copy"
          onClick={() => {
            void navigator.clipboard
              .writeText(secret)
              .then(() => {
                setCopyFailed(false);
                toast.show('Invitation copied.', 'positive');
              })
              .catch(() => {
                // The browser refused, which happens without a secure context
                // or a permission. Saying so and offering the value is better
                // than a control that silently does nothing.
                setCopyFailed(true);
                setRevealed(true);
              });
          }}
          tone="primary"
        >
          Copy invitation
        </Button>
        <Button data-testid="club-invite-done" onClick={onDone} tone="ghost">
          I have it
        </Button>
      </div>

      {copyFailed ? (
        <p className="s-caption s-quiet" data-testid="club-invite-copy-failed">
          Your browser would not let VELORA copy it. Select the text above and
          copy it yourself.
        </p>
      ) : null}

      <p className="s-caption s-quiet">{formatRemaining(expiresAt)}.</p>
    </div>
  );
}

/* ============================ Club content =========================== */

/**
 * What has been published to this club.
 *
 * Read from the creator's own catalog and filtered to this club, because the
 * contract publishes the association on the item rather than on the club. The
 * screen says how far it looked, so a creator with a long catalog is not shown
 * a short list as though it were the whole one.
 */
function ClubContent({ club }: { readonly club: CreatorClub }) {
  const api = useApi();

  const load = useCallback(
    async (cursor: string | undefined) => {
      const result = await api.content({ cursor, pageSize: lookupPageSize });
      return result.kind === 'ok'
        ? {
            kind: 'ok' as const,
            value: {
              items: result.value.content,
              nextCursor: result.value.nextCursor,
            },
          }
        : result;
    },
    [api],
  );
  const catalog = useCollection<CreatorContent>(load);
  const items = catalog.items.filter((item) => item.clubId === club.id);

  return (
    <Card flush testId="club-content">
      <CardHead
        actions={
          <ButtonLink href="/catalog/new" size="sm">
            Write something
          </ButtonLink>
        }
        lede="Members of this club can read these. Nobody else can, whatever the address."
        title="For members"
      />

      {catalog.error !== undefined && catalog.items.length === 0 ? (
        <ErrorState
          body={catalog.error}
          onRetry={catalog.retryable ? catalog.reload : undefined}
          testId="club-content-failed"
        />
      ) : catalog.loading && catalog.items.length === 0 ? (
        <RowSkeleton rows={2} />
      ) : items.length === 0 ? (
        <EmptyState
          body="Set an item's audience to this club and it appears here."
          icon="draft"
          testId="club-content-empty"
          title="Nothing for members yet"
        />
      ) : (
        <ul className="s-list">
          {items.map((item) => {
            const lifecycle = contentLifecycleLook(item.lifecycle);
            return (
              <li key={item.id}>
                <ListRow
                  href={`/catalog/${item.id}`}
                  testId={`club-content-${item.id}`}
                >
                  <span className="s-subheading s-wrap">{item.title}</span>
                  <span className="s-inline s-inline--tight">
                    <Badge icon={lifecycle.icon} tone={lifecycle.tone}>
                      {lifecycle.label}
                    </Badge>
                    <span className="s-caption s-quiet">
                      Edited {formatDate(item.updatedAt)}
                    </span>
                  </span>
                </ListRow>
              </li>
            );
          })}
        </ul>
      )}

      {catalog.hasMore ? (
        <div className="s-card__pad s-card__pad--block">
          <Button
            block
            busy={catalog.loadingMore}
            data-testid="club-content-more"
            onClick={catalog.loadMore}
          >
            Look further back in your catalog
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
