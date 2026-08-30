# ADR-0038: Creator Studio workspace refinements

- Decision date: 2026-08-30
- ADR status: Accepted

## Context

[ADR-0028](ADR-0028-creator-studio-product-interface.md) established Creator Studio under WARM SIGNAL and the [freeze report](../architecture/19-creator-studio-freeze-report.md) recorded the workspace as complete: five destinations, three shell arrangements, a declared route ancestry, every screen with its loading, empty, error and blocked states, and a width matrix asserted per element at ten widths.

Driving the whole workspace again — signed in against a seeded world, at five widths, at 200% text, through the catalog with a keyboard and through the money screens with real ledger rows — found that the foundation held and that a small number of specific things did not. None of them was a broken flow, and none of them was a fabricated figure: the honesty rules this surface was built to are intact, and the audit found no count, rate, total or trend that the server had not computed.

What it found instead was this.

**The primary navigation lost a destination at 200% text.** The tab bar's five columns were `1fr`, which is `minmax(auto, 1fr)`, and `auto`'s floor is the content's own minimum — for a label that may not break, the whole word. At twice the text size those five columns measured 399 px on a 320 px phone: Money was entirely off the screen and Clubs was clipped. The bar is fixed, so nothing else on the page moved and nothing gave it away.

**Three more things could not shrink and so pushed the page sideways at 200% text.** A button label ("See what visitors see" at 340 px on a 320 px screen), a badge ("Members only", 13 px past a 390 px viewport), and a row whose aside held an unbreakable timestamp beside a title.

**The test that should have caught all four had never run.** `survives a page zoomed to twice its text size` added its style tag *before* navigating, and a `goto` discards it — so the assertion measured ordinary 16 px text on every route it claimed to zoom, across four routes rather than eleven.

**Eight of eleven screens printed their own name twice on a phone.** The stylesheet already refuses this from the tablet up, in as many words: "printing the same words twice is not a second piece of information". A phone has no sidebar, keeps the bar, and got exactly that.

**A Back said only "Back".** From the tablet up the bar carries nothing else — wordmark, title and account control are all hidden there — so an arrow alone above a club page was the whole of what a creator had to read before leaving it.

**The catalog filter could not be linked to or returned to.** Which slice a creator is working through lived in component state, so a reload, a bookmark, a second tab and the browser's Back all lost it. Working through drafts one at a time is the catalog's main loop.

**The filter strip claimed a keyboard contract it did not keep.** `role="tablist"` and `role="tab"` are claims about the keyboard as much as about the name. Every option was its own Tab stop, the arrow keys did nothing, and nothing named the region the strip changed.

**The received-gifts screen showed a letter where a gift was.** `visual` is in the contract and the screen drew `name.slice(0, 1)`, so a creator read "R" where the person who sent it, and paid for it, saw a rose. It printed a raw locale date ("8/26/2026") among prose dates everywhere else, and painted a failed gift and a reversed one in the same quiet neutral as one still settling.

## Decision

### Nothing may push the workspace sideways at 200% text, and the navigation least of all

The tab bar's columns get an explicit zero floor, so the ellipsis the label was already asked to produce can actually happen. A button label takes a second line rather than the page. A badge is bounded and ellipsised, because a state is a word and not a sentence. A row wraps, with a measured floor on its body so the aside drops to its own line instead of squeezing the words to one letter — the floor scoped to a direct child, because the same class is reused in single-line headers where a floor would be the overflow rather than the cure.

These are the same four cures Consumer Web landed under [ADR-0037](ADR-0037-consumer-web-experience-refinements.md). The surfaces keep their own stylesheets by design; the defect class does not respect that boundary, and neither should the fix.

### The 200%-text assertion is made where it can fail

The style tag is re-applied after every navigation, the width moves to 320 px — the narrowest the workspace supports, and where a control that cannot shrink runs out of room first — and the matrix covers every route rather than four. The tab bar additionally gets its own assertion, that all five destinations begin and end within the screen, because a fixed bar can lose a destination without anything else on the page moving.

### The page's name moves; it is not printed twice

`PageHeadingWatcher` in the shell observes whichever heading the page registers, and the bar carries the page's name exactly while that heading is out of view. `PageHeader` registers itself. A page that registers nothing leaves the bar naming it throughout, which is what every screen had before and the safe direction to be wrong in.

This is presentation, not navigation. The declared parents, the direct-entry behaviour, and the rule that a destination has no Back are all unchanged.

### A Back says where it goes when the navigation has a word for it

The control is labelled with the destination's own name when its target is one of the five the navigation names, and with "Back" otherwise. Nothing invents a name for an address the table does not name — a Back labelled with a guess is worse than an arrow.

### Which slice of the catalog is being read is an address

`?show=` on `/catalog`, replaced rather than pushed so choosing a filter is not a Back step of its own. A value the product does not serve falls back to the whole catalog rather than showing nothing. Deep link, reload, a second tab and the browser's Back all keep the slice.

The workspace's own Back control still lands on `/catalog`, because its parent is declared and a Back that varied with where somebody came from is exactly the derived behaviour the declared table replaced. That gap is recorded rather than closed here: it is a navigation-semantics decision, not a Phase 8 one.

### A section switch behaves the way its role promises

The strip is one Tab stop with a roving `tabindex`, the arrows move and wrap, Home and End go to the ends, and selection follows focus because what is being filtered is already on the page. `aria-controls` names the region the strip actually changes, which is what makes the relationship real rather than asserted.

### The gift screen shows the gift, and says where the money stands

The silhouettes get a module of Studio's own — the surfaces are held apart deliberately and Studio already owns its whole mark set — and the history draws the one somebody chose, formats the date through the workspace's single day formatter, prefers the settlement instant to the creation one, and gives each state a tone and a sentence saying what it means for the ledger. A failure is critical, a settling gift is caution, a reversal is neutral, and a settlement is positive.

Nothing is counted. There is no total received, no best month, no top sender, and no rank. The sender is not named and never was: the contract publishes `senderVisibility: 'withheld'` and the screen says so.

The page's heading becomes "Money" like its three siblings, with the sub-navigation naming the view — which is the pattern the other three already used.

## What this ADR does not change

No route, contract, table, migration, or authorization rule. No commerce semantics: one offer per club, frozen prices, the retire-and-republish rule, and the statement that withdrawing from sale is not the same as ending a membership are all as [ADR-0035](ADR-0035-club-membership-product.md) left them. No club, catalog, or publication logic. No navigation ancestry. No admission or authentication behaviour. The creator profile re-read race — the editor keyed on the profile's version rather than re-seeded by an effect — is untouched and still asserted.

No new product data appears anywhere. Everything added to a screen was already in the contract and already being fetched.

## Consequences

The unit router stand-in now keeps the address it is sent to and re-renders whatever reads it. It remains a recorder — every navigation is still recorded and asserted — but a surface that legitimately keeps a filter in the query can be driven in a unit test rather than only in a browser. A recorder that swallowed the new address would have let a filter control that changed nothing pass.

The browser suite gained the named Back, the title handoff, the addressed slice, the tab bar at 200% text, and a 200%-text matrix that runs at all. Those are the five only a browser can answer, and the last of them is the one that had been answering nothing.
