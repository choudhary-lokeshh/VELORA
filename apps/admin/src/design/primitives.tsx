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
 * The Platform Admin primitives.
 *
 * Each one exists because the same true thing has to be said the same way on
 * every screen: a control that is working says so, a refused operation says
 * what was refused, a screen with nothing on it says that rather than showing
 * an empty box, and a capability the platform has deliberately not enabled
 * looks deliberate rather than broken.
 *
 * None of them decides anything. `docs/design/02-design-system-contract.md` is
 * explicit that visual state is not business truth, and on this surface that
 * rule carries the most weight in the product: a control styled as available
 * has not been authorized, and a badge reading "Suspended" is repeating what
 * the owning domain said. Nothing here has a variant named after a permission.
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
  readonly size?: 'sm' | 'md';
  readonly tone?: ButtonTone;
}

function buttonClass(input: {
  readonly block?: boolean | undefined;
  readonly size?: 'sm' | 'md' | undefined;
  readonly tone: ButtonTone;
}): string {
  return [
    'a-btn',
    `a-btn--${input.tone}`,
    input.size === 'sm' ? 'a-btn--sm' : undefined,
    input.block === true ? 'a-btn--block' : undefined,
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
      // press would be a second privileged operation.
      aria-busy={busy || undefined}
      className={buttonClass({ block, size, tone })}
      disabled={disabled === true || busy}
      type={type}
    >
      {busy ? (
        <span className="a-btn__spinner" />
      ) : icon === undefined ? null : (
        <Icon name={icon} size="sm" />
      )}
      {children}
    </button>
  );
}

