'use client';

import Link from 'next/link';
import {
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

import { Icon, type IconName } from './icons';

/**
 * The Creator Studio primitives.
 *
 * Each one exists because the same true thing has to be said the same way on
 * every screen: a control that is working says so, a failed action says what
 * failed and whether repeating it could help, a screen with nothing on it says
 * that rather than showing an empty box, and a capability the platform has
 * deliberately not enabled looks deliberate rather than broken.
 *
 * None of them decides anything. `docs/design/02-design-system-contract.md` is
 * explicit that visual state is not business truth: a primary-looking button has
 * not been authorized, and a badge reading "Published" is repeating a server
 * answer. That is why nothing here has a variant named after a permission.
 *
 * This is Studio's own set rather than a shared one. `AGENTS.md` keeps the
 * surfaces separate, and forcing one component library across a consumer feed
 * and a creator workspace would make both worse than either.
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
    's-btn',
    `s-btn--${input.tone}`,
    input.size === undefined || input.size === 'md'
      ? undefined
      : `s-btn--${input.size}`,
    input.block === true ? 's-btn--block' : undefined,
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
        <span className="s-btn__spinner" />
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
      className={`s-icon-btn${size === 'sm' ? ' s-icon-btn--sm' : ''}`}
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
    <div className="s-field">
      <label className="s-field__label" htmlFor={id}>
        {label}
        {optional ? (
          <span className="s-field__optional"> (optional)</span>
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
        <div className="s-field__foot">
          {hint === undefined ? null : (
            <p className="s-field__hint" id={hintId}>
              {hint}
            </p>
          )}
          {count === undefined ? null : (
            <span
              className="s-field__count s-numeric"
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
        <p className="s-field__error" id={errorId}>
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
  return <input {...props} className="s-control" />;
}

export function TextArea({
  tall = false,
  ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> & {
  /** A composer rather than a one-line note. */
  readonly tall?: boolean;
}) {
  return (
    <textarea
      {...props}
      className={`s-control s-control--area${tall ? ' s-control--tall' : ''}`}
    />
  );
}

export function Select(
  props: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'>,
) {
  return (
    <span className="s-select">
      <select {...props} className="s-control" />
      <Icon className="s-select__mark" name="chevronDown" size="sm" />
    </span>
  );
}

/**
 * One choice out of a small set, laid out as cards rather than a menu.
 *
 * Used where the choice carries a consequence somebody should read before
 * making it — who a piece of work is for, for instance — because a dropdown
 * hides the consequence behind an interaction.
 */
export function ChoiceCard({
  checked,
  description,
  label,
  name,
  onSelect,
  testId,
  value,
}: {
  readonly checked: boolean;
  readonly description?: ReactNode;
  readonly label: ReactNode;
  readonly name: string;
  readonly onSelect: () => void;
  readonly testId?: string;
  readonly value: string;
}) {
  return (
    // The identifier is on the label rather than on the input, because the
    // label is what a person presses: the input itself is a one-pixel box
    // underneath it, and anything aiming at that is aiming at the wrong thing.
    <label
      className={`s-choice${checked ? ' s-choice--on' : ''}`}
      data-testid={testId}
    >
      <input
        checked={checked}
        className="s-choice__input"
        name={name}
        onChange={onSelect}
        type="radio"
        value={value}
      />
      <span className="s-choice__mark" />
      <span className="s-choice__text">
        <span className="s-subheading">{label}</span>
        {description === undefined ? null : (
          <span className="s-caption s-quiet">{description}</span>
        )}
      </span>
    </label>
  );
}

/* ============================== Surfaces ============================= */

export function Card({
  children,
  flush = false,
  testId,
  tone,
}: {
  readonly children: ReactNode;
  /** No padding, for a card whose whole body is a list. */
  readonly flush?: boolean;
  readonly testId?: string;
  readonly tone?: 'accent';
}) {
  const className = [
    's-card',
    flush ? 's-card--flush' : undefined,
    tone === undefined ? undefined : `s-card--${tone}`,
  ]
    .filter((value) => value !== undefined)
    .join(' ');
  return (
    <section className={className} data-testid={testId}>
      {children}
    </section>
  );
}

export function CardHead({
  actions,
  lede,
  title,
}: {
  readonly actions?: ReactNode;
  readonly lede?: ReactNode;
  readonly title: ReactNode;
}) {
  return (
    <header className="s-card__head">
      <div className="s-card__head-row">
        <h2 className="s-heading">{title}</h2>
        {actions === undefined ? null : (
          <div className="s-inline s-inline--tight">{actions}</div>
        )}
      </div>
      {lede === undefined ? null : (
        <p className="s-small s-muted s-measure">{lede}</p>
      )}
    </header>
  );
}

export function SectionHead({
  actions,
  title,
}: {
  readonly actions?: ReactNode;
  readonly title: ReactNode;
}) {
  return (
    <div className="s-section-head">
      <h3 className="s-label s-quiet">{title}</h3>
      {actions === undefined ? null : (
        <div className="s-inline s-inline--tight">{actions}</div>
      )}
    </div>
  );
}

