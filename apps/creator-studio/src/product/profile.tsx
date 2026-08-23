'use client';

import { useEffect, useState } from 'react';

import type {
  CreatorProfile,
  CreatorProfileLink,
} from '@velora/creator-client';
import { failureMessage } from '@velora/creator-client';

import {
  Badge,
  BlockedState,
  Button,
  ButtonLink,
  Card,
  CardHead,
  CardSkeleton,
  CreatorAvatar,
  ErrorMessage,
  ErrorState,
  Field,
  IconButton,
  Notice,
  PageHeader,
  TextArea,
  TextInput,
} from '../design/primitives';
import { useApi, useCreator, useToast } from '../app/providers';
import { useSingleFlight } from './resource';

/**
 * The creator's public identity.
 *
 * Three things about this screen are decisions rather than layout.
 *
 * The handle input disappears once a handle exists, because this milestone has
 * no rename: leaving an editable field the server would refuse is a worse
 * answer than not offering one. Publishing is a separate control from saving,
 * so nothing a creator writes reaches the public internet as a side effect of
 * writing it. And the links a creator has already saved travel back with every
 * save, because a form that omitted them would quietly delete them the first
 * time somebody edited their bio.
 *
 * The bounds below are the contract's own. They are here so a creator finds out
 * about a too-long bio while typing rather than after a round trip; the server
 * still decides, and its refusal is rendered as a refusal.
 */

const handlePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{1,28}[A-Za-z0-9]$/u;
const displayNameBounds = { maximum: 60, minimum: 2 };
const bioMaximum = 600;
const linkLabelMaximum = 40;
const linkUrlMaximum = 200;
const linksMaximum = 5;

interface DraftLink {
  readonly key: string;
  readonly label: string;
  readonly url: string;
}

/** A stable key per row, so editing one row does not remount the others. */
let nextLinkKey = 0;
function draftLink(link?: CreatorProfileLink): DraftLink {
  nextLinkKey += 1;
  return {
    key: `link-${String(nextLinkKey)}`,
    label: link?.label ?? '',
    url: link?.url ?? '',
  };
}

export function ProfileScreen() {
  const creator = useCreator();
  const profile = creator.profile.value;

  /*
   * Answered once, rather than answered right now.
   *
   * Every save re-reads, and a screen that fell back to a placeholder while a
   * re-read was in flight would unmount the form — taking the creator's typing
   * and the refusal it was just told about with it. A refused save is exactly
   * when somebody most needs to still be looking at what they wrote.
   */
  const answered =
    profile !== undefined ||
    creator.profile.missing ||
    creator.profile.error !== undefined;

  if (!answered) {
    return (
      <>
        <PageHeader title="Public page" />
        <Card testId="creator-profile-loading">
          <CardSkeleton rows={4} />
        </Card>
      </>
    );
  }

  if (creator.profile.error !== undefined && profile === undefined) {
    return (
      <>
        <PageHeader title="Public page" />
        <Card>
          <ErrorState
            body={creator.profile.error}
            onRetry={creator.profile.retryable ? creator.reloadAll : undefined}
            testId="creator-profile-failed"
          />
        </Card>
      </>
    );
  }

  return <ProfileEditor key={profile?.version ?? 0} profile={profile} />;
}