export function ButtonLink({
  children,
  href,
  icon,
  size,
  tone = 'secondary',
  ...rest
}: {
  readonly children: ReactNode;
  readonly 'data-testid'?: string;
  readonly href: string;
  readonly icon?: IconName;
  readonly size?: 'sm' | 'md';
  readonly tone?: ButtonTone;
}) {
  return (
    <Link
      {...rest}
      className={buttonClass({ size, tone })}
      href={href}
      style={{
        color:
          tone === 'primary' || tone === 'danger'
            ? 'var(--text-on-accent)'
            : undefined,
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
      className={`a-icon-btn${size === 'sm' ? ' a-icon-btn--sm' : ''}`}
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
  readonly error?: string | undefined;
  readonly hint?: ReactNode;
  readonly label: ReactNode;
  readonly optional?: boolean;
}

/**
 * A label, its control, its explanation, and its error, wired together.
 *
 * The wiring is the point. A hint that is not referenced by `aria-describedby`
 * is a hint a screen reader never reaches, and an error announced somewhere
 * else on the page is an error nobody associates with the field that caused it.
 */
export function Field({
  children,
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
    <div className="a-field">
      <label className="a-field__label" htmlFor={id}>
        {label}
        {optional ? (
          <span className="a-field__optional"> (optional)</span>
        ) : null}
      </label>
      {children({
        'aria-describedby': describedBy.length > 0 ? describedBy : undefined,
        'aria-invalid': error === undefined ? undefined : true,
        id,
      })}
      {hint === undefined ? null : (
        <p className="a-field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p className="a-field__error" id={errorId}>
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
  return <input {...props} className="a-control" />;
}

export function TextArea(
  props: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>,
) {
  return <textarea {...props} className="a-control a-control--area" />;
}

export function Select(
  props: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'>,
) {
  return (
    <span className="a-select">
      <select {...props} className="a-control" />
      <Icon className="a-select__mark" name="chevronDown" size="sm" />
    </span>
  );
}

/**
 * The acknowledgement in front of a high-impact operation.
 *
 * A real checkbox with a real label, because the label is the sentence the
 * operator is confirming and an audit trail that recorded a click on a styled
 * div would be recording something nobody read.
 */
export function Acknowledgement({
  checked,
  children,
  onChange,
  testId,
}: {
  readonly checked: boolean;
  readonly children: ReactNode;
  readonly onChange: (next: boolean) => void;
  readonly testId?: string;
}) {
  return (
    <label className="a-check">
      <input
        checked={checked}
        data-testid={testId}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
        type="checkbox"
      />
      <span className="a-small">{children}</span>
    </label>
  );
}

/* ============================== Panels =============================== */

export function Panel({
  children,
  testId,
}: {
  readonly children: ReactNode;
  readonly testId?: string;
}) {
  return (
    <section className="a-panel" data-testid={testId}>
      {children}
    </section>
  );
}

export function PanelHead({
  actions,
  lede,
  title,
}: {
  readonly actions?: ReactNode;
  readonly lede?: ReactNode;
  readonly title: ReactNode;
}) {
  return (
    <header className="a-panel__head">
      <div className="a-panel__head-text">
        <h2 className="a-heading">{title}</h2>
        {lede === undefined ? null : (
          <p className="a-caption a-quiet a-measure">{lede}</p>
        )}
      </div>
      {actions === undefined ? null : (
        <div className="a-inline a-inline--tight">{actions}</div>
      )}
    </header>
  );
}

export function PanelBody({
  children,
  flush = false,
}: {
  readonly children: ReactNode;
  /** No padding, for a body whose whole content is a table. */
  readonly flush?: boolean;
}) {
  return (
    <div className={`a-panel__body${flush ? ' a-panel__body--flush' : ''}`}>
      {children}
    </div>
  );
}

export function PanelFoot({ children }: { readonly children: ReactNode }) {
  return <div className="a-panel__foot">{children}</div>;
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
    <header className="a-page-header">
      {eyebrow === undefined ? null : (
        <p className="a-label a-quiet">{eyebrow}</p>
      )}
      <div className="a-page-header__row">
        <h1 className="a-title">{title}</h1>
        {actions === undefined ? null : (
          <div className="a-inline a-inline--tight">{actions}</div>
        )}
      </div>
      {lede === undefined ? null : (
        <p className="a-small a-muted a-measure">{lede}</p>
      )}
    </header>
  );
}

export function Toolbar({
  children,
  testId,
}: {
  readonly children: ReactNode;
  readonly testId?: string;
}) {
  return (
    <div className="a-toolbar" data-testid={testId}>
      {children}
    </div>
  );
}

/* =============================== Tables ============================== */

/**
 * A table that scrolls inside its own bounds rather than taking the page.
 *
 * The one place on this surface where sideways scrolling is a designed answer:
 * a decision row genuinely has more columns than a tablet has width, and
 * dropping one of them would be dropping a fact from an audit trail.
 */
export function Scroller({
  children,
  label,
}: {
  readonly children: ReactNode;
  /** Named, because a scrollable region has to be reachable from a keyboard. */
  readonly label: string;
}) {
  return (
    <div aria-label={label} className="a-scroller" role="region" tabIndex={0}>
      {children}
    </div>
  );
}

export function Table({
  children,
  testId,
}: {
  readonly children: ReactNode;
  readonly testId?: string;
}) {
  return (
    <table className="a-table" data-testid={testId}>
      {children}
    </table>
  );
}

/* =============================== Status ============================== */

export type Tone =
  'neutral' | 'accent' | 'positive' | 'caution' | 'critical' | 'info';

/**
 * A small piece of state, in a colour and in words and with a mark.
 *
 * All three, always. `docs/design/05-accessibility-motion.md` forbids colour as
 * the only carrier of status, and on a console a colour-only badge is the thing
 * an operator scans a hundred rows by.
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
    <span className={`a-badge a-badge--${tone}`} data-testid={testId}>
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
    <span className="a-chip">
      {icon === undefined ? null : <Icon name={icon} size="sm" />}
      {children}
    </span>
  );
}

/**
 * A figure the platform counted, with the words that say what it counted.
 *
 * `caption` is not optional decoration: every number on this surface is a count
 * of something specific that an operator may act on, and a number with no
 * statement of what it counted is the beginning of a wrong decision.
 */
export function Metric({
  caption,
  testId,
  tone,
  value,
}: {
  readonly caption: ReactNode;
  readonly testId?: string;
  readonly tone?: 'critical' | 'caution';
  readonly value: ReactNode;
}) {
  return (
    <div className="a-metric">
      <p
        className="a-metric__value"
        data-testid={testId}
        style={
          tone === undefined ? undefined : { color: `var(--status-${tone})` }
        }
      >
        {value}
      </p>
      <p className="a-metric__caption">{caption}</p>
    </div>
  );
}

export function Facts({ children }: { readonly children: ReactNode }) {
  return <dl className="a-facts">{children}</dl>;
}

export function Fact({
  term,
  testId,
  value,
}: {
  readonly term: ReactNode;
  readonly testId?: string;
  readonly value: ReactNode;
}) {
  return (
    <div className="a-fact">
      <dt className="a-fact__term">{term}</dt>
      <dd className="a-fact__value" data-testid={testId}>
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
    <div className={`a-notice a-notice--${tone}`} data-testid={testId}>
      <span className="a-notice__icon">
        <Icon name={icon ?? noticeIcons[tone]} size="md" />
      </span>
      <div className="a-notice__body">
        {title === undefined ? null : <p className="a-subheading">{title}</p>}
        {children === undefined ? null : (
          <div className="a-small a-muted">{children}</div>
        )}
      </div>
    </div>
  );
}

/**
 * Progress and confirmations, announced without interrupting.
 *
 * `role="status"` rather than `role="alert"`: an operator reading a queue
 * should not be cut across by a screen saying a panel finished loading.
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
      className="a-inline-status"
      data-testid={testId}
      role="status"
    >
      {children}
    </p>
  );
}

/**
 * A refusal or a failure, said once and assertively.
 *
 * `role="alert"` because an operator who pressed a control and heard nothing
 * will press it again, and on this surface the second press is a second
 * privileged operation.
 */
export function ErrorMessage({
  children,
  testId,
}: {
  readonly children: ReactNode;
  readonly testId?: string;
}) {
  return (
    <p className="a-inline-error" data-testid={testId} role="alert">
      <Icon name="alert" size="sm" />
      <span>{children}</span>
    </p>
  );
}

/* =========================== Empty and blocked ======================= */

export function EmptyState({
  actions,
  body,
  icon = 'check',
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
    <div className="a-empty" data-testid={testId}>
      <span className="a-empty__mark">
        <Icon name={icon} size="lg" />
      </span>
      <p className="a-subheading">{title}</p>
      {body === undefined ? null : <p className="a-empty__body">{body}</p>}
      {actions === undefined ? null : (
        <div className="a-empty__actions">{actions}</div>
      )}
    </div>
  );
}

/**
 * Something went wrong, with the one thing that might fix it.
 *
 * A retry is offered only when repeating the request could plausibly change the
 * answer. A refusal is a decision, and a button that re-asks a decided question
 * wastes an operator's shift.
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
    <div className="a-empty" data-testid={testId} role="alert">
      <span className="a-empty__mark a-empty__mark--failed">
        <Icon name="alert" size="lg" />
      </span>
      <p className="a-subheading">{title}</p>
      <p className="a-empty__body">{body}</p>
      {onRetry === undefined ? null : (
        <div className="a-empty__actions">
          <Button icon="refresh" onClick={onRetry}>
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
 * Visually distinct from an error, because nothing failed. On this surface it
 * is the state an operator meets most often, so it had better not look like
 * something broke — the platform has made a decision it can explain.
 */
export function BlockedState({
  children,
  label = 'Not available',
  testId,
  title,
}: {
  readonly children: ReactNode;
  readonly label?: string;
  readonly testId: string;
  readonly title: string;
}) {
  return (
    <div className="a-blocked" data-testid={testId}>
      <p className="a-blocked__head">
        <Icon name="lock" size="sm" />
        <span className="a-label">{label}</span>
      </p>
      <p className="a-subheading">{title}</p>
      <div className="a-small a-muted a-measure a-stack a-stack--2">
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
      className="a-skeleton"
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
 * means the table does not move when the answer arrives, and a table that moves
 * under a cursor is a table where the wrong row gets opened.
 */
export function RowSkeleton({ rows = 4 }: { readonly rows?: number }) {
  return (
    <div aria-hidden="true" className="a-stack">
      {Array.from({ length: rows }, (_, index) => (
        <div className="a-skeleton-row" key={index}>
          <Skeleton
            height={10}
            width={`${String(28 + ((index * 13) % 34))}%`}
          />
        </div>
      ))}
    </div>
  );
}

export function PanelSkeleton({ rows = 3 }: { readonly rows?: number }) {
  return (
    <div aria-hidden="true" className="a-stack a-stack--3">
      <Skeleton height={10} width="24%" />
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton
          height={10}
          key={index}
          width={`${String(80 - index * 14)}%`}
        />
      ))}
    </div>
  );
}

/* ============================== Segments ============================= */

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
    <div aria-label={label} className="a-segmented" role="tablist">
      {options.map((option) => (
        <button
          aria-selected={option.value === value}
          className="a-segmented__item"
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
            <span className="a-segmented__count">{option.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
