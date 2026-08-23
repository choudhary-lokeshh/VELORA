'use client';

import { Access } from '../../src/product/access';

/**
 * The access page is deliberately not behind the gate. It is the page the gate
 * sends people to, and a door that required the key it explains would be a
 * door nobody could read.
 */
export default function AccessPage() {
  return <Access />;
}