function ProfileEditor({
  profile,
}: {
  readonly profile: CreatorProfile | undefined;
}) {
  const api = useApi();
  const creator = useCreator();
  const toast = useToast();
  const { busy, run } = useSingleFlight();

  const [handle, setHandle] = useState(profile?.handle ?? '');
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [links, setLinks] = useState<readonly DraftLink[]>(
    (profile?.links ?? []).map((link) => draftLink(link)),
  );
  const [touched, setTouched] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);
  // The server's values win whenever it answers. A local draft that survived a
  // successful save would be a second opinion about what is stored.
  const version = profile?.version;
  useEffect(() => {
    if (profile === undefined) return;
    setHandle(profile.handle);
    setDisplayName(profile.displayName);
    setBio(profile.bio ?? '');
    setLinks(profile.links.map((link) => draftLink(link)));
  }, [profile, version]);

  const trimmedHandle = handle.trim();
  const trimmedName = displayName.trim();
  const filledLinks = links.filter((link) => link.url.trim().length > 0);

  const handleError =
    profile !== undefined || !touched || trimmedHandle.length === 0
      ? undefined
      : handlePattern.test(trimmedHandle)
        ? undefined
        : 'Use 3 to 30 letters, numbers, hyphens or underscores, starting and ending with a letter or number.';
  const nameError =
    !touched || trimmedName.length >= displayNameBounds.minimum
      ? undefined
      : 'Your display name needs at least two characters.';
  const bioError =
    bio.length > bioMaximum
      ? `Your bio is ${String(bio.length - bioMaximum)} characters over the limit.`
      : undefined;
  const linkError = filledLinks.some(
    (link) => link.url.trim().length > linkUrlMaximum,
  )
    ? 'One of your links is too long.'
    : undefined;

  const blocked =
    trimmedName.length < displayNameBounds.minimum ||
    bioError !== undefined ||
    linkError !== undefined ||
    (profile === undefined &&
      (trimmedHandle.length === 0 || !handlePattern.test(trimmedHandle)));

  // A page that does not exist yet always counts as changed: there is nothing
  // to compare it against, and a Save that started life disabled would be a
  // control nobody could reach.
  const changed =
    profile === undefined
      ? true
      : trimmedName !== profile.displayName ||
        bio !== (profile.bio ?? '') ||
        JSON.stringify(
          filledLinks.map((link) => ({
            label: link.label.trim(),
            url: link.url.trim(),
          })),
        ) !==
          JSON.stringify(
            profile.links.map((link) => ({
              label: link.label ?? '',
              url: link.url,
            })),
          );

  const save = () => {
    setTouched(true);
    if (blocked) return;
    run(async () => {
      const result = await api.saveProfile({
        ...(bio.trim().length === 0 ? {} : { bio: bio.trim() }),
        displayName: trimmedName,
        handle: profile?.handle ?? trimmedHandle,
        links: filledLinks.map((link) => ({
          ...(link.label.trim().length === 0
            ? {}
            : { label: link.label.trim() }),
          url: link.url.trim(),
        })),
        ...(profile === undefined ? {} : { version: profile.version }),
      });
      const failure = failureMessage(result, {
        conflict:
          profile === undefined
            ? 'That handle is already taken. Choose another one.'
            : 'Your page changed somewhere else while you were editing. Reload and try again.',
      });
      setMessage(failure);
      if (failure === undefined) {
        toast.show(
          profile === undefined ? 'Your page is ready.' : 'Saved.',
          'positive',
        );
      }
      creator.reloadAll();
    });
  };

  return (
    <>
      <PageHeader
        actions={
          profile === undefined ? undefined : (
            <ButtonLink href="/profile/preview" icon="eye" size="sm">
              Preview
            </ButtonLink>
          )
        }
        lede={
          profile === undefined
            ? 'This is the page people reach when they follow a link to you. It does not exist until you claim a handle.'
            : 'Everything here is public once your page is published, and only once it is.'
        }
        title="Public page"
      />

      {profile === undefined ? null : <PublicationCard profile={profile} />}

      <Card>
        <CardHead
          lede={
            profile === undefined
              ? 'Your handle becomes your public address. It cannot be changed later, so choose it as carefully as you would a domain.'
              : undefined
          }
          title="Identity"
        />

        {message === undefined ? null : (
          <ErrorMessage testId="creator-profile-error">{message}</ErrorMessage>
        )}

        <form
          className="s-stack s-stack--5"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          {profile === undefined ? (
            <Field
              error={handleError}
              hint={
                trimmedHandle.length === 0
                  ? 'Letters, numbers, hyphens and underscores.'
                  : `Your page will be at /c/${trimmedHandle.toLowerCase()}`
              }
              label="Handle"
            >
              {(control) => (
                <TextInput
                  {...control}
                  autoCapitalize="none"
                  autoComplete="off"
                  data-testid="creator-handle"
                  maxLength={30}
                  name="handle"
                  onChange={(event) => {
                    setHandle(event.target.value);
                  }}
                  placeholder="embervale"
                  spellCheck={false}
                  value={handle}
                />
              )}
            </Field>
          ) : (
            <div className="s-field">
              <p className="s-field__label">Handle</p>
              <p className="s-handle-fixed" data-testid="creator-handle-fixed">
                <CreatorAvatar
                  displayName={profile.displayName}
                  seed={profile.handle}
                  size="sm"
                />
                <span className="s-wrap">@{profile.handle}</span>
              </p>
              <p className="s-field__hint">
                Handles cannot be changed yet, because other people already have
                links that use this one.
              </p>
            </div>
          )}

          <Field
            count={{
              length: trimmedName.length,
              maximum: displayNameBounds.maximum,
            }}
            error={nameError}
            hint="The name people see. It can be different from your VELORA name."
            label="Display name"
          >
            {(control) => (
              <TextInput
                {...control}
                data-testid="creator-display-name"
                maxLength={displayNameBounds.maximum}
                name="displayName"
                onChange={(event) => {
                  setDisplayName(event.target.value);
                }}
                value={displayName}
              />
            )}
          </Field>

          <Field
            count={{ length: bio.length, maximum: bioMaximum }}
            error={bioError}
            hint="A short introduction. It appears under your name on your page."
            label="About you"
            optional
          >
            {(control) => (
              <TextArea
                {...control}
                data-testid="creator-bio"
                name="bio"
                onChange={(event) => {
                  setBio(event.target.value);
                }}
                rows={4}
                value={bio}
              />
            )}
          </Field>

          <LinksField error={linkError} links={links} onChange={setLinks} />

          <div className="s-form-actions">
            <Button
              busy={busy}
              data-testid="creator-save-profile"
              disabled={profile !== undefined && !changed}
              tone="primary"
              type="submit"
            >
              {profile === undefined ? 'Create your page' : 'Save changes'}
            </Button>
            {profile !== undefined && changed ? (
              <span
                className="s-caption s-quiet"
                data-testid="creator-profile-unsaved"
              >
                You have unsaved changes.
              </span>
            ) : null}
          </div>
        </form>
      </Card>

      <Card>
        <CardHead title="A picture of you" />
        <BlockedState
          label="Not available"
          testId="creator-media-blocked"
          title="You cannot add a photograph yet"
        >
          <p>
            VELORA has no approved place to store creator images and no way to
            deliver one, so there is nothing here that would upload. Your page
            shows the mark above instead, drawn from your handle.
          </p>
          <p>
            This is a platform decision rather than something waiting on you.
          </p>
        </BlockedState>
      </Card>
    </>
  );
}

