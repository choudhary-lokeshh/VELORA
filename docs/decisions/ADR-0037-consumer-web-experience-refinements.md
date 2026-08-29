# ADR-0037: Consumer Web experience refinements

- Decision date: 2026-08-29
- ADR status: Accepted

## Context

[ADR-0027](ADR-0027-consumer-web-product-interface.md) established Consumer Web under NIGHT CURRENT and the [freeze report](../architecture/18-consumer-web-freeze-report.md) recorded the surface as complete: five destinations, a shell in three arrangements, every screen with its loading, empty, error, and blocked states, and a width matrix asserted per element at ten widths. Later phases added rendered photographs, a purchase path, membership, and gifting on top of that foundation.

Driving the whole surface again — signed in against a seeded world, at ten widths, at 200% text, through a failed send and a refused join — found that the foundation held and that a small number of specific things did not. None of them was a broken flow. Every one of them was the difference between a product that works and a product that feels finished.

**A page named itself twice on every phone.** The stylesheet already refuses this on a wide window, in as many words: the sidebar names the destination, so a bar repeating it "would put the same word twice above every page". A phone has no sidebar, keeps the bar, and got exactly that — the destination in the bar and the same word as the heading a few pixels below it, on every route.

**Two screens pushed the document sideways at 200% text.** The creator directory's grid track had no floor, so a handle drawn with `white-space: nowrap` set the column's minimum; and a status pill that is deliberately unbreakable could not shrink and its row could not wrap.

**A group of introductions could not be linked to.** Discover made its section an address deliberately, so "Back, a bookmark, a second tab, and a deep link behave the way they behave everywhere else". Introductions kept the same kind of choice in component state, and additionally opened on "Waiting on you" whether or not anything was waiting there.

**The gift history lost the gift.** `visual` and the creator's handle are both in the contract; the screen drew the first letter of the gift's name, linked nothing, assembled its own money string, and printed a raw locale date beside relative days everywhere else. A failed gift and a returned one wore the same quiet badge.

**A club refused a join without saying why.** The creator page and the join page both name the shut commerce gate. The club destination said only that it could not be done today.

**A failed message left two copies and two ways to send it.** The words stayed in the composer *and* appeared in the unsent bubble. Beside the safe retry — which presents the identifier the first attempt presented — sat Send, which generates a new one.

**Two controls appeared and vanished.** Admission marked the current step in colour alone and read "Step N of 4" four times to a screen reader without saying which. The profile's Edit control was on screen before the profile read started and was replaced by a skeleton once it did.

## Decision

### The page's name moves; it is not printed twice

`PageHeadingWatcher` in the shell observes whichever heading the page registers, and the bar carries the page's name exactly while that heading is out of view. `PageHeader` registers itself; the person page registers its hero heading, which is a name over a photograph rather than a `PageHeader`. A page that registers nothing leaves the bar naming it for the whole of it, which is what every screen had before and the safe direction to be wrong in.

This is presentation, not navigation. Phase 2's route ancestry, the declared parents, the direct-entry fallback, and the rule that a top-level destination has no Back are all unchanged.

### A Back says where it goes when the navigation has a word for it

On a wide window the bar holds nothing but the Back control, and an arrow alone above Sent gifts does not say that Sent gifts is part of You. The control is labelled with the destination's own name when its target is one of the five the navigation names, and with "Back" otherwise. Nothing invents a name for a page the table does not name — a Back labelled with a guess is worse than an arrow.

### Nothing may push the document sideways at 200% text

The creator grid's track gets an explicit floor, and a row gets `flex-wrap` with a measured floor on its body so a long status pill drops to its own line instead of overflowing. The floor is scoped to a row's direct child, because the same body class is reused inside single-line headers where a floor would be the overflow rather than the cure. The section switch wraps to a second line rather than scrolling its last option off its own edge with the scrollbar hidden.

The browser suite asserts this at 200% text across every product route rather than one, which is what would have caught both.

### A section switch behaves the way its role promises

`role="tablist"` is a claim about the keyboard as much as about the name. The strip is one Tab stop with a roving `tabindex`, the arrow keys move and wrap, Home and End go to the ends, and focus follows selection because the panels are already on the page.

### Which introductions are being read is an address

`?show=` on `/introductions`, replaced rather than pushed, for the reason Discover's section is one. Which group opens by default is decided by where the work is rather than by a fixed order, and it stops being a default the moment somebody chooses.

### A `Section` primitive, because the same four decisions were being made eleven times

The landmark, the heading level, the identifier tying them together, and the rhythm inside were written out by hand on Memberships, Safety, Settings, You, and Availability. `Section` makes them once. It is not a card by default: several of these are a heading over a list on the page's own ground, and putting every one inside a raised box is what turns a product into a wall of panels.

### The gift history shows the gift

The silhouettes move to a module of their own and the history draws the one somebody chose, links the creator by the handle the contract publishes, formats the amount through the product's single money formatter and the date through its single day formatter, and gives each state a tone and a sentence saying what it means for the sender. Nothing is counted: there is no total sent, no streak, and no rank.

### A refusal names its reason wherever it is made

The club destination lists the shut commerce gates in the same words the creator page and the join page use. A refusal with the reason removed is the one shape this product does not use, because the reason is never something the reader did.

### An unsent message lives in one place

A failed send clears the composer. The words are in the unsent message, with "Try again" — which presents the same client identifier and is therefore safe against a request that committed before its answer was lost — and "Edit", which puts them back in the box as a deliberate second identifier. The unsafe path is no longer the more obvious one.

### The writing assist is folded away in a conversation

A profile form is a workbench and a panel among its fields belongs there. A conversation is two people talking, and a permanent assistant panel under the composer makes the quietest screen in the product the busiest one. Folded, it is one control until somebody asks; opened, it is the same panel with the same statement that nothing has been saved or sent. **The assistant remains draft-only on both surfaces, and neither ever saves or sends on somebody's behalf.**

### A control does not vanish under a reaching hand

Admission's step indicator is named, marks the current step programmatically, and writes the count out where anybody can read it. The profile card is one card whether the answer has arrived or not: what is unknown is drawn as a placeholder and the Edit control is not, because editing is something somebody may start before the server has answered.

## What this ADR does not change

No route, contract, table, migration, or authorization rule. No commerce semantics: the cadence, the amount, the renewal language, the absence of a stated tax treatment, and the statement that cancelling is not a refund are all as [ADR-0035](ADR-0035-club-membership-product.md) left them. No gifting logic. No navigation ancestry. No admission gate. The seeded-field behaviour that keeps somebody's typing when a profile read answers late is untouched and still asserted.

No new product data appears anywhere. Everything added to a screen was already in the contract and already being fetched.

## Consequences

The unit router stand-in now keeps the address it is sent to and re-renders whatever reads it. It remains a recorder — every navigation is still recorded and asserted — but a surface that deliberately keeps a section, a group, or a filter in the query can now be driven in a unit test rather than only in a browser. A recorder that swallowed the new address would have let a control that changed nothing pass.

The browser suite gained the title handoff, the named Back, the addressed group, and the 200%-text matrix across every route. Those are the four that only a browser can answer.
