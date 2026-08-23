'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import type { CreatorClub } from '@velora/creator-client';
import { failureMessage, isOk } from '@velora/creator-client';

import { Dialog } from '../design/dialog';
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorMessage,
  ErrorState,
  Field,
  ListRow,
  Notice,
  PageHeader,
  RowSkeleton,
  TextArea,
  TextInput,
} from '../design/primitives';
import { useApi, useCreator, useToast } from '../app/providers';
import { clubLifecycleLook, plural } from './format';
import { useCollection, useSingleFlight } from './resource';

/**
 * Private clubs.
 *
 * A club is a real access-controlled space, so everything about it is stated
 * plainly: it starts with nobody in it, it becomes visible only when the
 * creator publishes it, and closing it is final. The member count is computed
 * from live entitlements rather than stored, so it cannot drift into a number
 * that flatters anybody.
 *
 * There is no price, no subscription control, and no purchase language, because
 * no payment path exists. The only way anybody gets into a club today is an
 * invitation the creator issues, and the surface says so rather than implying a
 * door that could be bought through.
 */

export const clubNameBounds = { maximum: 80, minimum: 2 };
export const clubDescriptionMaximum = 600;
const slugPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{1,38}[A-Za-z0-9]$/u;
const clubsPageSize = 25;

export function Clubs() {
  const api = useApi();
  const creator = useCreator();
  const [creating, setCreating] = useState(false);

  const load = useCallback(
    async (cursor: string | undefined) => {
      const result = await api.clubs({ cursor, pageSize: clubsPageSize });
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

  return (
    <>
      <PageHeader
        actions={
          creator.canWrite ? (
            <Button
              data-testid="club-new"
              icon="plus"
              onClick={() => {
                setCreating(true);
              }}
              tone="primary"
            >
              New club
            </Button>
          ) : undefined
        }
        lede="A club is a private space you admit people to yourself. It starts with nobody in it and stays invisible until you publish it."
        title="Private clubs"
      />

      {!creator.settled || creator.canWrite ? null : (
        <Notice
          testId="clubs-read-only"
          title="Read only for now"
          tone="caution"
        >
          Your creator access cannot change clubs at the moment. Everything you
          run is still listed below.
        </Notice>
      )}

      <Card flush testId="creator-clubs-list">
        {clubs.error !== undefined && clubs.items.length === 0 ? (
          <ErrorState
            body={clubs.error}
            onRetry={clubs.retryable ? clubs.reload : undefined}
            testId="creator-clubs-failed"
          />
        ) : clubs.loading && clubs.items.length === 0 ? (
          <RowSkeleton rows={3} />
        ) : clubs.items.length === 0 ? (
          <EmptyState
            actions={
              creator.canWrite ? (
                <Button
                  icon="plus"
                  onClick={() => {
                    setCreating(true);
                  }}
                  tone="primary"
                >
                  Create a club
                </Button>
              ) : undefined
            }
            body="Nobody joins a club by accident. You issue an invitation, and whoever holds it is admitted once."
            icon="users"
            testId="creator-clubs-empty"
            title="No clubs yet"
          />
        ) : (
          <ul className="s-list">
            {clubs.items.map((club) => (
              <li key={club.id}>
                <ClubRow club={club} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {clubs.hasMore ? (
        <Button
          block
          busy={clubs.loadingMore}
          data-testid="clubs-load-more"
          onClick={clubs.loadMore}
        >
          Load more
        </Button>
      ) : null}

      {creating ? (
        <NewClubDialog
          onClose={() => {
            setCreating(false);
          }}
        />
      ) : null}
    </>
  );
}

function ClubRow({ club }: { readonly club: CreatorClub }) {
  const lifecycle = clubLifecycleLook(club.lifecycle);
  return (
    <ListRow href={`/clubs/${club.id}`} testId={`club-item-${club.id}`}>
      <span className="s-subheading s-wrap">{club.name}</span>
      {club.description === undefined ? null : (
        <span className="s-small s-muted s-wrap s-clamp-2">
          {club.description}
        </span>
      )}
      <span className="s-inline s-inline--tight">
        <Badge
          icon={lifecycle.icon}
          testId={`club-lifecycle-${club.id}`}
          tone={lifecycle.tone}
        >
          {lifecycle.label}
        </Badge>
        {/*
          Computed from live entitlements every time this page is read. It is a
          real count of people who currently have access, and it is the only
          number this screen shows.
        */}
        <Chip icon="users">
          <span data-testid={`club-members-${club.id}`}>
            {plural(club.memberCount, 'member', 'members')}
          </span>
        </Chip>
        <span className="s-caption s-quiet s-truncate">/{club.slug}</span>
      </span>
    </ListRow>
  );
}

/**
 * Creating a club.
 *
 * In a dialog rather than at the top of the list, because it is an occasional
 * act and a permanent form above a list of things is a form that dominates the
 * screen a creator came to read. The address is fixed on creation and the
 * dialog says so before anybody types it.
 */
function NewClubDialog({ onClose }: { readonly onClose: () => void }) {
  const api = useApi();
  const router = useRouter();
  const toast = useToast();
  const { busy, run } = useSingleFlight();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [touched, setTouched] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);

  const trimmedName = name.trim();
  const trimmedSlug = slug.trim();
  const nameError =
    !touched || trimmedName.length >= clubNameBounds.minimum
      ? undefined
      : 'Give the club a name of at least two characters.';
  const slugError =
    !touched || slugPattern.test(trimmedSlug)
      ? undefined
      : 'Use 3 to 40 letters, numbers, hyphens or underscores, starting and ending with a letter or number.';
  const blocked =
    trimmedName.length < clubNameBounds.minimum ||
    !slugPattern.test(trimmedSlug) ||
    description.length > clubDescriptionMaximum;

  return (
    <Dialog onClose={onClose} testId="club-create-dialog" title="New club">
      <p className="s-small s-muted">
        It is created as a draft. Nobody can see it or be admitted to it until
        you publish it.
      </p>

      {message === undefined ? null : (
        <ErrorMessage testId="creator-clubs-error">{message}</ErrorMessage>
      )}

      <form
        className="s-stack s-stack--5"
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (blocked) return;
          run(async () => {
            const result = await api.saveClub({
              ...(description.trim().length === 0
                ? {}
                : { description: description.trim() }),
              name: trimmedName,
              slug: trimmedSlug,
            });
            const failure = failureMessage(result, {
              conflict:
                'That address already belongs to one of your clubs. Choose another one.',
            });
            setMessage(failure);
            if (!isOk(result)) return;
            toast.show('Club created as a draft.', 'positive');
            const created = result.value.clubs.find(
              (club) => club.slug.toLowerCase() === trimmedSlug.toLowerCase(),
            );
            onClose();
            if (created !== undefined) router.push(`/clubs/${created.id}`);
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
              data-testid="club-name"
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
          error={slugError}
          hint="The address is fixed once the club exists, because it appears in links people keep."
          label="Address"
        >
          {(control) => (
            <TextInput
              {...control}
              autoCapitalize="none"
              autoComplete="off"
              data-testid="club-slug"
              maxLength={40}
              name="slug"
              onChange={(event) => {
                setSlug(event.target.value);
              }}
              placeholder="inner-circle"
              spellCheck={false}
              value={slug}
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
              data-testid="club-description"
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

        <div className="s-dialog__actions">
          <Button disabled={busy} onClick={onClose} tone="ghost">
            Cancel
          </Button>
          <Button
            busy={busy}
            data-testid="club-create"
            tone="primary"
            type="submit"
          >
            Create a draft club
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