export function PageHeader({
  actions,
  eyebrow,
  lede,
  title,
}: {
  readonly actions?: ReactNode;
  readonly eyebrow?: ReactNode;
  readonly lede?: ReactNode;
  readonly title: string;
}) {
  return (
    <header className="s-page-header">
      {eyebrow === undefined ? null : (
        <p className="s-label s-quiet">{eyebrow}</p>
      )}
      <div className="s-page-header__row">
        <h1 className="s-title">{title}</h1>
        {actions === undefined ? null : (
          <div className="s-inline s-inline--tight">{actions}</div>
        )}
      </div>
      {lede === undefined ? null : (
        <p className="s-page-header__lede s-measure">{lede}</p>
      )}
    </header>
  );
}

/**
 * A row of controls that belong to the thing above them.
 *
 * Wraps rather than scrolls, so a narrow screen gets two rows of reachable
 * controls instead of one row with half of it off the edge.
 */
export function Toolbar({
  children,
  testId,
}: {
  readonly children: ReactNode;
  readonly testId?: string;
}) {
  return (
    <div className="s-toolbar" data-testid={testId}>
      {children}
    </div>
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

/** A stable tone per creator, so the same creator is the same colour everywhere. */
export function toneOf(seed: string): number {
  let total = 0;
  for (const glyph of seed) {
    total = (total + (glyph.codePointAt(0) ?? 0)) % 9973;
  }
  return (total % avatarTones) + 1;
}

/**
 * A creator's identity mark.
 *
 * Deliberately not a photograph and never described as one. There is no creator
 * media capability on this platform: the contract publishes no route by which a
 * creator could add, replace, or deliver an image, so there is nothing for any
 * surface to render. A monogram on a stable tone is what a creator actually
 * gets, and an empty image frame that never fills would be worse.
 */
export function CreatorAvatar({
  displayName,
  seed,
  size = 'sm',
  src,
}: {
  readonly displayName: string;
  /** Usually the handle, so the tone survives a display-name change. */
  readonly seed?: string;
  readonly size?: 'xs' | 'sm' | 'md' | 'lg';
  /** A short-lived address. Absent whenever there is nothing to show. */
  readonly src?: string | undefined;
}) {
  const className = `s-avatar s-avatar--${size} s-avatar--tone-${String(
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
    <span aria-hidden="true" className={`${className} s-avatar--image`}>
      {/* A plain element rather than the framework's optimised one: the address
          is issued per request and viewer-scoped, so nothing upstream can fetch
          or cache it. */}
      <img alt="" className="s-avatar__image" src={src} />
    </span>
  );
}

/* =============================== Status ============================== */

export type Tone =
  'neutral' | 'accent' | 'positive' | 'caution' | 'critical' | 'info';

/**
 * A small piece of state, in a colour and in words and with a mark.
 *
 * All three, always. `docs/design/05-accessibility-motion.md` forbids colour as
 * the only carrier of status, and a badge is exactly where that goes wrong.
 */
export function Badge({
  children,
  icon,
  testId,
  tone = 'neutral',
}: {
  readonly children: ReactNode;
  readonly icon?: IconName;
  readonly testId?: string;
  readonly tone?: Tone;
}) {
  return (
    <span className={`s-badge s-badge--${tone}`} data-testid={testId}>
      {icon === undefined ? null : <Icon name={icon} size="sm" />}
      {children}
    </span>
  );
}

export function Chip({
  children,
  icon,
}: {
  readonly children: ReactNode;
  readonly icon?: IconName;
}) {
  return (
    <span className="s-chip">
      {icon === undefined ? null : <Icon name={icon} size="sm" />}
      {children}
    </span>
  );
}

/**
 * A figure the platform actually holds, with the words that say what it counted.
 *
 * `caption` is not optional decoration: every number on this surface is a count
 * of something specific, and a number with no statement of what it counted is
 * the beginning of a fabricated metric.
 */
export function Metric({
  caption,
  testId,
  value,
}: {
  readonly caption: ReactNode;
  readonly testId?: string;
  readonly value: ReactNode;
}) {
  return (
    <div className="s-metric">
      <p className="s-metric__value s-numeric" data-testid={testId}>
        {value}
      </p>
      <p className="s-metric__caption s-caption s-quiet">{caption}</p>
    </div>
  );
}

/** A term and its value, for the small tables of facts a workspace is full of. */
export function InfoRow({
  term,
  testId,
  value,
}: {
  readonly term: ReactNode;
  readonly testId?: string;
  readonly value: ReactNode;
}) {
  return (
    <div className="s-info-row">
      <dt className="s-small s-muted">{term}</dt>
      <dd className="s-small s-info-row__value" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
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
    <div className={`s-notice s-notice--${tone}`} data-testid={testId}>
      <span className="s-notice__icon">
        <Icon name={icon ?? noticeIcons[tone]} size="md" />
      </span>
      <div className="s-notice__body">
        {title === undefined ? null : <p className="s-subheading">{title}</p>}
        {children === undefined ? null : (
          <div className="s-small s-muted">{children}</div>
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
      className="s-inline-status"
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
    <p className="s-inline-error" data-testid={testId} role="alert">
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
    <div className="s-empty" data-testid={testId}>
      <span className="s-empty__mark">
        <Icon name={icon} size="lg" />
      </span>
      <p className="s-subheading">{title}</p>
      {body === undefined ? null : <p className="s-empty__body">{body}</p>}
      {actions === undefined ? null : (
        <div className="s-empty__actions">{actions}</div>
      )}
    </div>
  );
}

/**
 * Something went wrong, with the one thing that might fix it.
 *
 * A retry is offered only when repeating the request could plausibly change the
 * answer. A refusal is a decision, and a button that re-asks a decided question
 * is a button that wastes somebody's afternoon.
 */
export function ErrorState({
  body,
  onRetry,
  testId,
  title = 'That did not load',
}: {
  readonly body: ReactNode;
  readonly onRetry?: (() => void) | undefined;
  readonly testId: string;
  readonly title?: string;
}) {
  return (
    <div className="s-empty s-empty--failed" data-testid={testId} role="alert">
      <span className="s-empty__mark s-empty__mark--failed">
        <Icon name="alert" size="lg" />
      </span>
      <p className="s-subheading">{title}</p>
      <p className="s-empty__body">{body}</p>
      {onRetry === undefined ? null : (
        <div className="s-empty__actions">
          <Button icon="refresh" onClick={onRetry} tone="secondary">
            Try again
          </Button>
        </div>
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
    <div className="s-blocked" data-testid={testId}>
      <p className="s-blocked__head">
        <Icon name="lock" size="sm" />
        <span className="s-label">{label}</span>
      </p>
      <p className="s-subheading">{title}</p>
      <div className="s-small s-muted s-measure s-stack s-stack--2">
        {children}
      </div>
    </div>
  );
}

/* ============================== Skeletons ============================ */

export function Skeleton({
  height,
  width,
}: {
  readonly height: number | string;
  readonly width?: number | string;
}) {
  return (
    <span
      aria-hidden="true"
      className="s-skeleton"
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
 * A placeholder shaped like the rows it stands in for.
 *
 * The shape is what stops the jump: a skeleton the same height as its content
 * means the page does not move when the answer arrives, and a page that moves
 * under a finger is a page that gets the wrong thing tapped.
 */
export function RowSkeleton({ rows = 3 }: { readonly rows?: number }) {
  return (
    <ul aria-hidden="true" className="s-list">
      {Array.from({ length: rows }, (_, index) => (
        <li className="s-row" key={index}>
          <span className="s-row__body">
            <Skeleton height={14} width="38%" />
            <span style={{ display: 'block', height: 'var(--space-3)' }} />
            <Skeleton height={12} width="64%" />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function CardSkeleton({ rows = 3 }: { readonly rows?: number }) {
  return (
    <div aria-hidden="true" className="s-stack s-stack--4">
      <Skeleton height={14} width="30%" />
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton
          height={12}
          key={index}
          width={`${String(85 - index * 12)}%`}
        />
      ))}
    </div>
  );
}

/* ================================ Tabs =============================== */

export interface SegmentedOption<T extends string> {
  readonly count?: number;
  readonly label: string;
  readonly value: T;
}

export function Segmented<T extends string>({
  label,
  onChange,
  options,
  value,
}: {
  readonly label: string;
  readonly onChange: (next: T) => void;
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
}) {
  return (
    <div aria-label={label} className="s-segmented" role="tablist">
      {options.map((option) => (
        <button
          aria-selected={option.value === value}
          className="s-segmented__item"
          data-testid={`segment-${option.value}`}
          key={option.value}
          onClick={() => {
            onChange(option.value);
          }}
          role="tab"
          type="button"
        >
          {option.label}
          {option.count === undefined ? null : (
            <span className="s-segmented__count s-numeric">{option.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ================================ Rows =============================== */

export function ListRow({
  aside,
  children,
  href,
  onClick,
  testId,
}: {
  readonly aside?: ReactNode;
  readonly children: ReactNode;
  readonly href?: string;
  readonly onClick?: () => void;
  readonly testId?: string;
}) {
  const className = [
    's-row',
    href === undefined && onClick === undefined
      ? undefined
      : 's-row--interactive',
  ]
    .filter((value) => value !== undefined)
    .join(' ');
  const content = (
    <>
      <span className="s-row__body">{children}</span>
      {aside === undefined ? null : (
        <span className="s-row__aside">{aside}</span>
      )}
    </>
  );

  if (href !== undefined) {
    return (
      <Link className={className} data-testid={testId} href={href}>
        {content}
      </Link>
    );
  }
  if (onClick !== undefined) {
    return (
      <button
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
