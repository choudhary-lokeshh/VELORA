import { useEffect, useRef, useState } from 'react';

import type { MediaVariant } from '@velora/consumer-client';

import { useMediaAddressBook } from '../frame/providers';

/**
 * Turning the image references a projection carries into something a device can
 * load.
 *
 * The same rule as Consumer Web, because it is the same platform answer: every
 * projection publishes references rather than addresses, the exchange
 * re-decides visibility each time, and **a person may legitimately have no
 * photograph to show right now** with the reason never disclosed. Somebody who
 * blocked you, somebody whose image is still processing, and somebody who
 * removed it all look the same here.
 *
 * Addresses arrive after the first paint rather than blocking it. A row that
 * waited for a photograph would show nothing at all for the length of a
 * request; a row that draws its identity mark and then replaces it shows
 * something immediately and is never wrong in the meantime — which matters more
 * on a phone, where the request may be crossing a mobile network.
 */
export function useMediaAddresses(
  references: readonly string[],
  variant: MediaVariant,
): ReadonlyMap<string, string> {
  const book = useMediaAddressBook();
  const [addresses, setAddresses] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  // Joined rather than compared by identity: a projection rebuilds its arrays
  // on every render, so an effect keyed on the array itself would run forever.
  const key = references.join(',');
  const latest = useRef(0);

  useEffect(() => {
    const wanted = key.length === 0 ? [] : key.split(',');
    if (wanted.length === 0) {
      setAddresses(new Map());
      return;
    }
    latest.current += 1;
    const generation = latest.current;
    void book
      .resolve(wanted, variant)
      .then((resolved) => {
        // A slower earlier request must not overwrite a newer answer. The list
        // changes as somebody pages, and the two responses can arrive in either
        // order.
        if (generation === latest.current) setAddresses(resolved);
      })
      .catch(() => {
        // An address that cannot be obtained is not an error a person can act
        // on. The identity mark is already on screen and stays there.
      });
  }, [book, key, variant]);

  return addresses;
}

/**
 * The one image that stands for each person in a list.
 *
 * The first, which is the slot its owner put first. A card, a row, and a thread
 * header each show one photograph, so asking for the rest would mint
 * credentials for images nothing is going to render.
 */
export function portraitReferences(
  people: readonly {
    readonly media: readonly { readonly id: string }[];
  }[],
): readonly string[] {
  return people.flatMap((person) => {
    const first = person.media[0]?.id;
    return first === undefined ? [] : [first];
  });
}
