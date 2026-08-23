import { Tabs } from 'expo-router';

import { destinations } from '../../src/frame/navigation';
import { TabBar } from '../../src/frame/shell';
import { useTabSignals } from '../../src/frame/providers';
import { color } from '../../src/design/tokens';

/**
 * The five destinations, as real routes.
 *
 * A tab is an address, so the system back gesture, a deep link, and a
 * notification all land where they should and the platform restores the right
 * one when the application is resumed from a cold start.
 *
 * The bar itself is drawn rather than taken from the navigator's default. The
 * default carries each platform's own palette, and this product's accent is one
 * of the few things that should look the same on an iPhone and on a Pixel.
 */
export default function TabLayout() {
  const signals = useTabSignals();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: color.canvas },
      }}
      tabBar={({ navigation, state }) => (
        <TabBar
          current={state.routes[state.index]?.name ?? 'discover'}
          onSelect={(name) => {
            navigation.navigate(name);
          }}
          signals={signals}
        />
      )}
    >
      {destinations.map((destination) => (
        <Tabs.Screen
          key={destination.id}
          name={destination.name}
          options={{ title: destination.label }}
        />
      ))}
    </Tabs>
  );
}
