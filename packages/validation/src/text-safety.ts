/**
 * The characters that make one string render as another.
 *
 * Not a content policy. Nothing here is about what somebody may say — that is a
 * moderation question with an unresolved taxonomy and a human reviewer. This is
 * about the small set of characters that carry no text at all and exist only to
 * change how the text around them is drawn, which is the beginning of every
 * impersonation trick a product with display names and messages has to refuse.
 *
 * It is deliberately narrow. A blanket ban on format characters would break
 * real writing: the zero-width joiner and non-joiner are required by Arabic,
 * Persian, several Indic scripts, and every multi-part emoji, and a product for
 * meeting people cannot refuse somebody's own name.
 */

/**
 * C0 and C1 controls other than tab, newline, and carriage return.
 *
 * Named as escapes rather than written literally so the source stays readable
 * text.
 */
export const controlCharacters =
  // eslint-disable-next-line no-control-regex -- naming them is the purpose.
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;

/**
 * The bidirectional formatting characters, and only those.
 *
 * `U+202A`–`U+202E` are the legacy embedding and override controls, `U+2066`–
 * `U+2069` the isolates, and `U+200E`, `U+200F`, `U+061C` the marks. Together
 * they can reverse the visual order of a run of text without changing a single
 * code point of it, which is how a name renders as somebody else's and how a
 * message shows one thing and contains another. The same class of character is
 * what the "Trojan Source" work is about, and the answer there is the answer
 * here: refuse them in text somebody else will read.
 *
 * The joiners are deliberately absent from this list. `U+200C` and `U+200D` are
 * format characters too and they are load-bearing in real scripts and in emoji
 * sequences, so refusing them would refuse people's own names.
 */
export const bidirectionalControls =
  /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/u;

/**
 * Whether this text carries a character that exists only to change how other
 * text is drawn.
 *
 * One predicate rather than two checks at every call site, so a field that is
 * bounded here cannot be bounded differently somewhere else.
 */
export function hasDisplayControlCharacters(value: string): boolean {
  return controlCharacters.test(value) || bidirectionalControls.test(value);
}
