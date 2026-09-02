import type { ReactNode } from 'react';
import {
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  ScrollView,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useKeyboardOverlap } from '../frame/keyboard';
import { IconButton, Text } from './primitives';
import { color, layout, radius, space } from './tokens';

/**
 * A bottom sheet, which is what a dialog is on a phone.
 *
 * A centred dialog is a desktop shape: it sits where a mouse is and away from
 * where a thumb is. This rises from the edge a hand is already holding, so its
 * controls land under the thumb rather than at the top of the screen.
 *
 * Three behaviours are not decoration. The system back gesture and the Android
 * hardware back button close it, through `onRequestClose`, because a sheet a
 * person cannot dismiss the ordinary way is a trap. The scrim is a control with
 * its own accessible name, so dismissing does not require finding the small
 * mark. And the content scrolls, because a sheet on a small phone with the
 * keyboard up has very little room and the thing that must never be pushed off
 * is the action.
 *
 * `accessibilityViewIsModal` is what tells iOS VoiceOver that everything behind
 * this is unreachable; React Native's `Modal` handles the same on Android.
 */
export function Sheet({
  children,
  onClose,
  testID,
  title,
}: {
  readonly children: ReactNode;
  readonly onClose: () => void;
  readonly testID: string;
  readonly title: string;
}) {
  const insets = useSafeAreaInsets();
  /*
   * The keyboard, measured against the sheet itself.
   *
   * A modal window is pinned to the bottom of a window Android 15 no longer
   * resizes, so a sheet with a text field — the report, the appeal — kept its
   * promise about nothing pushing the action off only until the keys came up:
   * the primary button sat behind them and the internal scroll could not
   * reach it. The measured overlap joins the bottom padding, which stands the
   * whole sheet on top of the keyboard.
   */
  const keyboard = useKeyboardOverlap();
  const close = () => {
    // The keys belong to this sheet's field; the screen underneath should not
    // inherit them for a frame after it goes.
    Keyboard.dismiss();
    onClose();
  };
  return (
    <Modal
      animationType="slide"
      onRequestClose={close}
      statusBarTranslucent
      transparent
      visible
    >
      <View accessibilityViewIsModal style={styles.root} testID={testID}>
        <Pressable
          accessibilityLabel="Close"
          accessibilityRole="button"
          onPress={close}
          style={styles.scrim}
          testID={`${testID}-scrim`}
        />
        <View
          ref={keyboard.target}
          style={[
            styles.sheet,
            {
              paddingBottom:
                Math.max(insets.bottom, space[4]) + keyboard.overlap,
            },
          ]}
        >
          <View style={styles.grip} />
          <View style={styles.head}>
            <Text
              accessibilityRole="header"
              style={styles.headTitle}
              variant="subheading"
              weight="semibold"
            >
              {title}
            </Text>
            <IconButton
              label="Close"
              name="x"
              onPress={close}
              testID={`${testID}-close`}
            />
          </View>
          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  body: { gap: space[4], paddingBottom: space[2] },
  grip: {
    alignSelf: 'center',
    backgroundColor: color.borderStrong,
    borderRadius: radius.pill,
    height: 4,
    marginBottom: space[2],
    width: 36,
  },
  head: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space[2],
    minHeight: layout.minimumTouchTarget,
  },
  headTitle: { flex: 1 },
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { backgroundColor: color.surfaceOverlay, flex: 1 },
  sheet: {
    backgroundColor: color.surface1,
    borderColor: color.borderSoft,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: 1,
    gap: space[3],
    maxHeight: '86%',
    paddingHorizontal: space[4],
    paddingTop: space[3],
  },
});
