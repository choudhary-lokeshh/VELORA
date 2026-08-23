import { useFonts } from 'expo-font';
import { IBMPlexSans_400Regular } from '@expo-google-fonts/ibm-plex-sans/400Regular';
import { IBMPlexSans_500Medium } from '@expo-google-fonts/ibm-plex-sans/500Medium';
import { IBMPlexSans_600SemiBold } from '@expo-google-fonts/ibm-plex-sans/600SemiBold';
import { IBMPlexSans_700Bold } from '@expo-google-fonts/ibm-plex-sans/700Bold';

/**
 * The approved interface typeface, loaded once for the whole application.
 *
 * IBM Plex Sans is fixed by `docs/design/01-design-principles.md` and is not a
 * face either platform ships, so it travels with the bundle. Four weights, by
 * exact subpath rather than through the package's barrel: the barrel `require`s
 * every weight and every italic, and Metro would put fourteen faces into a
 * bundle that renders four.
 *
 * Noto is the approved global-script fallback on the other surfaces, where a
 * font stack can name it. React Native has no stack — a `fontFamily` is one
 * family — so a script IBM Plex Sans does not cover falls through to the
 * platform's own face, which on both platforms is a full-coverage system font.
 * That is the same intent reached by the only mechanism available, and it is
 * recorded here rather than presented as parity.
 */
export function useInterfaceTypeface(): {
  readonly failed: boolean;
  readonly ready: boolean;
} {
  const [loaded, error] = useFonts({
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
    IBMPlexSans_700Bold,
  });

  /*
   * A face that will not load is a visual problem and never a functional one.
   * The product renders in the platform's face rather than holding a splash
   * screen over somebody who wanted to read a message, so `ready` is true once
   * the question has been answered either way.
   */
  return { failed: error !== null, ready: loaded || error !== null };
}
