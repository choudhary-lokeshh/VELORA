'use client';

import { useEffect, useRef, useState } from 'react';

import type { MediaAddressBook, MediaVariant } from '@velora/consumer-client';

import { useMediaAddressBook } from '../app/providers';

/**
 * Turning the image references a projection carries into something the browser
 * can load.
 *
 * Every consumer projection publishes references rather than addresses, and the
 * exchange re-decides visibility each time. That has a consequence a surface
 * has to be honest about: **a person may legitimately have no photograph to
 * show right now**, and the reason is never disclosed. Somebody who blocked
 * you, somebody whose image is still processing, and somebody who removed it
 * all look the same here, which is deliberate. Every caller therefore renders
 * an identity mark when there is no address, and none of them says why.
 *
 * The hook returns addresses as they arrive rather than blocking a render on
 * them. A card that waited for a photograph would show nothing at all for the
 * length of a request; a card that draws its identity mark and then replaces it
 * with the photograph shows something immediately and is never wrong in the
 * meantime.
 */
export function useMediaAddresses(
  references: readonly string[],
  variant: MediaVariant,
): ReadonlyMap<string, string> {
  return useAddressesFrom(references, variant, useMediaAddressBook());
}

/**
 * The same hook against a book the caller holds itself.
 *
 * The public creator page is not inside the signed-in shell — it is the one
 * surface a visitor with no account reaches — so it has no provider to take a
 * book from and builds its own. Everything else about how addresses are
 * obtained is identical, which is the point of it being one function.
 */
export function useAddressesFrom(
  references: readonly string[],
  variant: MediaVariant,
  book: MediaAddressBook<MediaVariant>,
): ReadonlyMap<string, string> {
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
 * The first, which is the slot its owner put first. A card, a row, and a
 * thread header each show one photograph, so asking for the rest would mint
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
