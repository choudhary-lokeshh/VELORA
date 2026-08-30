import { Children, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  PixelRatio,
  Pressable,
  StyleSheet,
  Text as RNText,
  TextInput as RNTextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { Icon, type IconName } from './icons';
import { largeTextScale } from './text-scale';
import {
  color,
  fontFamily,
  layout,
  letterSpacing,
  radius,
  shadow,
  space,
  text,
  tracking,
  type FontWeightName,
  type TextStyleName,
} from './tokens';

/**
 * The pieces every screen is built from.
 *
 * They exist so the product says the same true things the same way, and so a
 * screen cannot quietly invent a colour, a spacing value, or a touch target.
 * Everything here reads `./tokens`, which is NIGHT CURRENT, which the gate
 * proves identical to the Consumer Web stylesheet.
 *
 * Three rules run through the whole file:
 *
 * **Nothing is smaller than a thumb.** Every control clears 44 points, and a
 * control whose visible box is deliberately smaller carries a hit slop that
 * brings its target back up rather than shrinking what a person has to hit.
 *
 * **Colour is never the only cue.** Every status carries a mark and words as
 * well, because a palette is invisible to a person who cannot separate two
 * hues and to a screen reader entirely.
 *
 * **There is no hover.** A phone has press and it has nothing else, so feedback
 * is a pressed state on every interactive surface, and a control that only
 * revealed itself on hover would be a control nobody here could find.
 */

/* ================================ Text =============================== */

export type TextTone =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'accent'
  | 'positive'
  | 'caution'
  | 'critical'
  | 'onAccent';

const toneColor: Readonly<Record<TextTone, string>> = {
  accent: color.ember,
  caution: color.statusCaution,
  critical: color.statusCritical,
  onAccent: color.textOnAccent,
  positive: color.statusPositive,
  primary: color.textPrimary,
  secondary: color.textSecondary,
  tertiary: color.textTertiary,
};

/**
 * How far each step may grow when somebody turns their system text size up.
 *
 * Body text is uncapped: a person who needs 200 % is entitled to it, and a
 * paragraph that reflows is not a broken paragraph. Display and title steps are
 * capped, because they are already large and an uncapped heading pushes the
 * thing it heads off the screen entirely. This is the one place a limit is
 * kinder than none.
 */
const scaleCap: Partial<Readonly<Record<TextStyleName, number>>> = {
  display: 1.6,
  heading: 1.8,
  title: 1.7,
};

export function Text({
  accessibilityLiveRegion,
  accessibilityRole,
  align,
  children,
  numberOfLines,
  scaleCapOverride,
  style,
  testID,
  tone = 'primary',
  variant = 'body',
  weight = 'regular',
}: {
  /** Announced the moment it changes, without interrupting. */
  readonly accessibilityLiveRegion?: 'polite' | 'assertive';
  /** `header` is what makes a screen navigable by heading. */
  readonly accessibilityRole?: 'header';
  readonly align?: 'left' | 'center' | 'right';
  readonly children: ReactNode;
  readonly numberOfLines?: number | undefined;
  /**
   * Overrides the variant's own scaling ceiling, for the few places where a
   * slot's width is fixed by something other than the text in it. Growth that
   * a container cannot absorb turns into truncation, which is less readable
   * than the smaller text it replaced.
   */
  readonly scaleCapOverride?: number | undefined;
  readonly style?: StyleProp<TextStyle>;
  readonly testID?: string | undefined;
  readonly tone?: TextTone;
  readonly variant?: TextStyleName;
  readonly weight?: FontWeightName;
}) {
  const step = text[variant];
  const cap = scaleCapOverride ?? scaleCap[variant];
  return (
    <RNText
      style={[
        {
          color: toneColor[tone],
          fontFamily: fontFamily[weight],
          fontSize: step.size,
          lineHeight: step.lineHeight,
        },
        align === undefined ? undefined : { textAlign: align },
        style,
      ]}
      {...(accessibilityLiveRegion === undefined
        ? {}
        : { accessibilityLiveRegion })}
      {...(accessibilityRole === undefined ? {} : { accessibilityRole })}
      {...(cap === undefined ? {} : { maxFontSizeMultiplier: cap })}
      {...(numberOfLines === undefined ? {} : { numberOfLines })}
      {...(testID === undefined ? {} : { testID })}
    >
      {children}
    </RNText>
  );
}

/** A small all-caps label. The tracking is resolved against its own size. */
export function Label({
  children,
  testID,
  tone = 'tertiary',
}: {
  readonly children: ReactNode;
  readonly testID?: string;
  readonly tone?: TextTone;
}) {
  return (
    <Text
      style={{
        letterSpacing: letterSpacing(text.micro.size, tracking.label),
        textTransform: 'uppercase',
      }}
      tone={tone}
      variant="micro"
      weight="semibold"
      {...(testID === undefined ? {} : { testID })}
    >
      {children}
    </Text>
  );
}

/* =============================== Buttons ============================= */

export type ButtonTone = 'primary' | 'secondary' | 'ghost' | 'danger';

const buttonFill: Readonly<Record<ButtonTone, ViewStyle>> = {
  danger: {
    backgroundColor: color.statusCriticalWash,
    borderColor: color.statusCritical,
  },
  ghost: { backgroundColor: 'transparent', borderColor: 'transparent' },
  primary: { backgroundColor: color.ember, borderColor: color.ember },
  secondary: {
    backgroundColor: color.surface2,
    borderColor: color.borderSoft,
  },
};

const buttonInk: Readonly<Record<ButtonTone, TextTone>> = {
  danger: 'critical',
  ghost: 'secondary',
  primary: 'onAccent',
  secondary: 'primary',
};

/**
 * Every action in the product.
 *
 * React Native's own `Button` carries no size, no busy state, and no disabled
 * announcement, so nothing uses it. `busy` and `disabled` are separate on
 * purpose: a control that is working is not a control that is unavailable, and
 * a screen reader should not say the second when the first is true.
 */
export function Button({
  busy = false,
  children,
  disabled = false,
  hint,
  icon,
  onPress,
  size = 'medium',
  testID,
  tone = 'secondary',
  wide = false,
}: {
  readonly busy?: boolean;
  readonly children: string;
  readonly disabled?: boolean;
  readonly hint?: string;
  readonly icon?: IconName;
  readonly onPress: () => void;
  readonly size?: 'small' | 'medium' | 'large';
  readonly testID: string;
  readonly tone?: ButtonTone;
  readonly wide?: boolean;
}) {
  const unavailable = disabled || busy;
  const height =
    size === 'small'
      ? layout.controlHeightSmall
      : size === 'large'
        ? layout.controlHeightLarge
        : layout.controlHeight;
  /*
   * A disabled control looks the same whatever tone it would have had.
   * Dimming a primary fill to 45 % turns the brand red into a muddy brown that
   * reads as a rendering fault rather than as "not available yet"; a flat
   * neutral says the second thing plainly, and the accessible state says it to
   * everybody else.
   */
  const inkTone = disabled ? 'tertiary' : buttonInk[tone];
  const ink = toneColor[inkTone];
  /*
   * The mark goes before the word does.
   *
   * A button's icon is decorative — the label carries the meaning, which is why
   * the icon has no name of its own — and the two share one line. At 200 % text
   * on a device, "Interested" beside a heart in half a card's width came out as
   * "Interes/ted" broken mid-word, so the mark was costing the label exactly
   * where the label mattered most. Above this scale the icon is dropped and the
   * word gets the whole control. The ceiling is the same one the tab bar uses.
   */
  const markFits = PixelRatio.getFontScale() <= largeTextScale;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: unavailable }}
      disabled={unavailable}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        disabled ? styles.buttonDisabled : buttonFill[tone],
        {
          alignSelf: wide ? 'stretch' : 'flex-start',
          minHeight: Math.max(height, layout.minimumTouchTarget),
          paddingHorizontal: size === 'small' ? space[3] : space[5],
        },
        pressed ? styles.buttonPressed : undefined,
      ]}
      testID={testID}
      {...(hint === undefined ? {} : { accessibilityHint: hint })}
    >
      {busy ? (
        <ActivityIndicator color={ink} size="small" testID={`${testID}-busy`} />
      ) : icon === undefined || !markFits ? null : (
        <Icon color={ink} name={icon} size={size === 'small' ? 'sm' : 'md'} />
      )}
      <Text
        /*
         * Two lines, and allowed to shrink. On one line a device at 200 % text
         * rendered the primary action of a decision as "Interest…", which is
         * the one label on that card somebody has to be able to read — and the
         * larger the text setting, the more certain the truncation, so it
         * failed hardest for exactly the people who set it. The control grows
         * instead; `minHeight` was already a floor rather than a height.
         */
        numberOfLines={2}
        style={styles.buttonLabel}
        tone={inkTone}
        variant={size === 'small' ? 'small' : 'body'}
        weight="semibold"
      >
        {children}
      </Text>
    </Pressable>
  );
}

