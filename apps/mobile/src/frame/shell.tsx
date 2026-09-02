import { usePathname } from 'expo-router';
import { createContext, useContext, type ReactNode } from 'react';
import {
  Keyboard,
  PixelRatio,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { Icon } from '../design/icons';
import { largeTextScale } from '../design/text-scale';
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
import { useKeyboardOverlap } from './keyboard';
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

/**
 * Whether a tab bar is drawn under this screen.
 *
 * A phone reserves the bottom of its window for the system's own gesture
 * handle, and something has to keep the product's last line out of it. On the
 * five destinations the tab bar does, because it pads itself by the inset. A
 * pushed screen has no tab bar, and nothing was doing it: the conversation's
 * "Not end-to-end encrypted" ran into the gesture band, and at 200 % text three
 * lines of it did.
 *
 * A context rather than a prop, because the answer belongs to the layout and
 * not to the screen — every pushed screen would otherwise have to remember to
 * say so, and the one that forgot would be the one nobody looked at. It is
 * false by default, which is the safe direction: a screen that wrongly thinks
 * it has no bar below leaves a little extra room, and one that wrongly thinks
 * it has leaves none.
 */
const TabBarBelow = createContext(false);

export function WithTabBarBelow({
  children,
}: {
  readonly children: ReactNode;
}) {
  return <TabBarBelow.Provider value>{children}</TabBarBelow.Provider>;
}

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
  const tabBarBelow = useContext(TabBarBelow);
  /*
   * The keyboard, dealt with here so no screen deals with it alone.
   *
   * Android 15 stopped resizing an edge-to-edge window for the keyboard, so a
   * form near the bottom of any screen under You was simply covered: the
   * window kept its size, the scroll range kept its length, and the bio field
   * with its Save button sat behind the keys. The measured overlap joins the
   * bottom padding, which restores exactly the scrollable room the keyboard
   * took — and is zero anywhere the window still resizes.
   */
  const keyboard = useKeyboardOverlap();
  /*
   * A header that clips is a header that lies.
   *
   * One line for the title and two for the subtitle is right at the ordinary
   * text size and wrong above it: at 200 % a device rendered "Gifts you have
   * sent to creators, and what happ.." and stopped, and a person's name in a
   * pushed screen's title has the same problem the longer the name. Past the
   * ceiling the tab bar uses, both are allowed to run on and the header grows
   * — it has a `minHeight` rather than a height, and the body scrolls beneath
   * it. A tall header costs somebody a little room; a truncated one costs them
   * the sentence.
   */
  const large = PixelRatio.getFontScale() > largeTextScale;

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + space[2] }]}>
      <View style={styles.headerRow}>
        {onBack === undefined ? null : (
          <IconButton
            label="Back"
            name="arrowLeft"
            onPress={() => {
              // Leaving with the keyboard up would pop the screen and leave
              // the keys standing over the one underneath.
              Keyboard.dismiss();
              onBack();
            }}
            testID="screen-back"
          />
        )}
        <View style={styles.headerTitles}>
          <Text
            accessibilityRole="header"
            numberOfLines={large ? 2 : 1}
            variant="title"
            weight="semibold"
          >
            {title}
          </Text>
          {subtitle === undefined ? null : (
            <Text
              tone="secondary"
              variant="small"
              {...(large ? {} : { numberOfLines: 2 })}
            >
              {subtitle}
            </Text>
          )}
        </View>
        {trailing}
      </View>
    </View>
  );

  const padding = {
    // The tab bar already holds the gesture band open where there is one, and
    // the keyboard's measured overlap keeps the bottom of the content
    // reachable while it is up.
    paddingBottom:
      space[10] + (tabBarBelow ? 0 : insets.bottom) + keyboard.overlap,
    paddingHorizontal: space[4],
  };

  return (
    <View
      ref={keyboard.target}
      style={styles.screen}
      {...(testID === undefined ? {} : { testID })}
    >
      <Atmosphere />
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
  // The same measured keyboard room the framed screen gets. The onboarding
  // ladder and the sign-in field live here, near the bottom of the screen,
  // which is exactly where an unresized window puts the keys.
  const keyboard = useKeyboardOverlap();
  return (
    <View ref={keyboard.target} style={styles.screen}>
      <Atmosphere />
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingBottom: insets.bottom + space[10] + keyboard.overlap,
          paddingHorizontal: space[5],
          paddingTop: insets.top + space[8],
        }}
        keyboardShouldPersistTaps="handled"
        style={styles.body}
        {...(testID === undefined ? {} : { testID })}
      >
        {children}
      </ScrollView>
    </View>
  );
}

