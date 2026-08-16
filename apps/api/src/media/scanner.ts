/**
 * The malware scanning seam.
 *
 * A decoder succeeding is never a scan verdict. Those are different claims
 * about the same bytes: one says the file is a well-formed image, the other
 * says it does not carry something hostile, and recording the first as the
 * second is how a platform ends up telling itself it scans.
 *
 * No scanner is approved. `MEDIA_MALWARE_SCANNER` defaults to `unavailable`,
 * which refuses, and inspection treats a refusal as a quarantine rather than as
 * a pass — so an environment with no scanning position accepts no media at all.
 * The scanning decision itself, including whether submitting user content to a
 * third party is a disclosure under the privacy authority, is recorded in
 * `docs/decisions/DECISIONS_REQUIRED.md`.
 */

export type MediaScanVerdict = 'clean' | 'infected';

export interface MediaScannerPort {
  /** Recorded for operations. Never rendered to a client. */
  readonly name: string;
  scan(input: {
    readonly bytes: Uint8Array;
    readonly objectKey: string;
  }): Promise<MediaScanVerdict>;
}

export class MediaScannerUnavailableError extends Error {
  constructor() {
    super('No media malware scanner is approved');
    this.name = 'MediaScannerUnavailableError';
  }
}

/**
 * The default, and the only scanner a deployed environment may have.
 *
 * It refuses rather than passing, so no object reaches a technically ready
 * state without a scanning position having been taken. An unavailable scanner
 * reporting `clean` would be the single most dangerous line in this domain.
 */
export class UnavailableMediaScanner implements MediaScannerPort {
  readonly name = 'unavailable';

  scan(): Promise<MediaScanVerdict> {
    return Promise.reject(new MediaScannerUnavailableError());
  }
}

/**
 * Deterministic development and test scanner.
 *
 * It refuses any object containing {@link localTestInfectedMarker} and passes
 * everything else. That is a string comparison, not detection: it exercises the
 * shape of a refusal so the quarantine path is real in tests, and it is never
 * evidence that any content was scanned.
 *
 * The marker is a Velora string rather than the industry test signature on
 * purpose. Committing that signature would have local anti-virus and CI
 * scanners quarantine the repository's own fixtures, and the point here is a
 * deterministic refusal rather than a real detection.
 */
export const localTestInfectedMarker = 'VELORA-SCANNER-REFUSE';

export class LocalTestMediaScanner implements MediaScannerPort {
  readonly name = 'local-test';

  scan(input: { readonly bytes: Uint8Array }): Promise<MediaScanVerdict> {
    const marker = new TextEncoder().encode(localTestInfectedMarker);
    return Promise.resolve(
      indexOfSequence(input.bytes, marker) === -1 ? 'clean' : 'infected',
    );
  }
}

function indexOfSequence(haystack: Uint8Array, needle: Uint8Array): number {
  if (needle.length === 0 || haystack.length < needle.length) return -1;
  outer: for (
    let start = 0;
    start <= haystack.length - needle.length;
    start += 1
  ) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) continue outer;
    }
    return start;
  }
  return -1;
}