/**
 * A control that is only a mark.
 *
 * It always carries a name, because a mark alone announces as nothing, and it
 * always clears the minimum target even when the mark inside it is 20 points.
 */
export function IconButton({
  disabled = false,
  label,
  name,
  onPress,
  testID,
  tone = 'secondary',
}: {
  readonly disabled?: boolean;
  readonly label: string;
  readonly name: IconName;
  readonly onPress: () => void;
  readonly testID: string;
  readonly tone?: TextTone;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={space[2]}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        pressed ? styles.buttonPressed : undefined,
        disabled ? styles.buttonUnavailable : undefined,
      ]}
      testID={testID}
    >
      <Icon color={toneColor[tone]} name={name} size="md" />
    </Pressable>
  );
}

/* ================================ Fields ============================= */

/**
 * A labelled control, with its hint, its error, and its counter wired to it.
 *
 * The label is a real label rather than a placeholder: a placeholder vanishes
 * the moment somebody types, which is the moment they most need to know what
 * they are filling in.
 */
export function Field({
  children,
  count,
  error,
  hint,
  label,
  testID,
}: {
  readonly children: (control: {
    readonly accessibilityHint?: string;
    readonly accessibilityLabel: string;
    readonly invalid: boolean;
  }) => ReactNode;
  readonly count?: { readonly current: number; readonly maximum: number };
  readonly error?: string | undefined;
  readonly hint?: string | undefined;
  readonly label: string;
  readonly testID?: string | undefined;
}) {
  const described = [hint, error].filter((part) => part !== undefined);
  return (
    <View style={styles.field} {...(testID === undefined ? {} : { testID })}>
      <Text tone="secondary" variant="small" weight="medium">
        {label}
      </Text>
      {children({
        accessibilityLabel: label,
        invalid: error !== undefined,
        ...(described.length === 0
          ? {}
          : { accessibilityHint: described.join('. ') }),
      })}
      <View style={styles.fieldFoot}>
        <View style={styles.fieldFootText}>
          {error === undefined ? (
            hint === undefined ? null : (
              <Text tone="tertiary" variant="caption">
                {hint}
              </Text>
            )
          ) : (
            <View style={styles.inlineTight}>
              <Icon color={color.statusCritical} name="alert" size="sm" />
              <Text
                testID={testID === undefined ? undefined : `${testID}-error`}
                tone="critical"
                variant="caption"
              >
                {error}
              </Text>
            </View>
          )}
        </View>
        {count === undefined ? null : (
          <Text
            tone={count.current > count.maximum ? 'critical' : 'tertiary'}
            variant="caption"
          >
            {`${String(count.current)}/${String(count.maximum)}`}
          </Text>
        )}
      </View>
    </View>
  );
}

