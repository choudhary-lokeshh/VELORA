'use client';

import { useCallback, useMemo, useState } from 'react';

import type { CreatorClubList, CreatorContent } from '@velora/creator-client';
import { failureMessage } from '@velora/creator-client';

import { ConfirmDialog } from '../design/dialog';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Chip,
  EmptyState,
  ErrorMessage,
  ErrorState,
  ListRow,
  PageHeader,
  RowSkeleton,
  Segmented,
  Toolbar,
} from '../design/primitives';
import { useApi, useCreator, useToast } from '../app/providers';
import {
  contentLifecycleLook,
  contentVisibilityLook,
  formatDate,
  plural,
} from './format';
import { useMediaAddresses } from './imagery';
import { useCollection, useResource, useSingleFlight } from './resource';

/**
 * The creator's catalog.
 *
 * Every item starts as a draft and stays private until somebody decides
 * otherwise, so the surface never presents saving and publishing as one act.
 * Nothing here shows a price, a purchase, a view count, or a read count: no
 * payment path exists and no such number is computed, and a control or figure
 * implying either would be a claim the platform cannot support.
 *
 * The filter is honest about its own reach. The server pages this list and
 * publishes no totals, so a filter can only sort what has actually arrived —
 * and the screen says so while there is more, rather than showing "0 drafts" to
 * somebody whose drafts are on the next page.
 */

const catalogPageSize = 25;

type Filter = 'all' | 'draft' | 'published' | 'archived';

