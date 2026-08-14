'use client';

import { useCallback, useState, type ReactNode } from 'react';

import type {
  ApiResult,
  CreatorApi,
  CreatorContent,
  CreatorContentList,
} from '@velora/creator-client';
import { failureMessage } from '@velora/creator-client';

import { useResource, useSingleFlight } from './resource';
import { EmptyState, ErrorMessage, ResourceState, Section } from './ui';

/**
 * The creator's catalog.
 *
 * Every item starts as a draft and stays private until somebody decides
 * otherwise, so the surface never presents saving and publishing as one act.
 * Nothing here shows a price, a purchase, a view count, or a member count: no
 * payment path exists and no such number is computed, and a control or figure
 * implying either would be a claim the platform cannot support.
 */

const lifecycleLabels: Readonly<Record<string, string>> = {
  archived: 'Archived. Withdrawn, and still yours.',
  draft: 'Draft. Only you can see this.',
  published: 'Published. Anyone with your link can see this.',
};

const visibilityLabels: Readonly<Record<string, string>> = {
  members_only: 'Members only',
  public: 'Everyone',
};

export function ContentPanel({
  api,
  editable,
  onSessionEnded,
}: {
  readonly api: CreatorApi;
  /** False while the capability may not operate, so nothing offers a write. */
  readonly editable: boolean;
  readonly onSessionEnded: () => void;
}) {
  const load = useCallback(async () => api.content(), [api]);
  const catalog = useResource<CreatorContentList>(load, {
    onUnauthenticated: onSessionEnded,
  });
  const [message, setMessage] = useState<string | undefined>(undefined);
  const { busy, run } = useSingleFlight();

  const act = (work: () => Promise<ApiResult<unknown>>) => {
    run(async () => {
      setMessage(failureMessage(await work()));
      catalog.reload();
    });
  };

  return (
    <Section headingId="content-heading" title="Catalog">
      <ResourceState resource={catalog} testId="creator-content" />
      {message === undefined ? null : (
        <ErrorMessage testId="creator-content-error">{message}</ErrorMessage>
      )}

      {editable ? (
        <NewItem
          busy={busy}
          onCreate={(body) => {
            act(async () => api.saveContent(body));
          }}
        />
      ) : null}

      {catalog.value === undefined ? null : catalog.value.content.length ===
        0 ? (
        <EmptyState testId="creator-content-empty">
          Nothing here yet. What you write stays a draft until you publish it.
        </EmptyState>
      ) : (
        <ul data-testid="creator-content-list">
          {catalog.value.content.map((item) => (
            <ContentRow
              busy={busy}
              editable={editable}
              item={item}
              key={item.id}
              onLifecycle={(lifecycle) => {
                act(async () =>
                  api.setContentLifecycle({
                    contentId: item.id,
                    lifecycle,
                    version: item.version,
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

function NewItem({
  busy,
  onCreate,
}: {
  readonly busy: boolean;
  readonly onCreate: (body: {
    readonly summary?: string;
    readonly title: string;
    readonly visibility: 'public' | 'members_only';
  }) => void;
}) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'members_only'>(
    'public',
  );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onCreate({
          ...(summary.length === 0 ? {} : { summary }),
          title,
          visibility,
        });
        setTitle('');
        setSummary('');
      }}
    >
      <label htmlFor="content-title">Title</label>
      <input
        data-testid="content-title"
        id="content-title"
        onChange={(event) => {
          setTitle(event.target.value);
        }}
        value={title}
      />

      <label htmlFor="content-summary">Summary</label>
      <input
        data-testid="content-summary"
        id="content-summary"
        onChange={(event) => {
          setSummary(event.target.value);
        }}
        value={summary}
      />

      <label htmlFor="content-visibility">Who this is for</label>
      <select
        data-testid="content-visibility"
        id="content-visibility"
        onChange={(event) => {
          setVisibility(
            event.target.value === 'members_only' ? 'members_only' : 'public',
          );
        }}
        value={visibility}
      >
        <option value="public">Everyone</option>
        <option value="members_only">Members only</option>
      </select>
      {visibility === 'members_only' ? (
        // Honest rather than encouraging: there is nothing to be a member of
        // yet, so an item marked this way is reachable by nobody at all.
        <p data-testid="content-members-note">
          Private clubs do not exist yet, so nobody can reach a members-only
          item. It stays yours until they do.
        </p>
      ) : null}

      <button data-testid="content-create" disabled={busy} type="submit">
        Add a draft
      </button>
    </form>
  );
}

function ContentRow({
  busy,
  editable,
  item,
  onLifecycle,
}: {
  readonly busy: boolean;
  readonly editable: boolean;
  readonly item: CreatorContent;
  readonly onLifecycle: (lifecycle: 'draft' | 'published' | 'archived') => void;
}): ReactNode {
  return (
    <li data-testid={`content-item-${item.id}`}>
      <h3>{item.title}</h3>
      {item.summary === undefined ? null : <p>{item.summary}</p>}
      <p data-testid={`content-lifecycle-${item.id}`}>
        {lifecycleLabels[item.lifecycle] ?? item.lifecycle}
      </p>
      <p data-testid={`content-visibility-${item.id}`}>
        {visibilityLabels[item.visibility] ?? item.visibility}
      </p>

      {editable ? (
        <>
          {item.lifecycle === 'draft' ? (
            <button
              data-testid={`content-publish-${item.id}`}
              disabled={busy}
              onClick={() => {
                onLifecycle('published');
              }}
              type="button"
            >
              Publish
            </button>
          ) : null}
          {item.lifecycle === 'published' ? (
            <button
              data-testid={`content-unpublish-${item.id}`}
              disabled={busy}
              onClick={() => {
                onLifecycle('draft');
              }}
              type="button"
            >
              Return to draft
            </button>
          ) : null}
          {item.lifecycle === 'archived' ? (
            <button
              data-testid={`content-restore-${item.id}`}
              disabled={busy}
              onClick={() => {
                onLifecycle('draft');
              }}
              type="button"
            >
              Restore as a draft
            </button>
          ) : (
            <button
              data-testid={`content-archive-${item.id}`}
              disabled={busy}
              onClick={() => {
                onLifecycle('archived');
              }}
              type="button"
            >
              Archive
            </button>
          )}
        </>
      ) : null}
    </li>
  );
}
