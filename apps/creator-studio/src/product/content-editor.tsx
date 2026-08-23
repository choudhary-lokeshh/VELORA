'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import type { CreatorClubList, CreatorContent } from '@velora/creator-client';
import { failureMessage, isOk } from '@velora/creator-client';

import { ConfirmDialog } from '../design/dialog';
import {
  Badge,
  BlockedState,
  Button,
  ButtonLink,
  Card,
  CardHead,
  CardSkeleton,
  ChoiceCard,
  EmptyState,
  ErrorMessage,
  ErrorState,
  Field,
  Notice,
  PageHeader,
  Select,
  TextArea,
  TextInput,
} from '../design/primitives';
import { useApi, useCreator, useToast } from '../app/providers';
import {
  contentLifecycleLook,
  contentLifecycleMeaning,
  formatDateTime,
} from './format';
import { useCollection, useResource, useSingleFlight } from './resource';

/**
 * Writing one item.
 *
 * The composer and the decisions about it are on one screen because they are
 * one act: a creator deciding what to say is also deciding who it is for. What
 * is deliberately not one act is saving and publishing. A draft saves as a
 * draft however finished it looks, and the control that makes something public
 * is a separate one that says so.
 *
 * Editing an existing item carries its version. A save against a version the
 * server has already replaced is refused rather than merged, so two tabs cannot
 * quietly overwrite each other — and the refusal is rendered as a refusal with
 * the one thing that resolves it.
 */

const titleBounds = { maximum: 120, minimum: 2 };
const summaryMaximum = 300;
const bodyMaximum = 20_000;

/** How far into a long catalog a deep link will look for its item. */
const lookupPageSize = 50;
const lookupPageLimit = 20;

export function NewContent() {
  return <ContentEditor item={undefined} onSaved={undefined} />;
}

/**
 * One item, found by paging the creator's own catalog.
 *
 * The contract publishes a list and no single-item read, so a deep link to an
 * item has to walk the list until it finds it. That walk is bounded: a creator
 * whose catalog runs past the bound is told the item could not be found here
 * rather than being left on a spinner while the browser works through a
 * thousand rows.
 */