/**
 * Publishing, as its own decision with its own control.
 *
 * The button says what will happen to who can see the page, not what state a
 * field will be set to. A creator pressing this is deciding whether strangers
 * can read their work.
 */
function PublicationCard({ profile }: { readonly profile: CreatorProfile }) {
  const api = useApi();
  const creator = useCreator();
  const toast = useToast();
  const { busy, run } = useSingleFlight();
  const [message, setMessage] = useState<string | undefined>(undefined);
  const published = profile.publication === 'published';

  return (
    <Card
      testId="creator-publication-card"
      {...(published ? {} : { tone: 'accent' as const })}
    >
      <div className="s-next-step">
        <div className="s-stack s-stack--3">
          <div className="s-inline s-inline--tight">
            {published ? (
              <Badge icon="globe" testId="creator-publication" tone="positive">
                Published
              </Badge>
            ) : (
              <Badge icon="draft" testId="creator-publication" tone="caution">
                Draft
              </Badge>
            )}
            <span className="s-chip s-wrap" data-testid="creator-public-path">
              {profile.publicPath}
            </span>
          </div>
          <p className="s-small s-muted s-measure">
            {published
              ? 'Anyone with that address can read your published items and see your published clubs. Your drafts stay yours.'
              : 'Nobody can open that address. Saving your details does not publish them — this control does.'}
          </p>
        </div>
        <div className="s-next-step__action">
          <Button
            busy={busy}
            data-testid="creator-toggle-publication"
            tone={published ? 'secondary' : 'primary'}
            onClick={() => {
              run(async () => {
                const failure = failureMessage(
                  await api.setPublication({
                    publication: published ? 'draft' : 'published',
                    version: profile.version,
                  }),
                  {
                    conflict:
                      'Your page changed somewhere else since this page was loaded. Reload and try again.',
                  },
                );
                setMessage(failure);
                if (failure === undefined) {
                  toast.show(
                    published
                      ? 'Your page is a draft again.'
                      : 'Your page is live.',
                    'positive',
                  );
                }
                creator.reloadAll();
              });
            }}
          >
            {published ? 'Take the page down' : 'Publish this page'}
          </Button>
        </div>
      </div>
      {message === undefined ? null : (
        <ErrorMessage testId="creator-publication-error">
          {message}
        </ErrorMessage>
      )}
    </Card>
  );
}

