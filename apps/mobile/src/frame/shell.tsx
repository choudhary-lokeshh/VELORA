import type { ReactNode } from 'react';
import {
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../design/icons';
import { IconButton, Text, type TextTone } from '../design/primitives';
import {
  color,
  layout,
  letterSpacing,
  radius,
  space,
  text,
  tracking,
} from '../design/tokens';
import { destinations, signalLabel } from './navigation';
import { useToast, type ToastTone } from './providers';

/**
 * The frame every screen sits in.
 *
 * A phone's chrome is not a browser's. There is no address bar to fall back on,
 * so a screen that is pushed carries its own way back; there is a notch, a home
 * indicator, and a keyboard, so nothing is positioned against the raw window;
 * and there is no hover, so every affordance is visible before it is touched
 * rather than on the way to it.
 */

/* =============================== Screen ============================== */

export function Screen({
  children,
  onBack,
  onRefresh,
  refreshing = false,
  scroll = true,
  subtitle,
  testID,
  title,
  trailing,
}: {
  readonly children: ReactNode;
  /** Present only on a pushed screen, which is the only kind with a "back". */
  readonly onBack?: () => void;
  readonly onRefresh?: (() => void) | undefined;
  readonly refreshing?: boolean;
  /**
   * False when the screen owns a virtualised list. React Native refuses to nest
   * one inside a scroll view of the same orientation, for good reason: the
   * outer view would render every row and undo the virtualisation the inner
   * list exists to provide.
   */
  readonly scroll?: boolean;
  readonly subtitle?: string | undefined;
  readonly testID?: string | undefined;
  readonly title: string;
  readonly trailing?: ReactNode;
}) {
  const insets = useSafeAreaInsets();

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + space[2] }]}>
      <View style={styles.headerRow}>
        {onBack === undefined ? null : (
          <IconButton
            label="Back"
            name="arrowLeft"
            onPress={onBack}
            testID="screen-back"
          />
        )}
        <View style={styles.headerTitles}>
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            variant="title"
            weight="semibold"
          >
            {title}
          </Text>
          {subtitle === undefined ? null : (
            <Text numberOfLines={2} tone="secondary" variant="small">
              {subtitle}
            </Text>
          )}
        </View>
        {trailing}
      </View>
    </View>
  );

  const padding = {
    paddingBottom: space[10],
    paddingHorizontal: space[4],
  };

  return (
    <View style={styles.screen} {...(testID === undefined ? {} : { testID })}>
      {header}
      {scroll ? (
        <ScrollView
          contentContainerStyle={padding}
          keyboardShouldPersistTaps="handled"
          style={styles.body}
          {...(onRefresh === undefined
            ? {}
            : {
                refreshControl: (
                  <RefreshControl
                    onRefresh={onRefresh}
                    refreshing={refreshing}
                    tintColor={color.textTertiary}
                  />
                ),
              })}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.body, padding]}>{children}</View>
      )}
    </View>
  );
}

/**
 * A screen with no chrome at all: the launch state, the door, and the
 * onboarding ladder. They are not places inside the product, so they carry no
 * header and no navigation to somewhere else.
 */
export function PlainScreen({
  children,
  testID,
}: {
  readonly children: ReactNode;
  readonly testID?: string;
}) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      contentContainerStyle={{
        flexGrow: 1,
        paddingBottom: insets.bottom + space[10],
        paddingHorizontal: space[5],
        paddingTop: insets.top + space[8],
      }}
      keyboardShouldPersistTaps="handled"
      style={styles.screen}
      {...(testID === undefined ? {} : { testID })}
    >
      {children}
    </ScrollView>
  );
}

/* =============================== Wordmark ============================ */

const wordmarkTracking = letterSpacing(text.caption.size, tracking.wordmark);

export function Wordmark() {
  return (
    <View style={styles.wordmark}>
      <Icon color={color.ember} name="sparkle" size="md" />
      <Text
        style={{
          letterSpacing: wordmarkTracking,
          /*
           * Android puts the letter-space *after* the last glyph and then
           * measures the view without it, so a centred wordmark loses its
           * final letter: on a device the launch screen read "VELOR". The
           * padding gives that trailing advance somewhere to live. It is not
           * visible spacing — it is exactly the gap the tracking already put
           * there, now inside the box rather than outside it.
           */
          paddingRight: wordmarkTracking,
        }}
        variant="caption"
        weight="semibold"
      >
        VELORA
      </Text>
    </View>
  );
}

/* =============================== Tab bar ============================= */

/** How far a tab label may grow before five of them stop fitting. */
const tabLabelScaleCap = 1.3;

export interface TabSignals {
  readonly conversations?: number;
  readonly notifications?: number;
}

/**
 * The five destinations, within thumb reach.
 *
 * Drawn rather than taken from the navigator's default, because the default
 * carries each platform's own palette and this product's accent is one of the
 * few things that should look the same on both. The label is always present:
 * an icon-only bar is a memory test, and this one is read by people who open
 * the application once a week.
 */
