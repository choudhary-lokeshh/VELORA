import * as ImagePicker from 'expo-image-picker';
import {
  acceptedProfileMediaTypes,
  maximumProfileMediaBytes,
} from '@velora/validation/profile-bounds';

import {
  readPermissionState,
  type PermissionState,
} from '../device/permissions';

/**
 * Getting one photograph off the device, and every way that does not happen.
 *
 * There are two sources and they have completely different permission stories
 * on a modern Android, which is why they are not one function:
 *
 * - **The library** goes through the system photo picker. On Android 13 and
 *   later it needs *no permission at all* — the picker runs outside this
 *   application and hands back only what was chosen — which is why this
 *   application asks for none. On Android 12 and earlier there is no photo
 *   picker, so `expo-image-picker` falls back to a gallery intent that needs
 *   `READ_EXTERNAL_STORAGE`, and that permission is declared capped at
 *   `maxSdkVersion="32"` for exactly and only that case.
 * - **The camera** needs `CAMERA` on every version, and a person can refuse it
 *   permanently, in which case Android silently stops showing the dialog. That
 *   is `blocked`, and it is reported as itself so the surface can send
 *   somebody to Settings instead of offering a button that does nothing.
 *
 * Cancelling is not a failure and is reported as its own outcome. On a phone,
 * backing out of a picker is the most common thing that happens to it, and a
 * flow that shows an error for it is a flow that shouts at somebody for
 * changing their mind.
 *
 * Nothing is edited, cropped, or re-encoded here. The platform decides an
 * object's type and acceptability from the bytes it receives, so a client that
 * transformed the image would be uploading something nobody chose, and a
 * client that declared a type would be making a claim the server is required
 * to ignore.
 */

export interface PickedImage {
  /** Bytes, when the platform reported them. Absent is not zero. */
  readonly byteSize: number | undefined;
  readonly fileName: string | undefined;
  readonly mimeType: string | undefined;
  readonly uri: string;
}

export type PickOutcome =
  | { readonly kind: 'picked'; readonly image: PickedImage }
  | { readonly kind: 'cancelled' }
  | {
      readonly kind: 'permission_required';
      readonly permission: PermissionState;
    }
  | { readonly kind: 'too_large'; readonly byteSize: number }
  | { readonly kind: 'unsupported_type'; readonly mimeType: string | undefined }
  | { readonly kind: 'failed'; readonly detail: string };

const acceptedTypes: readonly string[] = acceptedProfileMediaTypes;

/**
 * Checks what the picker was willing to say about the file.
 *
 * Both facts are advisory: Android does not always report a size, and the MIME
 * type comes from the provider rather than from the bytes. They are checked
 * anyway because catching an eight-megabyte photograph before it is uploaded
 * over a mobile connection is worth doing, and because the server rejecting it
 * afterwards is a slower way to say the same thing. Neither check is trusted
 * as authority: the server inspects the object and its answer is the one that
 * counts.
 */
function inspect(image: PickedImage): PickOutcome {
  if (
    image.byteSize !== undefined &&
    image.byteSize > maximumProfileMediaBytes
  ) {
    return { byteSize: image.byteSize, kind: 'too_large' };
  }
  if (image.mimeType !== undefined && !acceptedTypes.includes(image.mimeType)) {
    return { kind: 'unsupported_type', mimeType: image.mimeType };
  }
  return { image, kind: 'picked' };
}

function firstAsset(
  result: ImagePicker.ImagePickerResult,
): PickOutcome | undefined {
  if (result.canceled) return { kind: 'cancelled' };
  const asset = result.assets[0];
  if (asset === undefined) return { kind: 'cancelled' };
  return inspect({
    byteSize: asset.fileSize,
    fileName: asset.fileName ?? undefined,
    mimeType: asset.mimeType ?? undefined,
    uri: asset.uri,
  });
}

export interface ImageSource {
  fromCamera(): Promise<PickOutcome>;
  fromLibrary(): Promise<PickOutcome>;
  /** The camera permission as it currently stands, without asking for it. */
  cameraPermission(): Promise<PermissionState>;
}

export function createPlatformImageSource(): ImageSource {
  const options: ImagePicker.ImagePickerOptions = {
    allowsEditing: false,
    // One photograph. Multiple selection would mean multiple uploads, multiple
    // capabilities, and a partial-failure state nobody has designed.
    allowsMultipleSelection: false,
    exif: false,
    mediaTypes: ['images'],
    // No re-encoding. The bytes the person chose are the bytes the platform
    // inspects.
    quality: 1,
  };

  return {
    async cameraPermission() {
      try {
        return readPermissionState(
          await ImagePicker.getCameraPermissionsAsync(),
        );
      } catch {
        return 'unavailable';
      }
    },

    async fromCamera() {
      let permission: PermissionState;
      try {
        permission = readPermissionState(
          await ImagePicker.getCameraPermissionsAsync(),
        );
        if (permission !== 'granted') {
          permission = readPermissionState(
            await ImagePicker.requestCameraPermissionsAsync(),
          );
        }
      } catch (error) {
        return { detail: describe(error), kind: 'failed' };
      }
      if (permission !== 'granted') {
        return { kind: 'permission_required', permission };
      }
      try {
        return (
          firstAsset(await ImagePicker.launchCameraAsync(options)) ?? {
            kind: 'cancelled',
          }
        );
      } catch (error) {
        return { detail: describe(error), kind: 'failed' };
      }
    },

    async fromLibrary() {
      try {
        return (
          firstAsset(await ImagePicker.launchImageLibraryAsync(options)) ?? {
            kind: 'cancelled',
          }
        );
      } catch (error) {
        return { detail: describe(error), kind: 'failed' };
      }
    },
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown failure';
}

export { inspect as inspectPickedImage };
