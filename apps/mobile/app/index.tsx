import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Text, View } from 'react-native';

import { resolveApiBaseUrl } from '../src/api';
import { createPlatformSecureTokenStore } from '../src/auth/secure-storage';
import {
  createMobileAuthManager,
  initialMobileAuthState,
  type MobileAuthState,
} from '../src/auth/session';

/**
 * Minimum Consumer Mobile authentication surface. Product navigation, onboarding
 * and visual design are `DESIGN REQUIRED` and are not invented here; this screen
 * exists so the session lifecycle is reachable on a device.
 */
export default function ConsumerMobileShell() {
  const [state, setState] = useState<MobileAuthState>(initialMobileAuthState);
  const [endpointError, setEndpointError] = useState(false);

  const auth = useMemo(() => {
    try {
      return createMobileAuthManager({
        apiBaseUrl: resolveApiBaseUrl(),
        store: createPlatformSecureTokenStore(),
      });
    } catch {
      return undefined;
    }
  }, []);

  useEffect(() => {
    if (auth === undefined) {
      setEndpointError(true);
      return;
    }
    void auth.restore().then(setState);
  }, [auth]);

  const run = useCallback(
    (work: () => Promise<MobileAuthState>) => {
      void work().then(setState);
    },
    [setState],
  );

  return (
    <View accessibilityRole="summary">
      <Text>VELORA</Text>
      <Text accessibilityRole="header">Consumer Mobile</Text>
      <Text>Foundation shell. Product UI is not implemented.</Text>
      <Text testID="auth-status">
        {endpointError ? 'unavailable' : state.status}
      </Text>
      {auth === undefined ? null : (
        <>
          <Button
            onPress={() => {
              run(async () =>
                auth.signIn({
                  installationId: 'installation-local-device',
                  subject: 'person@velora.test',
                }),
              );
            }}
            testID="auth-sign-in"
            title="Sign in"
          />
          <Button
            onPress={() => {
              run(async () => auth.signOut());
            }}
            testID="auth-sign-out"
            title="Sign out"
          />
          <Button
            onPress={() => {
              run(async () => auth.signOutEverywhere());
            }}
            testID="auth-sign-out-everywhere"
            title="Sign out everywhere"
          />
        </>
      )}
      <StatusBar style="auto" />
    </View>
  );
}