export function TabBar({
  current,
  onSelect,
  signals = {},
}: {
  readonly current: string;
  readonly onSelect: (name: string) => void;
  readonly signals?: TabSignals;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.tabBar,
        { paddingBottom: Math.max(insets.bottom, space[2]) },
      ]}
      testID="tab-bar"
    >
      {destinations.map((destination) => {
        const active = destination.id === current;
        const count =
          destination.signal === undefined
            ? 0
            : (signals[destination.signal] ?? 0);
        return (
          <Pressable
            accessibilityLabel={
              count > 0
                ? `${destination.label}, ${String(count)} waiting`
                : destination.label
            }
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            key={destination.id}
            onPress={() => {
              onSelect(destination.name);
            }}
            style={({ pressed }) => [
              styles.tab,
              pressed ? styles.tabPressed : undefined,
            ]}
            testID={`tab-${destination.id}`}
          >
            <View>
              <Icon
                color={active ? color.ember : color.textTertiary}
                name={destination.icon}
                size="lg"
              />
              {count > 0 ? (
                <View
                  style={styles.tabSignal}
                  testID={`tab-${destination.id}-signal`}
                >
                  <Text
                    style={styles.tabSignalText}
                    tone="onAccent"
                    variant="micro"
                    weight="semibold"
                  >
                    {signalLabel(count)}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text
              numberOfLines={1}
              /*
               * Five labels share one screen width, so this slot cannot grow
               * with the system setting the way body copy does. Uncapped, a
               * device at 200 % rendered the bar as "Discov..Introd..Messa..",
               * which is less use to somebody who needs large text than a
               * slightly smaller word they can actually read. The ceiling is
               * generous enough to help and low enough to keep five whole
               * words; the icon above it does not scale at all and carries the
               * meaning either way.
               */
              scaleCapOverride={tabLabelScaleCap}
              tone={active ? 'accent' : 'tertiary'}
              variant="micro"
              weight={active ? 'semibold' : 'regular'}
            >
              {destination.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ================================ Toaster ============================ */

const toastInk: Readonly<Record<ToastTone, TextTone>> = {
  critical: 'critical',
  neutral: 'primary',
  positive: 'positive',
};

export function Toaster() {
  const { dismiss, toasts } = useToast();
  const insets = useSafeAreaInsets();
  if (toasts.length === 0) return null;
  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.toaster,
        { bottom: insets.bottom + layout.tabBarHeight + space[3] },
      ]}
      testID="toaster"
    >
      {toasts.map((toast) => (
        <Pressable
          accessibilityLabel={`${toast.message}. Dismiss`}
          accessibilityLiveRegion="polite"
          accessibilityRole="button"
          key={toast.id}
          onPress={() => {
            dismiss(toast.id);
          }}
          style={styles.toast}
          testID={`toast-${String(toast.id)}`}
        >
          <Text tone={toastInk[toast.tone]} variant="small" weight="medium">
            {toast.message}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/* ================================ Styles ============================= */

const styles = StyleSheet.create({
  body: { flex: 1 },
  header: {
    backgroundColor: color.canvas,
    paddingBottom: space[3],
    paddingHorizontal: space[4],
  },
  headerRow: {
    /*
       Top-aligned rather than centred. A title that wraps to three lines pulls
       a centred back control down beside the subtitle, where it reads as
       belonging to the sentence rather than to the screen.
    */
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: space[2],
    minHeight: layout.headerHeight,
  },
  headerTitles: { flex: 1, gap: space[1] },
  screen: { backgroundColor: color.canvas, flex: 1 },
  tab: {
    alignItems: 'center',
    flex: 1,
    gap: space[1],
    minHeight: layout.minimumTouchTarget,
    paddingTop: space[2],
  },
  tabBar: {
    backgroundColor: color.canvasDeep,
    borderTopColor: color.borderHairline,
    borderTopWidth: layout.hairline,
    flexDirection: 'row',
    paddingHorizontal: space[1],
  },
  tabPressed: { opacity: 0.6 },
  tabSignal: {
    alignItems: 'center',
    backgroundColor: color.ember,
    borderRadius: radius.pill,
    justifyContent: 'center',
    minWidth: 18,
    paddingHorizontal: 5,
    position: 'absolute',
    right: -10,
    top: -6,
  },
  tabSignalText: { lineHeight: 18 },
  toast: {
    backgroundColor: color.surface3,
    borderColor: color.borderSoft,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    ...Platform.select({
      android: { elevation: 8 },
      default: {
        shadowColor: '#000000',
        shadowOffset: { height: 8, width: 0 },
        shadowOpacity: 0.6,
        shadowRadius: 24,
      },
    }),
  },
  toaster: {
    gap: space[2],
    left: space[4],
    position: 'absolute',
    right: space[4],
  },
  wordmark: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space[2],
  },
});
