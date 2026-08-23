import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ConsumerGate, UnavailableScreen } from '../src/frame/gate';
import { ConsumerProviders } from '../src/frame/providers';
import { Toaster } from '../src/frame/shell';
import { color } from '../src/design/tokens';
import { useInterfaceTypeface } from '../src/design/typeface';
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
 * light because this surface is dark only — the approved Consumer expression is
 * tonal dark and there is no light theme to switch between.
 */
export default function RootLayout() {
  const typeface = useInterfaceTypeface();

  if (!typeface.ready) return <LaunchScreen />;

  return (
    <SafeAreaProvider>
      <View style={{ backgroundColor: color.canvas, flex: 1 }}>
        <StatusBar style="light" />
        <ConsumerProviders unavailable={<UnavailableScreen />}>
          <ConsumerGate>
            <Stack
              screenOptions={{
                animation: 'slide_from_right',
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