export function TextField({
  invalid = false,
  multiline = false,
  style,
  ...rest
}: TextInputProps & { readonly invalid?: boolean }) {
  return (
    <RNTextInput
      multiline={multiline}
      placeholderTextColor={color.textTertiary}
      selectionColor={color.ember}
      style={[
        styles.input,
        multiline ? styles.inputMultiline : undefined,
        invalid ? styles.inputInvalid : undefined,
        style,
      ]}
      {...rest}
    />
  );
}

/**
 * A binary choice.
 *
 * Drawn rather than taken from the platform, because the platform's switch
 * carries its own colour on each platform and the product's own accent is one
 * of the few things that should look the same on both.
 */
export function Switch({
  disabled = false,
  label,
  onChange,
  testID,
  value,
}: {
  readonly disabled?: boolean;
  readonly label: string;
  readonly onChange: (next: boolean) => void;
  readonly testID: string;
  readonly value: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => {
        onChange(!value);
      }}
      style={({ pressed }) => [
        styles.switch,
        pressed ? styles.buttonPressed : undefined,
        disabled ? styles.buttonUnavailable : undefined,
      ]}
      testID={testID}
    >
      {/*
        The track is 28 points tall because that is what a switch should look
        like, and the control around it clears 44 because that is what a thumb
        needs. Making the track itself 44 would be a different control; making
        the target 28 would be one people miss.
      */}
      <View
        style={[
          styles.switchTrack,
          {
            backgroundColor: value ? color.emberWashStrong : color.surface3,
            borderColor: value ? color.emberLine : color.borderSoft,
          },
        ]}
      >
        <View
          style={[
            styles.switchKnob,
            {
              backgroundColor: value ? color.ember : color.textTertiary,
              transform: [{ translateX: value ? 20 : 0 }],
            },
          ]}
        />
      </View>
    </Pressable>
  );
}

