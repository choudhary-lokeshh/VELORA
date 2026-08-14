import { ConsumerApp } from '../src/product/app';

/**
 * Consumer Mobile's single authenticated surface.
 *
 * V1 has one screen with peer areas rather than a stack: every area is a sibling
 * a person switches between, none of them is reached "through" another, and a
 * stack would add restoration state without giving anybody anything. When a
 * flow appears that genuinely nests — a conversation opened from a push, say —
 * it gets a route.
 */
export default function ConsumerMobileScreen() {
  return <ConsumerApp />;
}
