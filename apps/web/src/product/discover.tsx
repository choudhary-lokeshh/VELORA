'use client';

import type { LiveWindow } from '@velora/consumer-client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { PageHeader, Segmented } from '../design/primitives';
import { CreatorDirectory } from './creators';
import { Discovery } from './discovery';
import { LiveWindows } from './live-windows';

/**
 * The Discover destination, and the two things somebody can browse from it.
 *
 * **People** is Social Discovery: a fixed eligibility conjunction about who may
 * be introduced to whom, ranked by a deterministic rule the server owns.
 * **Creators** is a listing of pages their authors decided to publish, ordered
 * by when they published them.
 *
 * They are sections rather than one blended feed because they are two different
 * questions. One ranking rule cannot honestly mean both "these two people could
 * meet" and "this page exists", and putting creator business inside the
 * candidate feed is what `AGENTS.md` forbids. Neither section can see the
 * other's rules: the people feed has no creator in it and this file adds no
 * ranking of its own.
 *
 * Clubs are deliberately absent from both, and that is a rule rather than a
 * gap. Creator Private Clubs stay separate from Social Discovery, so a club is
 * reached from the page of the creator who runs it and from nowhere else.
 *
 * The section is an address. `ADR-0027` makes each destination one so Back, a
 * bookmark, a second tab, and a deep link behave the way they behave
 * everywhere else, and a section nobody could link to would be the one part of
 * this surface that did not.
 */

type Section = 'people' | 'creators';

const sections: readonly { readonly label: string; readonly value: Section }[] =
  [
    { label: 'People', value: 'people' },
    { label: 'Creators', value: 'creators' },
  ];

const ledeFor: Readonly<Record<Section, string>> = {
  creators:
    'Creators who have published a page, most recently published first. Opening one is public and tells them nothing.',
  people:
    'People who are available right now, who can see you, and who you have not already decided about.',
};

export function Discover({
  apiBaseUrl,
  fetchImplementation,
  liveWindows = [],
}: {
  readonly apiBaseUrl: string;
  /** Injected by tests so the creator section renders without a network. */
  readonly fetchImplementation?: typeof globalThis.fetch;
  /**
   * The times VELORA is asking people to be looking at once.
   *
   * Here rather than on Live, and the placement is the whole argument. Live is
   * a camera and a person's face; a band of announcements over it would be a
   * notice board in front of the thing somebody opened the product for. This is
   * the screen one press away, it is where somebody goes when a search found
   * nobody, and it is a page of things to read — which is what a scheduled time
   * is. Ordinary Live is unaffected either way.
   */
  readonly liveWindows?: readonly LiveWindow[];
}) {
  const parameters = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const requested = parameters.get('show');
  const section: Section = requested === 'creators' ? 'creators' : 'people';

  return (
    <>
      <PageHeader lede={ledeFor[section]} title="Discover" />

      {liveWindows.length === 0 ? null : (
        <div className="v-lede-gap">
          <LiveWindows className="v-stack v-stack--3" windows={liveWindows} />
        </div>
      )}

      <div className="v-lede-gap">
        <Segmented
          label="What to browse"
          onChange={(next) => {
            // `replace` rather than `push`: switching a section changes what
            // this page shows rather than going somewhere new, and a Back that
            // walked through every section somebody tried would be a trap.
            router.replace(
              next === 'people' ? pathname : `${pathname}?show=${next}`,
            );
          }}
          options={[...sections]}
          value={section}
        />
      </div>

      {section === 'creators' ? (
        <CreatorDirectory
          apiBaseUrl={apiBaseUrl}
          {...(fetchImplementation === undefined
            ? {}
            : { fetchImplementation })}
        />
      ) : (
        <Discovery />
      )}
    </>
  );
}