/** One option in a set, as a row a thumb can hit anywhere along. */
export function Choice({
  children,
  onPress,
  selected,
  testID,
}: {
  readonly children: ReactNode;
  readonly onPress: () => void;
  readonly selected: boolean;
  readonly testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        {
          backgroundColor: selected ? color.emberWash : color.surface2,
          borderColor: selected ? color.emberLine : color.borderHairline,
        },
        pressed ? styles.buttonPressed : undefined,
      ]}
      testID={testID}
    >
      <View
        style={[
          styles.choiceMark,
          { borderColor: selected ? color.ember : color.borderStrong },
        ]}
      >
        {selected ? <View style={styles.choiceMarkFill} /> : null}
      </View>
      <View style={styles.choiceBody}>{children}</View>
    </Pressable>
  );
}

/* =============================== Surfaces ============================ */

export function Card({
  children,
  onPress,
  padded = true,
  testID,
  tone = 'surface1',
}: {
  readonly children: ReactNode;
  readonly onPress?: () => void;
  readonly padded?: boolean;
  readonly testID?: string | undefined;
  readonly tone?: 'surface1' | 'surface2';
}) {
  const body = (
    <View
      style={[
        styles.card,
        { backgroundColor: color[tone] },
        padded ? styles.cardPadded : undefined,
      ]}
    >
      {children}
    </View>
  );
  if (onPress === undefined) {
    return <View {...(testID === undefined ? {} : { testID })}>{body}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => (pressed ? styles.buttonPressed : undefined)}
      {...(testID === undefined ? {} : { testID })}
    >
      {body}
    </Pressable>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

/* ============================ Identity mark ========================== */

const avatarTones = 6;

/**
 * Two initials, taken from the first and last word so "Imogen
 * Whitfield-Ashworth" reads as IW rather than as the first two letters of one
 * name, and grapheme-aware so a name in a script outside the Latin range is not
 * cut mid-character. The same rule Consumer Web applies, for the same reason.
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

const avatarGradients: readonly (readonly [string, string])[] = [
  ['#4a2f3a', '#2a1c26'],
  ['#2e3a46', '#1a2029'],
  ['#45322a', '#26191a'],
  ['#2f4038', '#1a2420'],
  ['#3d3550', '#221d2e'],
  ['#4a3b2c', '#29201a'],
];

/**
 * A person, at the size of a list row.
 *
 * A photograph when the platform currently serves one to this device, and a
 * monogram on a stable tone when it does not. The two occupy the same box, so a
 * list never moves as short-lived addresses arrive, and which one somebody gets
 * is never explained: an image still processing, one its owner removed, and one
 * this viewer may not be shown all look identical here on purpose.
 *
 * The gradient stays underneath the photograph rather than being replaced by
 * it, so a transparent image, a slow load, and a decode failure each fall back
 * to the monogram's own surface instead of to the screen behind it.
 */
export function Avatar({
  displayName,
  seed,
  size = 'medium',
  source,
  testID,
}: {
  readonly displayName: string;
  /** Usually the person's identifier, so the tone survives a name change. */
  readonly seed?: string;
  readonly size?: 'small' | 'medium' | 'large';
  /** A short-lived address. Absent whenever there is nothing to show. */
  readonly source?: string | undefined;
  /** Names the photograph only. There is nothing to name when there is none. */
  readonly testID?: string;
}) {
  const points =
    size === 'small'
      ? layout.avatarSmall
      : size === 'large'
        ? layout.avatarLarge
        : layout.avatarMedium;
  const tone = toneOf(seed ?? displayName);
  const [from, to] = avatarGradients[tone - 1] ?? ['#2a1c26', '#1a2029'];
  const initials = initialsOf(displayName);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height: points, width: points }}
    >
      <Svg height={points} style={StyleSheet.absoluteFill} width={points}>
        <Defs>
          <LinearGradient
            id={`avatar-${String(tone)}`}
            x1="0"
            x2="1"
            y1="0"
            y2="1"
          >
            <Stop offset="0" stopColor={from} />
            <Stop offset="1" stopColor={to} />
          </LinearGradient>
        </Defs>
        <Rect
          fill={`url(#avatar-${String(tone)})`}
          height={points}
          rx={points / 2}
          width={points}
        />
      </Svg>
      {source === undefined ? (
        <View style={styles.avatarInitials}>
          <Text
            style={{ fontSize: Math.round(points * 0.36) }}
            tone="primary"
            variant="small"
            weight="semibold"
          >
            {initials}
          </Text>
        </View>
      ) : (
        <Image
          accessibilityIgnoresInvertColors
          source={{ uri: source }}
          testID={testID}
          style={[
            StyleSheet.absoluteFill,
            { borderRadius: points / 2, height: points, width: points },
          ]}
        />
      )}
    </View>
  );
}