/**
 * Up to five links, each with an optional label.
 *
 * Kept as rows rather than as a text area of one-per-line, because a label and
 * an address are two fields and asking somebody to encode two fields into one
 * line is asking them to learn a syntax.
 */
function LinksField({
  error,
  links,
  onChange,
}: {
  readonly error: string | undefined;
  readonly links: readonly DraftLink[];
  readonly onChange: (next: readonly DraftLink[]) => void;
}) {
  const full = links.length >= linksMaximum;

  return (
    <fieldset className="s-fieldset">
      <legend className="s-field__label">Links</legend>
      <p className="s-field__hint">
        Up to {linksMaximum}. They appear on your page exactly as written, and
        VELORA does not check where they go.
      </p>

      {links.length === 0 ? null : (
        <ul className="s-stack s-stack--3" data-testid="creator-links">
          {links.map((link, index) => (
            <li className="s-link-row" key={link.key}>
              <TextInput
                aria-label={`Link ${String(index + 1)} label`}
                data-testid={`creator-link-label-${String(index)}`}
                maxLength={linkLabelMaximum}
                onChange={(event) => {
                  onChange(
                    links.map((existing) =>
                      existing.key === link.key
                        ? { ...existing, label: event.target.value }
                        : existing,
                    ),
                  );
                }}
                placeholder="Label"
                value={link.label}
              />
              <TextInput
                aria-label={`Link ${String(index + 1)} address`}
                data-testid={`creator-link-url-${String(index)}`}
                inputMode="url"
                maxLength={linkUrlMaximum}
                onChange={(event) => {
                  onChange(
                    links.map((existing) =>
                      existing.key === link.key
                        ? { ...existing, url: event.target.value }
                        : existing,
                    ),
                  );
                }}
                placeholder="https://example.com"
                spellCheck={false}
                value={link.url}
              />
              <IconButton
                data-testid={`creator-link-remove-${String(index)}`}
                label={`Remove link ${String(index + 1)}`}
                name="trash"
                onClick={() => {
                  onChange(
                    links.filter((existing) => existing.key !== link.key),
                  );
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {error === undefined ? null : <p className="s-field__error">{error}</p>}

      <Button
        data-testid="creator-link-add"
        disabled={full}
        icon="plus"
        size="sm"
        onClick={() => {
          onChange([...links, draftLink()]);
        }}
      >
        Add a link
      </Button>
      {full ? (
        <p className="s-field__hint">
          That is the maximum. Remove one to add another.
        </p>
      ) : null}
    </fieldset>
  );
}

/** Kept beside the editor so the preview screen can use the same notice. */
export function NoPageYet() {
  return (
    <Notice testId="creator-no-page" title="There is no page yet" tone="quiet">
      Claim a handle first. Until you do, there is nothing for a visitor to
      open.
    </Notice>
  );
}
