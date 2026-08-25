import { AppGate } from '../../../src/app/gate';
import { PersonPage } from '../../../src/product/person';

/**
 * One person, at their own address.
 *
 * An address rather than a panel, so Back leaves the person instead of doing
 * nothing, a link somebody sends works, and a second tab is a second person.
 * Nothing here decides whether they exist: the identifier goes straight to the
 * server, and somebody nobody may see comes back exactly as somebody who does
 * not.
 */
export default async function Person({
  params,
}: {
  readonly params: Promise<{ readonly personId: string }>;
}) {
  const { personId } = await params;
  return (
    <AppGate narrow title="Person">
      <PersonPage personId={personId} />
    </AppGate>
  );
}
