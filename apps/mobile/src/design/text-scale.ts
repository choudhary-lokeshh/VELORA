/**
 * The system text size past which a layout has to give something up.
 *
 * One number, in one place, because three copies of it appeared within an hour
 * of each other: the tab bar capping its labels, a row of controls deciding to
 * stack, and a header deciding to let its sentence run on. They are the same
 * measurement — the point at which a slot whose width is fixed by something
 * other than its text stops being able to hold the text — and they must move
 * together or the surface starts disagreeing with itself about what "large"
 * means.
 *
 * Measured on a 1080-wide device rather than chosen: at 1.3 a two-word action
 * sharing a row with another control runs out of width, and five tab labels
 * stop fitting as whole words.
 *
 * It is used two ways, and the difference matters. As a `maxFontSizeMultiplier`
 * it stops text growing where growth could only become truncation. As a
 * threshold read from `PixelRatio.getFontScale()` it changes the layout
 * instead, which is the better answer wherever the layout has somewhere to go —
 * a column has room a row does not.
 */
export const largeTextScale = 1.3;