export function Catalog() {
  const api = useApi();
  const creator = useCreator();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [confirming, setConfirming] = useState<CreatorContent | undefined>(
    undefined,
  );
  const { busy, run } = useSingleFlight();

  const loadCatalog = useCallback(
    async (cursor: string | undefined) => {
      const result = await api.content({ cursor, pageSize: catalogPageSize });
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
  const catalog = useCollection<CreatorContent>(loadCatalog);

  const loadClubs = useCallback(async () => api.clubs({ pageSize: 50 }), [api]);
  const clubs = useResource<CreatorClubList>(loadClubs);
  const clubNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const club of clubs.value?.clubs ?? []) names.set(club.id, club.name);
    return names;
  }, [clubs.value]);

  const counts = useMemo(
    () => ({
      all: catalog.items.length,
      archived: catalog.items.filter((item) => item.lifecycle === 'archived')
        .length,
      draft: catalog.items.filter((item) => item.lifecycle === 'draft').length,
      published: catalog.items.filter((item) => item.lifecycle === 'published')
        .length,
    }),
    [catalog.items],
  );

  const shown =
    filter === 'all'
      ? catalog.items
      : catalog.items.filter((item) => item.lifecycle === filter);
  const imageReferences = shown.flatMap((item) => {
    const image = item.media.find((entry) => entry.state === 'ready');
    return image === undefined ? [] : [image.id];
  });
  const imageAddresses = useMediaAddresses(imageReferences, 'card');

  const setLifecycle = (
    item: CreatorContent,
    lifecycle: 'draft' | 'published' | 'archived',
    confirmation: string,
  ) => {
    run(async () => {
      const failure = failureMessage(
        await api.setContentLifecycle({
          contentId: item.id,
          lifecycle,
          version: item.version,
        }),
        {
          conflict:
            'This item changed somewhere else since this page was loaded. Reload and try again.',
        },
      );
      setMessage(failure);
      if (failure === undefined) toast.show(confirmation, 'positive');
      catalog.reload();
    });
  };

  return (
    <>
      <PageHeader
        actions={
          creator.canWrite ? (
            <ButtonLink
              data-testid="content-new"
              href="/catalog/new"
              icon="plus"
              tone="primary"
            >
              New draft
            </ButtonLink>
          ) : undefined
        }
        lede="Everything you write starts as a draft nobody else can see. Publishing is a separate decision."
        title="Catalog"
      />

      {!creator.settled || creator.canWrite ? null : (
        <Card>
          <ErrorState
            body="Your creator access cannot publish or change items at the moment. Everything you have made is still listed below and still yours."
            testId="catalog-read-only"
            title="Read only for now"
          />
        </Card>
      )}

      {message === undefined ? null : (
        <ErrorMessage testId="creator-content-error">{message}</ErrorMessage>
      )}

      <Toolbar>
        <Segmented
          label="Filter the catalog"
          onChange={setFilter}
          options={[
            { count: counts.all, label: 'Everything', value: 'all' },
            { count: counts.draft, label: 'Drafts', value: 'draft' },
            { count: counts.published, label: 'Published', value: 'published' },
            { count: counts.archived, label: 'Archived', value: 'archived' },
          ]}
          value={filter}
        />
        {catalog.hasMore ? (
          <p className="s-caption s-quiet" data-testid="catalog-partial">
            These counts cover the{' '}
            {plural(catalog.items.length, 'item', 'items')} loaded so far.
          </p>
        ) : null}
      </Toolbar>

      <Card flush testId="creator-content-list">
        {catalog.error !== undefined && catalog.items.length === 0 ? (
          <ErrorState
            body={catalog.error}
            onRetry={catalog.retryable ? catalog.reload : undefined}
            testId="creator-content-failed"
          />
        ) : catalog.loading && catalog.items.length === 0 ? (
          <RowSkeleton rows={4} />
        ) : catalog.items.length === 0 ? (
          <EmptyState
            actions={
              creator.canWrite ? (
                <ButtonLink href="/catalog/new" icon="plus" tone="primary">
                  Write a draft
                </ButtonLink>
              ) : undefined
            }
            body="What you write stays a draft only you can see until you publish it."
            icon="draft"
            testId="creator-content-empty"
            title="Nothing here yet"
          />
        ) : shown.length === 0 ? (
          <EmptyState
            body={
              catalog.hasMore
                ? 'Nothing matching that has loaded yet. There is more of your catalog still to load.'
                : 'Nothing in your catalog is in that state.'
            }
            icon="draft"
            testId="creator-content-filtered-empty"
            title="Nothing to show"
          />
        ) : (
          <ul className="s-list">
            {shown.map((item) => (
              <li key={item.id}>
                <ContentRow
                  busy={busy}
                  clubName={
                    item.clubId === undefined
                      ? undefined
                      : clubNames.get(item.clubId)
                  }
                  editable={creator.canWrite}
                  imageAddress={imageAddresses.get(
                    item.media.find((entry) => entry.state === 'ready')?.id ??
                      '',
                  )}
                  imageReference={
                    item.media.find((entry) => entry.state === 'ready')?.id
                  }
                  item={item}
                  onArchive={() => {
                    setConfirming(item);
                  }}
                  onPublish={() => {
                    setLifecycle(item, 'published', 'Published.');
                  }}
                  onRestore={() => {
                    setLifecycle(item, 'draft', 'Back in your drafts.');
                  }}
                  onUnpublish={() => {
                    setLifecycle(item, 'draft', 'Back to a draft.');
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {catalog.hasMore ? (
        <Button
          block
          busy={catalog.loadingMore}
          data-testid="catalog-load-more"
          onClick={catalog.loadMore}
        >
          Load more
        </Button>
      ) : null}

      {confirming === undefined ? null : (
        <ConfirmDialog
          busy={busy}
          confirmLabel="Archive it"
          onCancel={() => {
            setConfirming(undefined);
          }}
          onConfirm={() => {
            const item = confirming;
            setConfirming(undefined);
            setLifecycle(item, 'archived', 'Archived.');
          }}
          testId="content-archive-confirm"
          title={`Archive “${confirming.title}”?`}
        >
          <p>
            It comes off your public page immediately and stops being visible to
            anybody. It stays yours, and you can bring it back as a draft.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}

function ContentRow({
  busy,
  clubName,
  editable,
  imageAddress,
  imageReference,
  item,
  onArchive,
  onPublish,
  onRestore,
  onUnpublish,
}: {
  readonly busy: boolean;
  readonly clubName: string | undefined;
  readonly editable: boolean;
  readonly imageAddress: string | undefined;
  readonly imageReference: string | undefined;
  readonly item: CreatorContent;
  readonly onArchive: () => void;
  readonly onPublish: () => void;
  readonly onRestore: () => void;
  readonly onUnpublish: () => void;
}) {
  const lifecycle = contentLifecycleLook(item.lifecycle);
  const visibility = contentVisibilityLook(item.visibility);

  return (
    <div className="s-item-row" data-testid={`content-item-${item.id}`}>
      <div className="s-item-row__main">
        <ListRow
          href={`/catalog/${item.id}`}
          testId={`content-open-${item.id}`}
        >
          <span className="s-catalog-entry">
            {imageReference === undefined ? null : (
              <span aria-hidden="true" className="s-catalog-entry__image">
                {imageAddress === undefined ? null : (
                  <img
                    alt=""
                    data-testid={`content-image-${item.id}`}
                    height={96}
                    loading="lazy"
                    src={imageAddress}
                    width={128}
                  />
                )}
              </span>
            )}
            <span className="s-catalog-entry__copy">
              <span className="s-inline s-inline--tight">
                <span className="s-subheading s-wrap">{item.title}</span>
              </span>
              {item.summary === undefined ? null : (
                <span className="s-small s-muted s-wrap s-clamp-2">
                  {item.summary}
                </span>
              )}
              <span className="s-inline s-inline--tight">
                <Badge
                  icon={lifecycle.icon}
                  testId={`content-lifecycle-${item.id}`}
                  tone={lifecycle.tone}
                >
                  {lifecycle.label}
                </Badge>
                <Badge
                  icon={visibility.icon}
                  testId={`content-visibility-${item.id}`}
                  tone={visibility.tone}
                >
                  {visibility.label}
                </Badge>
                {item.visibility === 'members_only' &&
                clubName !== undefined ? (
                  <Chip icon="users">{clubName}</Chip>
                ) : null}
                {item.visibility === 'members_only' &&
                item.clubId === undefined ? (
                  <Badge
                    icon="alert"
                    testId={`content-unreachable-${item.id}`}
                    tone="caution"
                  >
                    Reaches nobody
                  </Badge>
                ) : null}
                <span className="s-caption s-quiet">
                  {item.lifecycle === 'published' &&
                  item.publishedAt !== undefined
                    ? `Published ${formatDate(item.publishedAt)}`
                    : `Edited ${formatDate(item.updatedAt)}`}
                </span>
              </span>
            </span>
          </span>
        </ListRow>
      </div>

      {editable ? (
        <div className="s-item-row__actions">
          {item.lifecycle === 'draft' ? (
            <Button
              data-testid={`content-publish-${item.id}`}
              disabled={busy}
              onClick={onPublish}
              size="sm"
              tone="primary"
            >
              Publish
            </Button>
          ) : null}
          {item.lifecycle === 'published' ? (
            <Button
              data-testid={`content-unpublish-${item.id}`}
              disabled={busy}
              onClick={onUnpublish}
              size="sm"
            >
              Return to draft
            </Button>
          ) : null}
          {item.lifecycle === 'archived' ? (
            <Button
              data-testid={`content-restore-${item.id}`}
              disabled={busy}
              onClick={onRestore}
              size="sm"
            >
              Restore as a draft
            </Button>
          ) : (
            <Button
              data-testid={`content-archive-${item.id}`}
              disabled={busy}
              onClick={onArchive}
              size="sm"
              tone="ghost"
            >
              Archive
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
