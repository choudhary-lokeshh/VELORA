'use client';

import { useCallback } from 'react';

import type {
  PublicClubList,
  PublicCreator,
  PublicCreatorCatalog,
} from '@velora/creator-client';

import { Icon } from '../design/icons';
import {
  Badge,
  ButtonLink,
  Card,
  CardHead,
  CardSkeleton,
  CreatorAvatar,
  EmptyState,
  ErrorState,
  Notice,
  PageHeader,
} from '../design/primitives';
import { useApi, useCreator } from '../app/providers';
import { formatDate, plural } from './format';
import { useMediaAddresses } from './imagery';
import { useResource } from './resource';

/**
 * What a visitor actually sees.
 *
 * Not a rendering of local form state — a read of the same public routes a
 * stranger's browser would call, without a session attached. That distinction
 * is the whole point of the screen: a preview built from what this tab has in
 * memory would show a creator their drafts and tell them nothing about what
 * they had actually published.
 *
 * It follows that a draft page previews as nothing, because that is what a
 * visitor gets. The screen says so in those words rather than showing a
 * hopeful mock-up of a page nobody can open.
 */
export function PublicPreview() {
  const api = useApi();
  const creator = useCreator();
  const profile = creator.profile.value;
  const handle = profile?.handle;
  const published = profile?.publication === 'published';

  const loadPublic = useCallback(
    async () =>
      handle === undefined
        ? { kind: 'ok' as const, value: undefined }
        : api.publicCreator(handle),
    [api, handle],
  );
  const loadCatalog = useCallback(
    async () =>
      handle === undefined
        ? { kind: 'ok' as const, value: undefined }
        : api.publicCatalog({ handle, pageSize: 20 }),
    [api, handle],
  );
  const loadClubs = useCallback(
    async () =>
      handle === undefined
        ? { kind: 'ok' as const, value: undefined }
        : api.publicClubs(handle),
    [api, handle],
  );

  const page = useResource<PublicCreator | undefined>(loadPublic);
  const catalog = useResource<PublicCreatorCatalog | undefined>(loadCatalog);
  const clubs = useResource<PublicClubList | undefined>(loadClubs);

  if (profile === undefined) {
    return (
      <>
        <PageHeader title="Preview" />
        <Card>
          <EmptyState
            actions={
              <ButtonLink href="/profile" icon="plus" tone="primary">
                Create your page
              </ButtonLink>
            }
            body="You have not claimed a handle yet, so there is no address for anybody to open."
            icon="eyeOff"
            testId="preview-no-page"
            title="There is no page yet"
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        actions={
          <ButtonLink href="/profile" size="sm">
            Back to editing
          </ButtonLink>
        }
        lede="Read from the same public addresses a stranger's browser would use, with no session attached."
        title="Preview"
      />

      {published ? null : (
        <Notice
          testId="preview-draft"
          title="Your page is a draft"
          tone="caution"
        >
          Nobody can open {profile.publicPath} at the moment, including anybody
          you send the address to. Publishing it from your public page is what
          changes that.
        </Notice>
      )}

      {page.error !== undefined ? (
        <Card>
          <ErrorState
            body={page.error}
            onRetry={page.retryable ? page.reload : undefined}
            testId="preview-failed"
          />
        </Card>
      ) : page.loading ? (
        <Card testId="preview-loading">
          <CardSkeleton rows={4} />
        </Card>
      ) : page.value === undefined ? (
        <Card>
          <EmptyState
            body="A visitor opening your address today is told the page is not available, and nothing else about you."
            icon="eyeOff"
            testId="preview-empty"
            title="A visitor sees nothing"
          />
        </Card>
      ) : (
        <VisitorView
          catalog={catalog.value}
          clubs={clubs.value}
          creator={page.value}
        />
      )}
    </>
  );
}

/**
 * The visitor's own view, rendered from the public projection alone.
 *
 * The public shapes are deliberately different types from the creator's own —
 * they carry no lifecycle, no version, and no visibility — so a draft cannot
 * reach this component even by mistake.
 */
function VisitorView({
  catalog,
  clubs,
  creator,
}: {
  readonly catalog: PublicCreatorCatalog | undefined;
  readonly clubs: PublicClubList | undefined;
  readonly creator: PublicCreator;
}) {
  const items = catalog?.content ?? [];
  const rooms = clubs?.clubs ?? [];
  // Exactly what a visitor would be served, obtained the same way: a reference
  // exchanged for an address, decided by the platform. An image that does not
  // come back here would not come back for anybody, which is the point of a
  // preview being a preview rather than a mock-up.
  const avatarRef = creator.avatar?.id;
  const avatars = useMediaAddresses(
    avatarRef === undefined ? [] : [avatarRef],
    'avatar_large',
  );

  return (
    <div className="s-preview">
      <Card testId="preview-identity">
        <div className="s-preview__identity">
          <CreatorAvatar
            displayName={creator.displayName}
            seed={creator.handle}
            size="lg"
            src={avatarRef === undefined ? undefined : avatars.get(avatarRef)}
          />
          <div className="s-stack s-stack--2">
            <h2 className="s-title">{creator.displayName}</h2>
            <p className="s-small s-quiet">@{creator.handle}</p>
            {creator.bio === undefined ? null : (
              <p className="s-body s-measure s-wrap s-editorial">
                {creator.bio}
              </p>
            )}
            <p className="s-caption s-quiet">
              Published {formatDate(creator.publishedAt)}
            </p>
          </div>
        </div>

        {creator.links.length === 0 ? null : (
          <ul className="s-inline" data-testid="preview-links">
            {creator.links.map((link) => (
              <li key={link.url}>
                <span className="s-chip">
                  <Icon name="link" size="sm" />
                  <span className="s-truncate">{link.label ?? link.url}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card testId="preview-catalog">
        <CardHead
          lede={
            items.length === 0
              ? undefined
              : `${plural(items.length, 'item', 'items')} a visitor can read.`
          }
          title="What they can read"
        />
        {items.length === 0 ? (
          <EmptyState
            body="Nothing of yours is published. Drafts and members-only items never appear here."
            icon="draft"
            testId="preview-catalog-empty"
            title="Nothing to read yet"
          />
        ) : (
          <ul className="s-stack s-stack--3">
            {items.map((item) => (
              <li className="s-preview-item" key={item.id}>
                <p className="s-subheading s-wrap">{item.title}</p>
                {item.summary === undefined ? null : (
                  <p className="s-small s-muted s-wrap s-clamp-3">
                    {item.summary}
                  </p>
                )}
                <p className="s-caption s-quiet">
                  {formatDate(item.publishedAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
        {catalog?.nextCursor === undefined ? null : (
          <p className="s-caption s-quiet">
            A visitor sees more of these as they scroll. This preview shows the
            first page.
          </p>
        )}
      </Card>

      <Card testId="preview-clubs">
        <CardHead
          lede="A visitor sees a club's name and description, and nothing about who is inside it."
          title="Clubs they can see"
        />
        {rooms.length === 0 ? (
          <EmptyState
            body="Draft clubs and closed clubs never appear on a public page."
            icon="users"
            testId="preview-clubs-empty"
            title="No clubs listed"
          />
        ) : (
          <ul className="s-stack s-stack--3">
            {rooms.map((club) => (
              <li className="s-preview-item" key={club.slug}>
                <div className="s-inline s-inline--tight">
                  <p className="s-subheading s-wrap">{club.name}</p>
                  <Badge icon="lock" tone="accent">
                    By invitation
                  </Badge>
                </div>
                {club.description === undefined ? null : (
                  <p className="s-small s-muted s-wrap s-clamp-2">
                    {club.description}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
