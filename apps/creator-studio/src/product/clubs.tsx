'use client';

import { useCallback, useState } from 'react';

import type {
  ApiResult,
  CreatorApi,
  CreatorClub,
  CreatorClubList,
} from '@velora/creator-client';
import { failureMessage } from '@velora/creator-client';

import { useResource, useSingleFlight } from './resource';
import { EmptyState, ErrorMessage, ResourceState, Section } from './ui';

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
 * no payment path exists. An invitation is complimentary and says so.
 */

const clubLifecycleLabels: Readonly<Record<string, string>> = {
  closed: 'Closed. Nobody can be admitted, and this cannot be undone.',
  draft: 'Draft. Nobody can see this or be admitted to it.',
  published: 'Published. Visible on your public page.',
};

export function ClubsPanel({
  api,
  editable,
  onSessionEnded,
}: {
  readonly api: CreatorApi;
  readonly editable: boolean;
  readonly onSessionEnded: () => void;
}) {
  const load = useCallback(async () => api.clubs(), [api]);
  const clubs = useResource<CreatorClubList>(load, {
    onUnauthenticated: onSessionEnded,
  });
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [secret, setSecret] = useState<string | undefined>(undefined);
  const { busy, run } = useSingleFlight();

  const act = (work: () => Promise<ApiResult<unknown>>) => {
    run(async () => {
      setMessage(failureMessage(await work()));
      clubs.reload();
    });
  };

  return (
    <Section headingId="clubs-heading" title="Private clubs">
      <ResourceState resource={clubs} testId="creator-clubs" />
      {message === undefined ? null : (
        <ErrorMessage testId="creator-clubs-error">{message}</ErrorMessage>
      )}

      {editable ? (
        <NewClub
          busy={busy}
          onCreate={(body) => {
            act(async () => api.saveClub(body));
          }}
        />
      ) : null}

      {secret === undefined ? null : (
        <div data-testid="club-invite-secret">
          <p>
            This invitation is shown once. Copy it now — it is not stored and
            cannot be shown again.
          </p>
          <code>{secret}</code>
        </div>
      )}

      {clubs.value === undefined ? null : clubs.value.clubs.length === 0 ? (
        <EmptyState testId="creator-clubs-empty">
          No clubs yet. A club starts with nobody in it and stays private until
          you publish it.
        </EmptyState>
      ) : (
        <ul data-testid="creator-clubs-list">
          {clubs.value.clubs.map((club) => (
            <ClubRow
              busy={busy}
              club={club}
              editable={editable}
              key={club.id}
              onInvite={() => {
                run(async () => {
                  const result = await api.issueClubInvite(club.id);
                  setMessage(failureMessage(result));
                  setSecret(
                    result.kind === 'ok' ? result.value.secret : undefined,
                  );
                  clubs.reload();
                });
              }}
              onLifecycle={(lifecycle) => {
                act(async () =>
                  api.setClubLifecycle({
                    clubId: club.id,
                    lifecycle,
                    version: club.version,
                  }),
                );
              }}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

function NewClub({
  busy,
  onCreate,
}: {
  readonly busy: boolean;
  readonly onCreate: (body: {
    readonly description?: string;
    readonly name: string;
    readonly slug: string;
  }) => void;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onCreate({
          ...(description.length === 0 ? {} : { description }),
          name,
          slug,
        });
        setName('');
        setSlug('');
        setDescription('');
      }}
    >
      <label htmlFor="club-name">Name</label>
      <input
        data-testid="club-name"
        id="club-name"
        onChange={(event) => {
          setName(event.target.value);
        }}
        value={name}
      />

      <label htmlFor="club-slug">Address</label>
      <input
        data-testid="club-slug"
        id="club-slug"
        onChange={(event) => {
          setSlug(event.target.value);
        }}
        value={slug}
      />
      <p>
        The address is fixed once the club exists, because it appears in links
        people keep.
      </p>

      <label htmlFor="club-description">Description</label>
      <input
        data-testid="club-description"
        id="club-description"
        onChange={(event) => {
          setDescription(event.target.value);
        }}
        value={description}
      />

      <button data-testid="club-create" disabled={busy} type="submit">
        Create a draft club
      </button>
    </form>
  );
}

function ClubRow({
  busy,
  club,
  editable,
  onInvite,
  onLifecycle,
}: {
  readonly busy: boolean;
  readonly club: CreatorClub;
  readonly editable: boolean;
  readonly onInvite: () => void;
  readonly onLifecycle: (lifecycle: 'draft' | 'published' | 'closed') => void;
}) {
  return (
    <li data-testid={`club-item-${club.id}`}>
      <h3>{club.name}</h3>
      {club.description === undefined ? null : <p>{club.description}</p>}
      <p data-testid={`club-lifecycle-${club.id}`}>
        {clubLifecycleLabels[club.lifecycle] ?? club.lifecycle}
      </p>
      {/*
        Computed from live entitlements every time this page is read. It is a
        real count of people who currently have access, and it is the only
        number this surface shows.
      */}
      <p data-testid={`club-members-${club.id}`}>
        {club.memberCount === 1
          ? '1 member'
          : `${String(club.memberCount)} members`}
      </p>

      {editable && club.lifecycle !== 'closed' ? (
        <>
          {club.lifecycle === 'draft' ? (
            <button
              data-testid={`club-publish-${club.id}`}
              disabled={busy}
              onClick={() => {
                onLifecycle('published');
              }}
              type="button"
            >
              Publish
            </button>
          ) : (
            <>
              <button
                data-testid={`club-unpublish-${club.id}`}
                disabled={busy}
                onClick={() => {
                  onLifecycle('draft');
                }}
                type="button"
              >
                Return to draft
              </button>
              <button
                data-testid={`club-invite-${club.id}`}
                disabled={busy}
                onClick={onInvite}
                type="button"
              >
                Create a complimentary invitation
              </button>
            </>
          )}
          <button
            data-testid={`club-close-${club.id}`}
            disabled={busy}
            onClick={() => {
              onLifecycle('closed');
            }}
            type="button"
          >
            Close permanently
          </button>
        </>
      ) : null}
    </li>
  );
}
