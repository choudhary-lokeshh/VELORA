import type { Metadata } from 'next';
import Link from 'next/link';

import { PublicSection, PublicShell } from '../../../src/product/public-shell';
import { pageMetadata } from '../../../src/seo/metadata';
import { aboutCreatorsRoute } from '../../../src/seo/routes';
import { resolvePublicSite } from '../../../src/seo/site';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return pageMetadata({ ...aboutCreatorsRoute, site: resolvePublicSite() });
}

/**
 * The half of the product that is somebody publishing rather than meeting.
 *
 * It is written for two readers at once — somebody deciding whether to follow a
 * creator's link, and a creator deciding whether to publish one — because they
 * are asking the same question from opposite ends: what does a VELORA page
 * actually give you.
 */
export default function AboutCreatorsPage() {
  return (
    <PublicShell
      currentPath={aboutCreatorsRoute.path}
      lede="Some people on VELORA publish a page and run a community. Both are theirs to open or close."
      title="Creators and communities"
    >
      <PublicSection heading="A creator page is a page they published">
        <p>
          A creator page carries a name, a handle, a portrait, a few words, and
          whatever links its owner chose to put on it. It exists because that
          person published it, and it disappears when they withdraw it. Nothing
          on it is ranked, promoted, or ordered by what it earns.{' '}
          <Link href="/creators">The creators who have published a page</Link>{' '}
          is a plain list, newest first.
        </p>
      </PublicSection>

      <PublicSection heading="A community is a room inside that page">
        <p>
          A creator can run one or more communities. Each has a name, a
          description, and a list of what belonging to it gets you, and all of
          that is readable by anybody. What is inside — the posts and the media
          — is readable only by the people who belong, and that is checked on
          every read rather than hidden in the interface.
        </p>
        <p>
          You join by being invited by the creator or by taking up a membership
          they offer. Either way, joining is a thing you do, never a thing that
          happens to you.
        </p>
      </PublicSection>

      <PublicSection heading="What a creator can and cannot do">
        <ul>
          <li>
            They can publish a page, run communities, and offer memberships and
            gifts.
          </li>
          <li>
            They cannot see who looked at their page, and there is no follower
            count anywhere in the product.
          </li>
          <li>
            They cannot reach you because you visited. Nothing about a visit is
            reported to them.
          </li>
          <li>
            They cannot buy their way in front of anybody. There is no promoted
            placement to sell.
          </li>
        </ul>
      </PublicSection>

      <PublicSection heading="Meeting people is separate from all of this">
        <p>
          Creator pages and communities sit beside{' '}
          <Link href="/about/live">live conversations</Link>, not on top of
          them. Somebody you meet live is not a creator selling you something,
          and a creator page is not a person waiting to be matched with you. You
          can use one and never touch the other.
        </p>
      </PublicSection>
    </PublicShell>
  );
}
