'use client';

import Link from 'next/link';
import {
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  type InputHTMLAttributes,
} from 'react';

import { Icon, type IconName } from './icons';
import { usePageHeading } from '../app/page-heading';

/**
 * The Consumer primitives.
 *
 * Each one exists because the same true thing has to be said the same way on
 * every screen: a control that is working says so, a failed action says what
 * failed and whether repeating it could help, a screen with nothing on it says
 * that rather than showing an empty box, and a capability the platform has
 * deliberately not enabled looks deliberate rather than broken.
 *
 * None of them decides anything. `docs/design/02-design-system-contract.md` is
 * explicit that visual state is not business truth: a primary-looking button has
 * not been authorized, and a badge reading "Ready" is repeating a server answer.
 * That is why nothing here has a variant named after a permission.
 */

/* ============================== Buttons ============================== */

export type ButtonTone = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className'
> {
  readonly 'data-testid'?: string;
  readonly block?: boolean;
  readonly busy?: boolean;
  readonly children: ReactNode;
  readonly icon?: IconName;
  readonly size?: 'sm' | 'md' | 'lg';
  readonly tone?: ButtonTone;
}

function buttonClass(input: {
  readonly block?: boolean | undefined;
  readonly size?: 'sm' | 'md' | 'lg' | undefined;
  readonly tone: ButtonTone;
}): string {
  return [
    'v-btn',
    `v-btn--${input.tone}`,
    input.size === undefined || input.size === 'md'
      ? undefined
      : `v-btn--${input.size}`,
    input.block === true ? 'v-btn--block' : undefined,
  ]
    .filter((value) => value !== undefined)
    .join(' ');
}

export function Button({
  block,
  busy = false,
  children,
  disabled,
  icon,
  size,
  tone = 'secondary',
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      // A control that is working is not a control that is broken, so it says
      // "busy" rather than going away. It is still disabled, because a second
      // press would be a second request.
      aria-busy={busy || undefined}
      className={buttonClass({ block, size, tone })}
      disabled={disabled === true || busy}
      type={type}
    >
      {busy ? (
        <span className="v-btn__spinner" />
      ) : icon === undefined ? null : (
        <Icon name={icon} size="sm" />
      )}
      {children}
    </button>
  );
}

export function ButtonLink({
  block,
  children,
  href,
  icon,
  size,
  tone = 'secondary',
  ...rest
}: {
  readonly block?: boolean;
  readonly children: ReactNode;
  readonly 'data-testid'?: string;
  readonly href: string;
  readonly icon?: IconName;
  readonly size?: 'sm' | 'md' | 'lg';
  readonly tone?: ButtonTone;
}) {
  return (
    <Link
      {...rest}
      className={buttonClass({ block, size, tone })}
      href={href}
      style={{
        color: tone === 'primary' ? 'var(--text-on-accent)' : undefined,
      }}
    >
      {icon === undefined ? null : <Icon name={icon} size="sm" />}
      {children}
    </Link>
  );
}

