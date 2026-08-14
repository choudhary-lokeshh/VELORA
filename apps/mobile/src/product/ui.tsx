import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { Resource } from './resource';

/**
 * The presentational pieces every mobile surface shares.
 *
 * They exist so every screen says the same true things the same way: what it is
 * doing, what went wrong, and whether trying again could help.
 *
 * No visual language is invented. `packages/design-tokens` marks the exact
 * theme values `DESIGN REQUIRED`, so nothing here sets a colour. What it does
 * set is what accessibility requires and design does not decide: a minimum
 * touch target, roles the screen reader can announce, and a live region for
 * status.
 */

/** The smallest comfortable touch target, in density-independent pixels. */
export const minimumTouchTarget = 44;

export function Section({
  children,
  title,
}: {
  readonly children: ReactNode;
  readonly title: string;
}) {
  return (
    <View accessibilityLabel={title} accessible={false}>
      <Text accessibilityRole="header">{title}</Text>
      {children}
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
  readonly children: ReactNode;
  readonly testID?: string;
}) {
  return (
    <Text accessibilityLiveRegion="polite" testID={testID}>
      {children}
    </Text>
  );
}

/** Something went wrong, said once and assertively. */
export function ErrorMessage({
  children,
  testID,
}: {
  readonly children: ReactNode;
  readonly testID?: string;
}) {
  return (
    <Text accessibilityLiveRegion="assertive" testID={testID}>
      {children}
    </Text>
  );
}

/**
 * A control big enough to hit and named well enough to hear.
 *
 * React Native's `Button` cannot carry a hit target size or a disabled
 * announcement, so every action on this surface goes through this instead.
 */
export function Action({
  disabled,
  label,
  onPress,
  testID,
}: {
  readonly disabled?: boolean;
  readonly label: string;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled === true }}
      disabled={disabled === true}
      onPress={onPress}
      style={{ minHeight: minimumTouchTarget, minWidth: minimumTouchTarget }}
      testID={testID}
    >
      <Text>{label}</Text>
    </Pressable>
  );
}

/**
 * A resource's own state, rendered honestly. Every branch terminates.
 */
export function ResourceState<T>({
  resource,
  testID,
}: {
  readonly resource: Resource<T>;
  readonly testID: string;
}) {
  if (resource.error !== undefined) {
    return (
      <View testID={`${testID}-failed`}>
        <ErrorMessage>{resource.error}</ErrorMessage>
        {resource.retryable ? (
          <Action
            label="Try again"
            onPress={resource.reload}
            testID={`${testID}-retry`}
          />
        ) : null}
      </View>
    );
  }
  if (resource.loading && resource.value === undefined) {
    return <StatusMessage testID={`${testID}-loading`}>Loading…</StatusMessage>;
  }
  return null;
}
