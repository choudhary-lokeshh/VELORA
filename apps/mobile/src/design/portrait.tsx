import { useState } from 'react';
import { Image, StyleSheet, View, useWindowDimensions } from 'react-native';

import { initialsOf, Text } from './primitives';
import { color, mediaInk, radius, space } from './theme';

/** Authorized photograph or a quiet monogram; never a substitute person. */
export function Portrait({
  displayName,
  source,
  testID,
}: {
  readonly displayName: string;
  readonly source: string | undefined;
  readonly testID?: string;
}) {
  const [failedSource, setFailedSource] = useState<string | undefined>();
  const { height, width, fontScale } = useWindowDimensions();
  // Reserve room for identity and decisions on short phones and at large text.
  const portraitWidth = Math.max(1, Math.min(width, 640) - space[4] * 4);
  const portraitHeight = Math.min(
    portraitWidth * 1.25,
    height * (fontScale > 1.3 ? 0.22 : 0.3),
  );
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.frame,
        { aspectRatio: portraitWidth / Math.max(1, portraitHeight) },
      ]}
    >
      {source === undefined || source === failedSource ? (
        <Text style={styles.initials} variant="display">
          {initialsOf(displayName)}
        </Text>
      ) : (
        <Image
          accessibilityIgnoresInvertColors
          onError={() => {
            setFailedSource(source);
          }}
          source={{ uri: source }}
          style={StyleSheet.absoluteFill}
          testID={testID}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    aspectRatio: 4 / 5,
    backgroundColor: color.emberDeep,
    borderRadius: radius.xl,
    justifyContent: 'center',
    marginBottom: space[2],
    overflow: 'hidden',
    width: '100%',
  },
  initials: { color: mediaInk, fontSize: 64, lineHeight: 80 },
});
