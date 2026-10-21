import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ConsumerGate, UnavailableScreen } from '../src/frame/gate';
import { LinkRouter } from '../src/frame/link-router';
import { NotificationRuntime } from '../src/frame/notification-runtime';
import { ConsumerProviders } from '../src/frame/providers';
import { Toaster } from '../src/frame/shell';
import { color, ivoryPreview } from '../src/design/theme';
import { useInterfaceTypeface } from '../src/design/typeface';
import { useReducedMotion } from '../src/design/reduced-motion';
import { LaunchScreen } from '../src/product/welcome';

/**
 * The application, once.
 *
 * Three things are established here and nowhere else: the approved typeface,
 * which has to be loaded before any text is measured; the providers every
 * screen reads from; and the gate, which decides whether the routes below it
 * are worth rendering at all.
 *
 * `SafeAreaProvider` is above everything because a notch and a home indicator
 * are not a screen's problem to solve individually, and `StatusBar` is set
 * light for the deployed dark expression and dark for the explicit local/test
 * Ivory review in ADR-0050.
 */
export default function RootLayout() {
  const typeface = useInterfaceTypeface();
  const reducedMotion = useReducedMotion();

  /*
   * The native root, behind every screen, in the preview's own canvas.
   *
   * The build's native background is NIGHT CURRENT's, because a native build
   * reads a colour before any JavaScript runs and the deployed expression is
   * the only one it may ship. In the light preview that dark root showed
   * through every gap the JavaScript did not paint — a screen transition, the
   * keyboard sliding in — as a flash of near-black over a white product. Set
   * once, at mount, and only where the preview is explicitly selected; a
   * module that cannot answer leaves the native default rather than failing a
   * launch over a background.
   */
  useEffect(() => {
    if (!ivoryPreview) return;
    SystemUI.setBackgroundColorAsync(color.canvas).catch(() => undefined);
  }, []);

  if (!typeface.ready) return <LaunchScreen />;

  return (
    <SafeAreaProvider>
      <View style={{ backgroundColor: color.canvas, flex: 1 }}>
        <StatusBar style={ivoryPreview ? 'dark' : 'light'} />
        <ConsumerProviders unavailable={<UnavailableScreen />}>
          <NotificationRuntime />
          <LinkRouter />
          <ConsumerGate>
            <Stack
              screenOptions={{
                animation: reducedMotion ? 'none' : 'slide_from_right',
                contentStyle: { backgroundColor: color.canvas },
                headerShown: false,
              }}
            />
          </ConsumerGate>
          <Toaster />
        </ConsumerProviders>
      </View>
    </SafeAreaProvider>
  );
}