export function IconButton({
  label,
  name,
  size = 'md',
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> & {
  readonly 'data-testid'?: string;
  /** Required. An icon-only control with no name is a control nobody can use. */
  readonly label: string;
  readonly name: IconName;
  readonly size?: 'sm' | 'md';
}) {
  return (
    <button
      {...rest}
      aria-label={label}
      className={`v-icon-btn${size === 'sm' ? ' v-icon-btn--sm' : ''}`}
      type={rest.type ?? 'button'}
    >
      <Icon name={name} size={size} />
    </button>
  );
}

/* =============================== Forms =============================== */

export interface FieldProps {
  readonly children: (control: {
    readonly 'aria-describedby': string | undefined;
    readonly 'aria-invalid': boolean | undefined;
    readonly id: string;
  }) => ReactNode;
  readonly count?: { readonly length: number; readonly maximum: number };
  readonly error?: string | undefined;
  readonly hint?: ReactNode;
  readonly label: ReactNode;
  readonly optional?: boolean;
}

/**
 * A label, its control, its explanation, and its error, wired together.
 *
 * The wiring is the point. A hint that is not referenced by `aria-describedby`
 * is a hint a screen reader never reaches, and an error announced somewhere else
 * on the page is an error nobody associates with the field that caused it.
 */
export function Field({
  children,
  count,
  error,
  hint,
  label,
  optional = false,
}: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [
    hint === undefined ? undefined : hintId,
    error === undefined ? undefined : errorId,
  ]
    .filter((value) => value !== undefined)
    .join(' ');

  return (
    <div className="v-field">
      <label className="v-field__label" htmlFor={id}>
        {label}
        {optional ? (
          <span className="v-field__optional"> (optional)</span>
        ) : null}
      </label>
      {children({
        'aria-describedby': describedBy.length > 0 ? describedBy : undefined,
        'aria-invalid': error === undefined ? undefined : true,
        id,
      })}
      {hint === undefined &&
      count === undefined &&
      error === undefined ? null : (
        <div className="v-field__foot">
          {hint === undefined ? null : (
            <p className="v-field__hint" id={hintId}>
              {hint}
            </p>
          )}
          {count === undefined ? null : (
            <span
              className="v-field__count"
              style={
                count.length > count.maximum
                  ? { color: 'var(--status-critical)' }
                  : undefined
              }
            >
              {count.length}/{count.maximum}
            </span>
          )}
        </div>
      )}
      {error === undefined ? null : (
        /*
          Announced as well as described. `aria-describedby` reads the error
          when focus reaches the field; a validation error that appears after
          a failed submit, while focus is still on the button, reaches nobody
          without this.
        */
        <p className="v-field__error" id={errorId} role="alert">
          <Icon name="alert" size="sm" />
          {error}
        </p>
      )}
    </div>
  );
}

export function TextInput(
  props: Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>,
) {
  return <input {...props} className="v-control" />;
}

export function TextArea(
  props: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>,
) {
  return <textarea {...props} className="v-control" />;
}

export function Select(
  props: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'>,
) {
  return <select {...props} className="v-control" />;
}

export function Switch({
  checked,
  description,
  disabled = false,
  label,
  onChange,
  testId,
}: {
  readonly checked: boolean;
  readonly description?: ReactNode;
  readonly disabled?: boolean;
  readonly label: ReactNode;
  readonly onChange: (next: boolean) => void;
  readonly testId?: string;
}) {
  return (
    <label className="v-switch">
      <span className="v-switch__text">
        <span>{label}</span>
        {description === undefined ? null : (
          <span className="v-caption v-quiet">{description}</span>
        )}
      </span>
      <input
        checked={checked}
        className="v-visually-hidden"
        data-testid={testId}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
        type="checkbox"
      />
      <span className="v-switch__track">
        <span className="v-switch__thumb" />
      </span>
    </label>
  );
}

export function Choice({
  checked,
  label,
  name,
  onSelect,
  value,
}: {
  readonly checked: boolean;
  readonly label: ReactNode;
  readonly name: string;
  readonly onSelect: () => void;
  readonly value: string;
}) {
  return (
    <label className="v-choice">
      <input
        checked={checked}
        name={name}
        onChange={onSelect}
        type="radio"
        value={value}
      />
      <span>{label}</span>
    </label>
  );
}

/* ============================== Surfaces ============================= */

export function Card({
  children,
  flush = false,
  testId,
}: {
  readonly children: ReactNode;
  readonly flush?: boolean;
  readonly testId?: string;
}) {
  return (
    <div
      className={`v-card${flush ? ' v-card--flush' : ''}`}
      data-testid={testId}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  actions,
  lede,
  title,
}: {
  readonly actions?: ReactNode;
  readonly lede?: ReactNode;
  readonly title: string;
}) {
  // Offered to whatever shell is above this page, which uses it to decide
  // whether its own bar should be naming the page as well. Outside a shell the
  // registration is a no-op.
  const register = usePageHeading();
  return (
    <header className="v-page-header">
      <div className="v-page-header__row">
        <h1 className="v-title" ref={register}>
          {title}
        </h1>
        {actions === undefined ? null : (
          <div className="v-inline v-inline--tight">{actions}</div>
        )}
      </div>
      {lede === undefined ? null : (
        <p className="v-page-header__lede">{lede}</p>
      )}
    </header>
  );
}

/**
 * A titled block of one page.
 *
 * The same four decisions were being made by hand everywhere a screen had more
 * than one subject on it: the landmark, the heading level, the identifier that
 * ties the two together, and the rhythm inside. Made once here they are the
 * same on Memberships, Safety, Settings, and You — and the heading a screen
 * reader announces for a region can no longer drift from the words above it,
 * because there is only one place either is written.
 *
 * A section is not a card by default. Several of these are a heading over a
 * list on the page's own ground, and putting every one of them inside a raised
 * box is what turns a product into a wall of panels.
 */
export function Section({
  actions,
  children,
  gap = 5,
  raised = false,
  testId,
  title,
}: {
  /** Something the section as a whole offers, beside its heading. */
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  /** The rhythm between the heading and what follows it. */
  readonly gap?: 4 | 5;
  /** Drawn on its own surface, for a block that is a thing rather than a part. */
  readonly raised?: boolean;
  readonly testId?: string;
  readonly title: string;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={raised ? 'v-card' : undefined}
      data-testid={testId}
    >
      <div className={`v-stack v-stack--${String(gap)}`}>
        <div className="v-section__head">
          <h2 className="v-subheading" id={headingId}>
            {title}
          </h2>
          {actions === undefined ? null : (
            <div className="v-inline v-inline--tight">{actions}</div>
          )}
        </div>
        {children}
      </div>
    </section>
  );
}

/* ============================== Identity ============================= */

const avatarTones = 6;

/**
 * Initials, and never more than two.
 *
 * Taken from the first and last word so "Imogen Whitfield-Ashworth" reads as IW
 * rather than as the first two letters of her first name, and grapheme-aware so
 * a name in a script outside the Latin range is not cut mid-character.
 */
export function initialsOf(displayName: string): string {
  const words = displayName
    .split(/[\s·]+/u)
    .map((word) => /\p{L}|\p{N}/u.exec(word)?.[0])
    .filter((glyph) => glyph !== undefined);
  if (words.length === 0) return '·';
  const first = words[0] ?? '';
  const last = words.length > 1 ? (words.at(-1) ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

/** A stable tone per person, so the same person is the same colour everywhere. */
export function toneOf(seed: string): number {
  let total = 0;
  for (const glyph of seed) {
    total = (total + (glyph.codePointAt(0) ?? 0)) % 9973;
  }
  return (total % avatarTones) + 1;
}

/**
 * A person, as small as a list row.
 *
 * A photograph when there is one to show and a monogram on a stable tone when
 * there is not, and the two are the same shape so a list does not reflow as
 * addresses arrive. Which one a person gets is never explained: an image that
 * is still processing, one its owner removed, and one this viewer may not be
 * shown all render identically, because saying which would disclose something
 * about somebody else.
 *
 * The image is decorative in the accessibility tree. The person's name is
 * always rendered as text beside it by every caller, so announcing the picture
 * as well would read the same name twice.
 */
export function Avatar({
  displayName,
  seed,
  size = 'sm',
  src,
}: {
  readonly displayName: string;
  /** Usually the person's identifier, so the tone survives a name change. */
  readonly seed?: string;
  readonly size?: 'xs' | 'sm' | 'md' | 'lg';
  /** A short-lived address. Absent whenever there is nothing to show. */
  readonly src?: string | undefined;
}) {
  const className = `v-avatar v-avatar--${size} v-avatar--tone-${String(
    toneOf(seed ?? displayName),
  )}`;
  if (src === undefined) {
    return (
      <span aria-hidden="true" className={className}>
        {initialsOf(displayName)}
      </span>
    );
  }
  return (
    <span aria-hidden="true" className={`${className} v-avatar--image`}>
      {/* A plain element rather than the framework's optimised one. The
          address is short-lived, viewer-scoped, and issued per request, so
          there is nothing a build-time or origin-side pipeline could fetch,
          cache, or resize without holding a credential of its own. */}
      <img alt="" className="v-avatar__image" src={src} />
    </span>
  );
}

/* =============================== Status ============================== */

export type Tone =
  'neutral' | 'accent' | 'positive' | 'caution' | 'critical' | 'info';

export function Badge({
  children,
  icon,
  tone = 'neutral',
  testId,
}: {
  readonly children: ReactNode;
  readonly icon?: IconName;
  readonly testId?: string;
  readonly tone?: Tone;
}) {
  return (
    <span className={`v-badge v-badge--${tone}`} data-testid={testId}>
      {icon === undefined ? null : <Icon name={icon} size="sm" />}
      {children}
    </span>
  );
}

export function Chip({ children }: { readonly children: ReactNode }) {
  return <span className="v-chip">{children}</span>;
}

/* ============================== Messages ============================= */

const noticeIcons: Readonly<
  Record<'info' | 'caution' | 'critical' | 'quiet', IconName>
> = {
  caution: 'alert',
  critical: 'alert',
  info: 'info',
  quiet: 'info',
};

export function Notice({
  children,
  icon,
  testId,
  title,
  tone = 'info',
}: {
  readonly children?: ReactNode;
  readonly icon?: IconName;
  readonly testId?: string;
  readonly title?: ReactNode;
  readonly tone?: 'info' | 'caution' | 'critical' | 'quiet';
}) {
  return (
    <div className={`v-notice v-notice--${tone}`} data-testid={testId}>
      <span className="v-notice__icon">
        <Icon name={icon ?? noticeIcons[tone]} size="md" />
      </span>
      <div className="v-notice__body">
        {title === undefined ? null : <p className="v-subheading">{title}</p>}
        {children === undefined ? null : (
          <div className="v-small v-muted">{children}</div>
        )}
      </div>
    </div>
  );
}

/**
 * Progress and confirmations, announced without interrupting.
 *
 * `role="status"` rather than `role="alert"`: somebody typing should not be cut
 * across by a screen saying it finished loading.
 */
export function StatusMessage({
  children,
  testId,
}: {
  readonly children: ReactNode;
  readonly testId?: string;
}) {
  return (
    <p
      aria-live="polite"
      className="v-inline-status"
      data-testid={testId}
      role="status"
    >
      {children}
    </p>
  );
}

/**
 * A failure, said once and assertively.
 *
 * `role="alert"` because somebody who pressed a button and heard nothing will
 * press it again.
 */
export function ErrorMessage({
  children,
  testId,
}: {
  readonly children: ReactNode;
  readonly testId?: string;
}) {
  return (
    <p className="v-inline-error" data-testid={testId} role="alert">
      <Icon name="alert" size="sm" />
      <span>{children}</span>
    </p>
  );
}

/* =========================== Empty and blocked ======================= */

export function EmptyState({
  actions,
  body,
  icon = 'sparkle',
  testId,
  title,
}: {
  readonly actions?: ReactNode;
  readonly body?: ReactNode;
  readonly icon?: IconName;
  readonly testId: string;
  readonly title: string;
}) {
  return (
    <div className="v-empty" data-testid={testId}>
      <span className="v-empty__mark">
        <Icon name={icon} size="lg" />
      </span>
      <p className="v-subheading">{title}</p>
      {body === undefined ? null : <p className="v-empty__body">{body}</p>}
      {actions === undefined ? null : (
        <div className="v-empty__actions">{actions}</div>
      )}
    </div>
  );
}

/**
 * A capability that is deliberately unavailable.
 *
 * Visually distinct from an error, because nothing here failed. The platform has
 * made a decision it can explain, and a screen that looked broken would send
 * somebody to support over something support cannot change.
 */
export function BlockedState({
  children,
  label = 'Not available yet',
  testId,
  title,
}: {
  readonly children: ReactNode;
  readonly label?: string;
  readonly testId: string;
  readonly title: string;
}) {
  return (
    <div className="v-blocked" data-testid={testId}>
      <p className="v-blocked__head">
        <Icon name="lock" size="sm" />
        <span className="v-label">{label}</span>
      </p>
      <p className="v-subheading">{title}</p>
      <div className="v-small v-muted v-measure">{children}</div>
    </div>
  );
}

/* ============================== Skeletons ============================ */

export function Skeleton({
  circle = false,
  height,
  width,
}: {
  readonly circle?: boolean;
  readonly height: number | string;
  readonly width?: number | string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`v-skeleton${circle ? ' v-skeleton--circle' : ''}`}
      style={{
        display: 'block',
        height: typeof height === 'number' ? `${String(height)}px` : height,
        width:
          width === undefined
            ? '100%'
            : typeof width === 'number'
              ? `${String(width)}px`
              : width,
      }}
    />
  );
}

/**
 * A placeholder shaped like the row it stands in for.
 *
 * The shape is what stops the jump: a skeleton the same height as its content
 * means the page does not move when the answer arrives, and a page that moves
 * under a finger is a page that gets the wrong thing tapped.
 */
export function RowSkeleton({ rows = 3 }: { readonly rows?: number }) {
  return (
    <ul aria-hidden="true" className="v-list">
      {Array.from({ length: rows }, (_, index) => (
        <li className="v-row" key={index}>
          <Skeleton circle height={40} width={40} />
          <span className="v-row__body">
            <Skeleton height={12} width="42%" />
            <span style={{ display: 'block', height: 'var(--space-2)' }} />
            <Skeleton height={12} width="72%" />
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ================================ Tabs =============================== */

export interface SegmentedOption<T extends string> {
  readonly count?: number;
  readonly label: string;
  readonly value: T;
}

/**
 * One choice out of a few, as a row of tabs.
 *
 * `role="tablist"` is a promise about the keyboard as much as about the name a
 * screen reader reads: the arrow keys move between tabs, Home and End go to the
 * ends, and the group is one stop on the Tab key rather than one stop per
 * option. Claiming the role and leaving every tab separately tabbable is the
 * version that reads correctly and behaves like nothing the reader was told to
 * expect, so the keys are implemented here.
 *
 * The row scrolls sideways when it has to — three long labels do not fit a
 * 320 px phone at any type size — and the stylesheet marks the edge it is
 * scrolled away from, because an option cut off with no cue is an option
 * nobody knows is there.
 */
export function Segmented<T extends string>({
  as = 'tabs',
  label,
  onChange,
  options,
  value,
}: {
  /**
   * What this group of options actually is.
   *
   * Tabs by default, which is what it is on Discover, Introductions and the
   * Live door: choosing one changes which part of the page is shown. It is
   * not what it is on a join form, where the same control picks how often
   * somebody pays — that is a choice inside a form, and calling it a tab
   * tells a reader the page is about to change when it is not. The keyboard
   * behaviour is identical either way: both patterns are one tab stop with
   * arrow keys that move and select.
   */
  readonly as?: 'tabs' | 'radiogroup';
  readonly label: string;
  readonly onChange: (next: T) => void;
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
}) {
  const tabs = as === 'tabs';
  const strip = useRef<HTMLDivElement>(null);

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    const current = options.findIndex((option) => option.value === value);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? options.length - 1
          : step === 0
            ? -1
            : // Wraps, which is what a tablist does. A row of three where the
              // last one cannot be reached from the first is a row that behaves
              // differently depending on which end somebody started at.
              (current + step + options.length) % options.length;
    const chosen = options[next];
    if (chosen === undefined) return;
    event.preventDefault();
    onChange(chosen.value);
    // Focus follows selection, which is the pattern for a tablist whose panels
    // are already on the page: moving the focus without moving the selection
    // would leave somebody reading one section while another is highlighted.
    const items =
      strip.current?.querySelectorAll<HTMLButtonElement>('.v-segmented__item');
    items?.item(next).focus();
  };

  return (
    <div
      aria-label={label}
      className="v-segmented"
      onKeyDown={move}
      ref={strip}
      role={tabs ? 'tablist' : 'radiogroup'}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            {...(tabs
              ? { 'aria-selected': selected }
              : { 'aria-checked': selected })}
            className="v-segmented__item"
            data-testid={`segment-${option.value}`}
            key={option.value}
            onClick={() => {
              onChange(option.value);
            }}
            role={tabs ? 'tab' : 'radio'}
            // One stop for the whole group. Everything inside it is reached
            // with the arrow keys the role already promised.
            tabIndex={selected ? 0 : -1}
            type="button"
          >
            {option.label}
            {option.count === undefined ? null : (
              <span className="v-segmented__count">{option.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ================================ Rows =============================== */

export function ListRow({
  aside,
  children,
  current = false,
  href,
  onClick,
  testId,
  unread = false,
}: {
  readonly aside?: ReactNode;
  readonly children: ReactNode;
  readonly current?: boolean;
  readonly href?: string;
  readonly onClick?: () => void;
  readonly testId?: string;
  /** Something in this row has not been read. Never the only cue. */
  readonly unread?: boolean;
}) {
  const className = [
    'v-row',
    href === undefined && onClick === undefined
      ? undefined
      : 'v-row--interactive',
    unread ? 'v-row--unread' : undefined,
  ]
    .filter((value) => value !== undefined)
    .join(' ');
  const content = (
    <>
      {children}
      {aside === undefined ? null : (
        <span className="v-row__aside">{aside}</span>
      )}
    </>
  );

  if (href !== undefined) {
    return (
      <Link
        aria-current={current ? 'true' : undefined}
        className={className}
        data-testid={testId}
        href={href}
      >
        {content}
      </Link>
    );
  }
  if (onClick !== undefined) {
    return (
      <button
        aria-current={current ? 'true' : undefined}
        className={className}
        data-testid={testId}
        onClick={onClick}
        type="button"
      >
        {content}
      </button>
    );
  }
  return (
    <div className={className} data-testid={testId}>
      {content}
    </div>
  );
}