/* ================================ Status ============================= */

export type Tone = 'neutral' | 'accent' | 'positive' | 'caution' | 'critical';

const badgeLook: Readonly<Record<Tone, { fill: string; ink: string }>> = {
  accent: { fill: color.emberWash, ink: color.ember },
  caution: { fill: color.statusCautionWash, ink: color.statusCaution },
  critical: { fill: color.statusCriticalWash, ink: color.statusCritical },
  neutral: { fill: color.surface3, ink: color.textSecondary },
  positive: { fill: color.statusPositiveWash, ink: color.statusPositive },
};

export function Badge({
  children,
  icon,
  testID,
  tone = 'neutral',
}: {
  readonly children: string;
  readonly icon?: IconName;
  readonly testID?: string | undefined;
  readonly tone?: Tone;
}) {
  const look = badgeLook[tone];
  return (
    <View
      style={[styles.badge, { backgroundColor: look.fill }]}
      {...(testID === undefined ? {} : { testID })}
    >
      {icon === undefined ? null : (
        <Icon color={look.ink} name={icon} size="sm" />
      )}
      <Text style={{ color: look.ink }} variant="caption" weight="medium">
        {children}
      </Text>
    </View>
  );
}

export function Chip({ children }: { readonly children: string }) {
  return (
    <View style={styles.chip}>
      <Text tone="secondary" variant="caption">
        {children}
      </Text>
    </View>
  );
}

export function Notice({
  children,
  testID,
  title,
  tone = 'neutral',
}: {
  readonly children: ReactNode;
  readonly testID?: string | undefined;
  readonly title: string;
  readonly tone?: Tone;
}) {
  const look = badgeLook[tone];
  const mark: IconName =
    tone === 'critical'
      ? 'alert'
      : tone === 'caution'
        ? 'alert'
        : tone === 'positive'
          ? 'check'
          : 'info';
  return (
    <View
      style={[
        styles.notice,
        { backgroundColor: look.fill, borderColor: look.ink },
      ]}
      {...(testID === undefined ? {} : { testID })}
    >
      <Icon color={look.ink} name={mark} size="md" />
      <View style={styles.noticeBody}>
        <Text style={{ color: look.ink }} variant="small" weight="semibold">
          {title}
        </Text>
        {typeof children === 'string' ? (
          <Text tone="secondary" variant="small">
            {children}
          </Text>
        ) : (
          children
        )}
      </View>
    </View>
  );
}