/**
 * The alpha a wash token carries, which `stopColor` on its own throws away.
 *
 * `react-native-svg` hands `stopColor` to the platform's colour parser, which
 * keeps the three channels and discards the fourth. A stop given
 * `rgba(225, 122, 102, 0.22)` therefore paints at full strength, and on a
 * device that is not a subtle difference: the ember wash rendered at about
 * four and a half times its approved value and the neutral at seven, so a
 * sparse screen was two saturated fields rather than a dark one and tertiary
 * text sat on top of them. Nothing in a browser-rendered walk could show it,
 * because Web draws the same washes through CSS, which honours the alpha.
 *
 * Read back out of the token rather than written down again, so the value the
 * design-parity gate holds the two surfaces to stays the only place it lives.
 */
function washOpacity(token: string): string {
  return /,\s*([\d.]+)\s*\)$/u.exec(token)?.[1] ?? '1';
}

/**
 * Native NIGHT CURRENT atmosphere, drawn from the same existing semantic
 * washes as Web. The SVG dependency already draws every product icon; using it
 * here adds no native module. The light stays behind every control, so it adds
 * depth without affecting input or accessibility.
 */
function Atmosphere() {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={styles.atmosphere}
    >
      <Svg height="100%" width="100%">
        <Defs>
          <RadialGradient cx="88%" cy="0%" id="shell-ember" r="64%">
            <Stop
              offset="0"
              stopColor={color.emberWashStrong}
              stopOpacity={washOpacity(color.emberWashStrong)}
            />
            <Stop
              offset="1"
              stopColor={color.emberWashStrong}
              stopOpacity="0"
            />
          </RadialGradient>
          <RadialGradient cx="12%" cy="100%" id="shell-neutral" r="58%">
            <Stop
              offset="0"
              stopColor={color.statusNeutralWash}
              stopOpacity={washOpacity(color.statusNeutralWash)}
            />
            <Stop
              offset="1"
              stopColor={color.statusNeutralWash}
              stopOpacity="0"
            />
          </RadialGradient>
        </Defs>
        <Rect fill="url(#shell-ember)" height="100%" width="100%" />
        <Rect fill="url(#shell-neutral)" height="100%" width="100%" />
      </Svg>
    </View>
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
            <View
              style={[
                styles.tabIcon,
                active ? styles.tabIconActive : undefined,
              ]}
            >
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
              scaleCapOverride={largeTextScale}
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
  /*
   * Above the tab bar only where there is one. The toaster mounts at the root,
   * outside any screen, so it asks the address instead of a context: the six
   * destination roots draw the bar, and a pushed screen does not — a toast
   * floating a bar's height above nothing reads as detached from the screen it
   * is about.
   */
  const pathname = usePathname();
  const overTabBar = destinations.some(
    (destination) => pathname === `/${destination.name}` || pathname === '/',
  );
  if (toasts.length === 0) return null;
  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.toaster,
        {
          bottom:
            insets.bottom + (overTabBar ? layout.tabBarHeight : 0) + space[3],
        },
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
  atmosphere: {
    bottom: 0,
    left: 0,
    overflow: 'hidden',
    position: 'absolute',
    right: 0,
    top: 0,
  },
  body: { flex: 1 },
  header: {
    backgroundColor: color.surfaceOverlay,
    borderBottomColor: color.borderHairline,
    borderBottomWidth: StyleSheet.hairlineWidth,
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
  tabIcon: {
    alignItems: 'center',
    borderRadius: radius.pill,
    justifyContent: 'center',
    minHeight: space[8],
    minWidth: space[12],
  },
  tabIconActive: { backgroundColor: color.emberWash },
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