export function EditContent({ contentId }: { readonly contentId: string }) {
  const api = useApi();
  const [pages, setPages] = useState(1);

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
  const item = catalog.items.find((entry) => entry.id === contentId);
  const exhausted = !catalog.hasMore || pages >= lookupPageLimit;
  const { loadMore, loading, loadingMore } = catalog;
  const found = item !== undefined;

  useEffect(() => {
    if (found || exhausted || loading || loadingMore) return;
    setPages((count) => count + 1);
    loadMore();
  }, [exhausted, found, loadMore, loading, loadingMore]);

  if (item !== undefined) {
    // The editor compares what is on the screen against what the server holds,
    // so after a save it has to be given the new answer. Without this the form
    // would go on saying there were unsaved changes to something already saved.
    return <ContentEditor item={item} onSaved={catalog.reload} />;
  }

  if (catalog.error !== undefined) {
    return (
      <>
        <PageHeader title="Item" />
        <Card>
          <ErrorState
            body={catalog.error}
            onRetry={catalog.retryable ? catalog.reload : undefined}
            testId="content-lookup-failed"
          />
        </Card>
      </>
    );
  }

  if (!catalog.settled || !exhausted) {
    return (
      <>
        <PageHeader title="Item" />
        <Card testId="content-lookup-loading">
          <CardSkeleton rows={5} />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Item" />
      <Card>
        <EmptyState
          actions={
            <ButtonLink href="/catalog" tone="primary">
              Back to your catalog
            </ButtonLink>
          }
          body="It may have been archived, or the address may be wrong. Nothing was changed."
          icon="draft"
          testId="content-not-found"
          title="That item is not in your catalog"
        />
      </Card>
    </>
  );
}

function ContentEditor({
  item,
  onSaved,
}: {
  readonly item: CreatorContent | undefined;
  /** Re-reads the catalog the editor compares itself against, after a save. */
  readonly onSaved: (() => void) | undefined;
}) {
  const api = useApi();
  const creator = useCreator();
  const router = useRouter();
  const toast = useToast();
  const { busy, run } = useSingleFlight();

  const [title, setTitle] = useState(item?.title ?? '');
  const [summary, setSummary] = useState(item?.summary ?? '');
  const [body, setBody] = useState(item?.body ?? '');
  const [audience, setAudience] = useState<'public' | 'members_only'>(
    item?.visibility ?? 'public',
  );
  const [clubId, setClubId] = useState(item?.clubId ?? '');
  const [touched, setTouched] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [confirmingArchive, setConfirmingArchive] = useState(false);

  const loadClubs = useCallback(async () => api.clubs({ pageSize: 50 }), [api]);
  const clubs = useResource<CreatorClubList>(loadClubs);
  const openClubs = (clubs.value?.clubs ?? []).filter(
    (club) => club.lifecycle !== 'closed',
  );

  const version = item?.version;
  useEffect(() => {
    if (item === undefined) return;
    setTitle(item.title);
    setSummary(item.summary ?? '');
    setBody(item.body ?? '');
    setAudience(item.visibility);
    setClubId(item.clubId ?? '');
  }, [item, version]);

  const trimmedTitle = title.trim();
  const titleError =
    !touched || trimmedTitle.length >= titleBounds.minimum
      ? undefined
      : 'Give it a title of at least two characters.';
  const bodyError =
    body.length > bodyMaximum
      ? `This is ${String(body.length - bodyMaximum)} characters over the limit.`
      : undefined;
  const blocked =
    trimmedTitle.length < titleBounds.minimum || bodyError !== undefined;

  // A new draft always counts as changed: there is nothing yet to compare it
  // against, and a Save that started life disabled would be a control nobody
  // could reach.
  const changed =
    item === undefined
      ? true
      : trimmedTitle !== item.title ||
        summary.trim() !== (item.summary ?? '') ||
        body !== (item.body ?? '') ||
        audience !== item.visibility ||
        clubId !== (item.clubId ?? '');

  const save = () => {
    setTouched(true);
    if (blocked) return;
    run(async () => {
      const result = await api.saveContent({
        ...(body.trim().length === 0 ? {} : { body }),
        ...(audience === 'members_only' && clubId.length > 0 ? { clubId } : {}),
        ...(item === undefined
          ? {}
          : { contentId: item.id, version: item.version }),
        ...(summary.trim().length === 0 ? {} : { summary: summary.trim() }),
        title: trimmedTitle,
        visibility: audience,
      });
      const failure = failureMessage(result);
      setMessage(failure);
      if (!isOk(result)) return;
      toast.show(item === undefined ? 'Draft saved.' : 'Saved.', 'positive');
      onSaved?.();
      if (item === undefined) {
        // The server answers with the whole list; the item just created is the
        // one the surface has not seen before, and the newest one is it.
        const created = result.value.content.find(
          (entry) => entry.title === trimmedTitle,
        );
        router.replace(
          created === undefined ? '/catalog' : `/catalog/${created.id}`,
        );
      }
    });
  };

  const setLifecycle = (
    lifecycle: 'draft' | 'published' | 'archived',
    confirmation: string,
  ) => {
    if (item === undefined) return;
    run(async () => {
      const failure = failureMessage(
        await api.setContentLifecycle({
          contentId: item.id,
          lifecycle,
          version: item.version,
        }),
      );
      setMessage(failure);
      if (failure === undefined) {
        toast.show(confirmation, 'positive');
        router.push('/catalog');
      }
    });
  };

  const lifecycle =
    item === undefined ? undefined : contentLifecycleLook(item.lifecycle);

  return (
    <>
      <PageHeader
        eyebrow="Catalog"
        lede={
          item === undefined
            ? 'This saves as a draft. Nobody can see a draft but you.'
            : (contentLifecycleMeaning[item.lifecycle] ?? undefined)
        }
        title={item === undefined ? 'New draft' : 'Edit item'}
      />

      {item === undefined || lifecycle === undefined ? null : (
        <div className="s-inline s-inline--tight">
          <Badge
            icon={lifecycle.icon}
            testId="content-editor-lifecycle"
            tone={lifecycle.tone}
          >
            {lifecycle.label}
          </Badge>
          <span className="s-caption s-quiet">
            Last edited {formatDateTime(item.updatedAt)}
          </span>
        </div>
      )}

      {!creator.settled || creator.canWrite ? null : (
        <Notice
          testId="content-editor-read-only"
          title="Read only for now"
          tone="caution"
        >
          Your creator access cannot change items at the moment, so nothing here
          will save.
        </Notice>
      )}

      {message === undefined ? null : (
        <ErrorMessage testId="content-editor-error">{message}</ErrorMessage>
      )}

      <Card>
        <form
          className="s-stack s-stack--5"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <Field
            count={{
              length: trimmedTitle.length,
              maximum: titleBounds.maximum,
            }}
            error={titleError}
            label="Title"
          >
            {(control) => (
              <TextInput
                {...control}
                data-testid="content-title"
                maxLength={titleBounds.maximum}
                name="title"
                onChange={(event) => {
                  setTitle(event.target.value);
                }}
                value={title}
              />
            )}
          </Field>

          <Field
            count={{ length: summary.length, maximum: summaryMaximum }}
            hint="One or two lines. It is what people see in a list before they open the item."
            label="Summary"
            optional
          >
            {(control) => (
              <TextArea
                {...control}
                data-testid="content-summary"
                maxLength={summaryMaximum}
                name="summary"
                onChange={(event) => {
                  setSummary(event.target.value);
                }}
                rows={2}
                value={summary}
              />
            )}
          </Field>

          <Field
            count={{ length: body.length, maximum: bodyMaximum }}
            error={bodyError}
            hint="The item itself. Plain text — VELORA does not format it for you."
            label="Body"
            optional
          >
            {(control) => (
              <TextArea
                {...control}
                data-testid="content-body"
                name="body"
                onChange={(event) => {
                  setBody(event.target.value);
                }}
                tall
                value={body}
              />
            )}
          </Field>

          <div className="s-form-actions">
            <Button
              busy={busy}
              data-testid="content-save"
              disabled={
                !creator.settled ||
                !creator.canWrite ||
                (item !== undefined && !changed)
              }
              tone="primary"
              type="submit"
            >
              {item === undefined ? 'Save draft' : 'Save changes'}
            </Button>
            {item !== undefined && changed ? (
              <span className="s-caption s-quiet" data-testid="content-unsaved">
                You have unsaved changes.
              </span>
            ) : null}
            <ButtonLink href="/catalog" tone="ghost">
              {item === undefined ? 'Cancel' : 'Back to catalog'}
            </ButtonLink>
          </div>
        </form>
      </Card>

      <Card>
        <CardHead
          lede="Who this is for. Changing it saves with everything else."
          title="Audience"
        />
        <div className="s-stack s-stack--3">
          <ChoiceCard
            checked={audience === 'public'}
            description="Anyone who opens your public page, once this item is published."
            label="Everyone"
            name="content-audience"
            onSelect={() => {
              setAudience('public');
            }}
            testId="content-audience-public"
            value="public"
          />
          <ChoiceCard
            checked={audience === 'members_only'}
            description="Only people who currently hold access to one of your clubs."
            label="Members of a club"
            name="content-audience"
            onSelect={() => {
              setAudience('members_only');
            }}
            testId="content-audience-members"
            value="members_only"
          />
        </div>

        {audience === 'members_only' ? (
          openClubs.length === 0 ? (
            <Notice
              testId="content-no-clubs"
              title="You have no clubs yet"
              tone="caution"
            >
              A members-only item with no club has nobody to admit, so it would
              be reachable by nobody at all. Create a club first, or set this
              back to Everyone.
            </Notice>
          ) : (
            <Field
              hint="Only clubs you own appear here. Members of that club see this item; nobody else does."
              label="Which club"
            >
              {(control) => (
                <Select
                  {...control}
                  data-testid="content-club"
                  name="clubId"
                  onChange={(event) => {
                    setClubId(event.target.value);
                  }}
                  value={clubId}
                >
                  <option value="">Choose a club</option>
                  {openClubs.map((club) => (
                    <option key={club.id} value={club.id}>
                      {club.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )
        ) : null}
      </Card>

      <Card>
        <CardHead title="A picture with this item" />
        <BlockedState
          label="Not available"
          testId="content-media-blocked"
          title="You cannot attach an image yet"
        >
          <p>
            VELORA has no approved place to store creator images and publishes
            no way to attach one to an item, so there is nothing here that would
            upload.
          </p>
          <p>
            This is a platform decision rather than something waiting on you.
          </p>
        </BlockedState>
      </Card>

      {item === undefined || !creator.canWrite ? null : (
        <Card testId="content-lifecycle-actions">
          <CardHead
            lede={
              item.lifecycle === 'published'
                ? 'This item is on your public page right now.'
                : item.lifecycle === 'archived'
                  ? 'This item has been withdrawn. It is still yours.'
                  : 'Nobody but you can see this item.'
            }
            title="Visibility"
          />
          <div className="s-inline s-inline--tight">
            {item.lifecycle === 'draft' ? (
              <Button
                busy={busy}
                data-testid="content-editor-publish"
                onClick={() => {
                  setLifecycle('published', 'Published.');
                }}
                tone="primary"
              >
                Publish
              </Button>
            ) : null}
            {item.lifecycle === 'published' ? (
              <Button
                busy={busy}
                data-testid="content-editor-unpublish"
                onClick={() => {
                  setLifecycle('draft', 'Back to a draft.');
                }}
              >
                Return to draft
              </Button>
            ) : null}
            {item.lifecycle === 'archived' ? (
              <Button
                busy={busy}
                data-testid="content-editor-restore"
                onClick={() => {
                  setLifecycle('draft', 'Back in your drafts.');
                }}
              >
                Restore as a draft
              </Button>
            ) : (
              <Button
                data-testid="content-editor-archive"
                disabled={busy}
                onClick={() => {
                  setConfirmingArchive(true);
                }}
                tone="ghost"
              >
                Archive
              </Button>
            )}
          </div>
        </Card>
      )}

      {confirmingArchive && item !== undefined ? (
        <ConfirmDialog
          busy={busy}
          confirmLabel="Archive it"
          onCancel={() => {
            setConfirmingArchive(false);
          }}
          onConfirm={() => {
            setConfirmingArchive(false);
            setLifecycle('archived', 'Archived.');
          }}
          testId="content-editor-archive-confirm"
          title={`Archive “${item.title}”?`}
        >
          <p>
            It comes off your public page immediately and stops being visible to
            anybody. It stays yours, and you can bring it back as a draft.
          </p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