/**
 * A polite announcement. `polite` rather than `assertive`, so progress does not
 * interrupt somebody mid-sentence.
 */
export function StatusMessage({
  children,
  testID,
}: {
  readonly children: string;
  readonly testID?: string;
}) {
  return (
    <RNText
      accessibilityLiveRegion="polite"
      style={styles.statusMessage}
      {...(testID === undefined ? {} : { testID })}
    >
      {children}
    </RNText>
  );
}

/** Something went wrong, said once and assertively. */
export function ErrorMessage({
  children,
  testID,
}: {
  readonly children: string;
  readonly testID?: string;
}) {
  return (
    <View style={styles.inlineTight}>
      <Icon color={color.statusCritical} name="alert" size="sm" />
      <RNText
        accessibilityLiveRegion="assertive"
        style={styles.errorMessage}
        {...(testID === undefined ? {} : { testID })}
      >
        {children}
      </RNText>
    </View>
  );
}

/* ============================ Whole states =========================== */

function StatePanel({
  action,
  body,
  icon,
  ink,
  testID,
  title,
}: {
  readonly action?: ReactNode;
  readonly body: string;
  readonly icon: IconName;
  readonly ink: string;
  readonly testID?: string;
  readonly title: string;
}) {
  return (
    <View style={styles.state} {...(testID === undefined ? {} : { testID })}>
      <View style={[styles.stateMark, { borderColor: ink }]}>
        <Icon color={ink} name={icon} size="lg" />
      </View>
      <Text align="center" variant="subheading" weight="semibold">
        {title}
      </Text>
      <Text align="center" tone="secondary" variant="small">
        {body}
      </Text>
      {action}
    </View>
  );
}

export function EmptyState({
  action,
  body,
  icon = 'sparkle',
  testID,
  title,
}: {
  readonly action?: ReactNode;
  readonly body: string;
  readonly icon?: IconName;
  readonly testID?: string | undefined;
  readonly title: string;
}) {
  return (
    <StatePanel
      body={body}
      icon={icon}
      ink={color.textTertiary}
      title={title}
      {...(action === undefined ? {} : { action })}
      {...(testID === undefined ? {} : { testID })}
    />
  );
}

export function ErrorState({
  body,
  onRetry,
  testID,
  title = 'That did not work',
}: {
  readonly body: string;
  readonly onRetry?: (() => void) | undefined;
  readonly testID?: string | undefined;
  readonly title?: string;
}) {
  return (
    <StatePanel
      body={body}
      icon="alert"
      ink={color.statusCritical}
      title={title}
      {...(onRetry === undefined
        ? {}
        : {
            action: (
              <Button
                icon="refresh"
                onPress={onRetry}
                testID={testID === undefined ? 'retry' : `${testID}-retry`}
                tone="secondary"
              >
                Try again
              </Button>
            ),
          })}
      {...(testID === undefined ? {} : { testID })}
    />
  );
}

/**
 * A capability the platform has decided not to offer here.
 *
 * Visually distinct from an error on purpose. An error invites somebody to try
 * again; this is a decision that has already been made and can be explained, and
 * dressing it as a failure sends a person to support for nothing.
 */
export function BlockedState({
  body,
  testID,
  title,
}: {
  readonly body: string;
  readonly testID?: string | undefined;
  readonly title: string;
}) {
  return (
    <StatePanel
      body={body}
      icon="lock"
      ink={color.textSecondary}
      title={title}
      {...(testID === undefined ? {} : { testID })}
    />
  );
}

/* =============================== Skeleton ============================ */

export function Skeleton({
  height = 14,
  width = '100%',
}: {
  readonly height?: number;
  readonly width?: number | `${number}%`;
}) {
  return <View style={[styles.skeleton, { height, width }]} />;
}

export function RowSkeleton({ rows = 3 }: { readonly rows?: number }) {
  return (
    <View accessibilityLabel="Loading" style={styles.stack3} testID="skeleton">
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} style={styles.skeletonRow}>
          <View style={styles.skeletonAvatar} />
          <View style={styles.skeletonLines}>
            <Skeleton width="62%" />
            <Skeleton height={12} width="86%" />
          </View>
        </View>
      ))}
    </View>
  );
}

