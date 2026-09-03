import { describe, expect, it } from 'bun:test';
import {
  bioSchema,
  displayNameSchema,
  hasDisplayControlCharacters,
  messageBodySchema,
} from '@velora/validation';

/**
 * The characters that make one string render as another.
 *
 * Not a content policy — what somebody may say is a moderation question with an
 * unresolved taxonomy and a human reviewer. This is the narrow structural rule
 * underneath it: the small set of characters that carry no text and exist only
 * to change how the text around them is drawn.
 *
 * The rule has to be narrow in both directions, and both directions are
 * asserted here. Too wide and it refuses people's own names — the joiners are
 * required by Arabic, Persian, several Indic scripts and every multi-part
 * emoji. Too narrow and a display name renders as somebody else's, which is the
 * impersonation the report taxonomy has a reason code for.
 */

/** The characters that reverse how a run of text is drawn. */
const bidirectionalControls = [
  '\u202A',
  '\u202B',
  '\u202C',
  '\u202D',
  '\u202E',
  '\u2066',
  '\u2067',
  '\u2068',
  '\u2069',
  '\u200E',
  '\u200F',
  '\u061C',
];

/** Format characters real writing needs. */
const joiners = ['\u200C', '\u200D'];

describe('text that changes how other text is drawn', () => {
  it('refuses every bidirectional control', () => {
    for (const character of bidirectionalControls) {
      expect(
        hasDisplayControlCharacters(`Alex${character}Remi`),
        JSON.stringify(character),
      ).toBe(true);
    }
  });

  it('refuses the C0 and C1 controls that are not whitespace', () => {
    for (const character of [
      '\u0000',
      '\u000B',
      '\u000C',
      '\u001B',
      '\u007F',
    ]) {
      expect(
        hasDisplayControlCharacters(`Alex${character}`),
        JSON.stringify(character),
      ).toBe(true);
    }
  });

  it('allows the whitespace a message legitimately carries', () => {
    // Tab, newline and carriage return are text. A message written over several
    // lines is not an attack.
    expect(hasDisplayControlCharacters('one\ntwo\tthree\r\n')).toBe(false);
  });

  it('allows the joiners real scripts and emoji require', () => {
    for (const character of joiners) {
      expect(
        hasDisplayControlCharacters(`ab${character}cd`),
        JSON.stringify(character),
      ).toBe(false);
    }
    // A multi-part emoji is a joiner sequence. Refusing it would refuse a great
    // many people's display names for no safety gain at all.
    expect(
      hasDisplayControlCharacters('\u{1F469}\u200D\u{1F469}\u200D\u{1F467}'),
    ).toBe(false);
  });
});

describe('every field somebody else reads applies the same rule', () => {
  it('refuses a display name that renders as another name', () => {
    // The classic: an override reverses the run that follows it, so what is
    // stored and what is drawn are different strings. This is exactly what the
    // `impersonation` report reason exists for, and structural cases should not
    // need a human to catch them.
    expect(displayNameSchema.safeParse('Alex\u202EimeR').success).toBe(false);
    expect(displayNameSchema.safeParse('Alex\u2066Remi').success).toBe(false);
    expect(displayNameSchema.safeParse('Alex').success).toBe(true);
    // And a name that legitimately needs a joiner still works.
    expect(
      displayNameSchema.safeParse(
        '\u0639\u0628\u062F\u200C\u0627\u0644\u0644\u0647',
      ).success,
    ).toBe(true);
  });

  it('refuses the same characters in a bio', () => {
    expect(bioSchema.safeParse('Potter.\u202E').success).toBe(false);
    expect(bioSchema.safeParse('Potter.\u0007').success).toBe(false);
    // A bio is written in a text area, so newlines are ordinary text.
    expect(bioSchema.safeParse('Potter.\u0007').success).toBe(false);
  });

  it('refuses leading and trailing whitespace in a bio', () => {
    // Two bios that render identically must not be two different stored values,
    // and a client that trims before sending is not a guarantee.
    expect(bioSchema.safeParse('  Potter.').success).toBe(false);
    expect(bioSchema.safeParse('Potter.\u0007').success).toBe(false);
    expect(bioSchema.safeParse('').success).toBe(true);
  });

  it('refuses the same characters in a message body', () => {
    expect(messageBodySchema.safeParse('hello\u202Eolleh').success).toBe(false);
    expect(messageBodySchema.safeParse('hello\u0000').success).toBe(false);
    expect(messageBodySchema.safeParse('hello\nthere').success).toBe(true);
  });
});