/* ============================== Segmented ============================ */

export interface SegmentedOption<T extends string> {
  readonly label: string;
  readonly value: T;
}

export function Segmented<T extends string>({
  onChange,
  options,
  testID,
  value,
}: {
  readonly onChange: (next: T) => void;
  readonly options: readonly SegmentedOption<T>[];
  readonly testID: string;
  readonly value: T;
}) {
  return (
    <View accessibilityRole="tablist" style={styles.segmented} testID={testID}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            key={option.value}
            onPress={() => {
              onChange(option.value);
            }}
            style={({ pressed }) => [
              styles.segment,
              active ? styles.segmentActive : undefined,
              pressed ? styles.buttonPressed : undefined,
            ]}
            testID={`${testID}-${option.value}`}
          >
            <Text
              numberOfLines={1}
              tone={active ? 'primary' : 'secondary'}
              variant="small"
              weight={active ? 'semibold' : 'regular'}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* =============================== List row ============================ */

export function ListRow({
  children,
  leading,
  onPress,
  testID,
  trailing,
}: {
  readonly children: ReactNode;
  readonly leading?: ReactNode;
  readonly onPress?: () => void;
  readonly testID?: string | undefined;
  readonly trailing?: ReactNode;
}) {
  const body = (
    <View style={styles.listRow}>
      {leading}
      <View style={styles.listRowBody}>{children}</View>
      {/*
        A row that leads somewhere keeps its chevron even when it also carries a
        badge. Dropping it made a conversation with something unread the only
        row on the screen with no sign that it opened anything.
      */}
      {trailing}
      {onPress === undefined ? null : (
        <Icon color={color.textTertiary} name="chevronRight" size="md" />
      )}
    </View>
  );
  if (onPress === undefined) {
    return <View {...(testID === undefined ? {} : { testID })}>{body}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => (pressed ? styles.buttonPressed : undefined)}
      {...(testID === undefined ? {} : { testID })}
    >
      {body}
    </Pressable>
  );
}

/* ================================ Layout ============================= */

/**
 * Two or three controls of equal weight, side by side — until they cannot be.
 *
 * Equal width is the point of the row: neither of "Pass" and "Interested" is
 * the smaller decision, and sizing them to their words would say one of them
 * is. What a row cannot do is hold two-word labels at a large system text
 * size. At 200 % on a 1080-wide device "Interested" broke across two lines
 * inside its own control and then broke mid-word, which is the layout telling
 * somebody who needs large text that they may have it as long as they do not
 * mind guessing. So past the same ceiling the tab bar uses, the row becomes a
 * column: every control gets the full width and every label is whole.
 *
 * Order is preserved either way, so the primary action stays where it was
 * relative to the others rather than moving under somebody's thumb.
 */
export function Actions({ children }: { readonly children: ReactNode }) {
  const stacked = PixelRatio.getFontScale() > largeTextScale;
  return (
    <View style={stacked ? styles.actionsStacked : styles.actionsRow}>
      {Children.map(children, (child) =>
        child === null || child === undefined || child === false ? null : (
          <View style={stacked ? undefined : styles.actionsShare}>{child}</View>
        ),
      )}
    </View>
  );
}

export function Stack({
  children,
  gap = 4,
  style,
}: {
  readonly children: ReactNode;
  readonly gap?: keyof typeof space;
  readonly style?: StyleProp<ViewStyle>;
}) {
  return <View style={[{ gap: space[gap] }, style]}>{children}</View>;
}

export function Inline({
  children,
  gap = 2,
  wrap = false,
}: {
  readonly children: ReactNode;
  readonly gap?: keyof typeof space;
  readonly wrap?: boolean;
}) {
  return (
    <View
      style={[
        styles.inline,
        { gap: space[gap] },
        wrap ? { flexWrap: 'wrap' } : undefined,
      ]}
    >
      {children}
    </View>
  );
}

/* ================================ Styles ============================= */

const styles = StyleSheet.create({
  avatarInitials: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: space[1],
    paddingHorizontal: space[2],
    paddingVertical: space[1],
  },
  button: {
    alignItems: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: space[2],
    justifyContent: 'center',
    paddingVertical: space[2],
  },
  buttonDisabled: {
    backgroundColor: color.surface2,
    borderColor: color.borderHairline,
  },
  // Shrinkable and centred: without the shrink the label keeps its full
  // intrinsic width and pushes itself out of a button that is sharing a row.
  buttonLabel: { flexShrink: 1, textAlign: 'center' },
  actionsRow: { alignItems: 'center', flexDirection: 'row', gap: space[2] },
  actionsShare: { flex: 1 },
  actionsStacked: { gap: space[2] },
  buttonPressed: { opacity: 0.72 },
  buttonUnavailable: { opacity: 0.45 },
  card: {
    borderColor: color.borderHairline,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
    ...shadow[1],
  },
  cardPadded: { padding: space[4] },
  choice: {
    alignItems: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: space[3],
    minHeight: layout.minimumTouchTarget,
    padding: space[3],
  },
  choiceBody: { flex: 1, gap: space[1] },
  choiceMark: {
    alignItems: 'center',
    borderRadius: radius.pill,
    borderWidth: 2,
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
  choiceMarkFill: {
    backgroundColor: color.ember,
    borderRadius: radius.pill,
    height: 10,
    width: 10,
  },
  chip: {
    backgroundColor: color.surface3,
    borderRadius: radius.pill,
    paddingHorizontal: space[2],
    paddingVertical: space[1],
  },
  divider: {
    backgroundColor: color.borderHairline,
    height: layout.hairline,
  },
  errorMessage: {
    color: color.statusCritical,
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: text.small.size,
    lineHeight: text.small.lineHeight,
  },
  field: { gap: space[2] },
  fieldFoot: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: space[3],
    justifyContent: 'space-between',
  },
  fieldFootText: { flex: 1 },
  iconButton: {
    alignItems: 'center',
    borderRadius: radius.sm,
    height: layout.minimumTouchTarget,
    justifyContent: 'center',
    width: layout.minimumTouchTarget,
  },
  inline: { alignItems: 'center', flexDirection: 'row' },
  inlineTight: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: space[2],
  },
  input: {
    backgroundColor: color.surfaceInset,
    borderColor: color.borderSoft,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: color.textPrimary,
    fontFamily: fontFamily.regular,
    fontSize: text.body.size,
    minHeight: layout.controlHeight,
    paddingHorizontal: space[3],
    paddingVertical: space[3],
  },
  inputInvalid: { borderColor: color.statusCritical },
  inputMultiline: { minHeight: 96, textAlignVertical: 'top' },
  listRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space[3],
    minHeight: layout.minimumTouchTarget,
    paddingVertical: space[3],
  },
  listRowBody: { flex: 1, gap: space[1] },
  notice: {
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: space[3],
    padding: space[3],
  },
  noticeBody: { flex: 1, gap: space[1] },
  segment: {
    alignItems: 'center',
    borderRadius: radius.xs,
    flex: 1,
    justifyContent: 'center',
    minHeight: layout.controlHeightSmall,
    paddingHorizontal: space[2],
  },
  segmentActive: { backgroundColor: color.surface3 },
  segmented: {
    backgroundColor: color.surfaceInset,
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: space[1],
    padding: space[1],
  },
  skeleton: {
    backgroundColor: color.surface3,
    borderRadius: radius.xs,
  },
  skeletonAvatar: {
    backgroundColor: color.surface3,
    borderRadius: radius.pill,
    height: layout.avatarMedium,
    width: layout.avatarMedium,
  },
  skeletonLines: { flex: 1, gap: space[2] },
  skeletonRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space[3],
  },
  stack3: { gap: space[3] },
  state: {
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[5],
    paddingVertical: space[8],
  },
  stateMark: {
    alignItems: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  statusMessage: {
    color: color.textSecondary,
    fontFamily: fontFamily.regular,
    fontSize: text.small.size,
    lineHeight: text.small.lineHeight,
  },
  switch: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: layout.minimumTouchTarget,
    width: 52,
  },
  switchKnob: {
    borderRadius: radius.pill,
    height: 22,
    width: 22,
  },
  switchTrack: {
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 28,
    justifyContent: 'center',
    padding: 2,
    width: 52,
  },
});
