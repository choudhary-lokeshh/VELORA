# ADR-0042: Live as a finished surface on a phone and on a laptop

- Decision date: 2026-09-01
- ADR status: Accepted
- Owners: Founder (decision owner), LIVE, design, Consumer Web, Consumer Mobile

## Context

[ADR-0041](ADR-0041-live-discovery-preferences-choice-and-presence.md) rearranged both Live surfaces as stages: the picture as the ground, the controls, the chat and the profile context floating over it, and nothing scrolling during a conversation. That was the right shape and it was asserted from a component suite and from a browser journey that drove the product by identifier rather than by eye.

Opening the two surfaces and looking at every state — a real Chromium at ten widths and at twice the text size, and a real Android 16 emulator on a tall phone, a compact phone, and in landscape — found the shape holding and a specific set of things that only looking could show. Six of them were defects rather than taste.

**On Consumer Web, the closed chat was on the screen.** `.v-live__chat` sets `display: flex`, which beats the browser's own rule for the `hidden` attribute, so a chat nobody had opened rendered at full size over the dock. Below 1024 px — where the chat starts closed — that covered the microphone, the camera, Connect, Next, the reactions and End: every control on the screen. jsdom loads no stylesheet, so the component suite saw a correctly hidden panel; the browser journey typed into the chat without opening it and never pressed anything underneath it. It was visible in the first screenshot taken at 390 px.

**Every Live screen pushed the document four pixels sideways on a phone.** The stage clawed back a gutter with `margin-inline: calc(var(--space-4) * -1)` and the immersive view had since been given `var(--space-3)`. Two numbers that had to agree, in two files, with nothing asserting they did — and `/live` was the one consumer address the width matrix did not visit.

**Live wore a document's frame on a laptop.** `.v-view--immersive` and `.v-view` have the same specificity, and the desktop `.v-view` padding is declared later in the file, so the immersive override lost the cascade above 1024 px. The stage sat inside a 40/32/64 frame with a dead band under it, on the screen the product is arranged around.

**The controls left the screen at twice the text size.** The shell grows with its content, the dock is pinned to the bottom of the stage, and a stage taller than the window puts its own dock below the fold. At 200 % text on a 390 px phone, Next and End were off the screen entirely — and the sideways-overflow measurement could not see it, because the stage clips rather than scrolling.

**On Android the keyboard covered the composer.** The manifest asks for `adjustResize`; Android 15 stopped honouring it for an edge-to-edge window, which is handed an IME inset to deal with itself instead. Opening the keyboard to type left the input, the send control and the whole dock underneath it.

**On Android the dock reserved the gesture band twice.** The tab bar below the scene already pads itself by the bottom inset and the dock added it again, so every gesture-navigation phone carried a band of dead black between Next and the bar. On a 360 × 640 phone the same row overflowed the other way and End lost its last letter off the side of the screen.

Everything else this ADR records is judgement rather than defect: a door that read as onboarding documentation, a desktop that was the mobile column stretched across a laptop, a Choose surface that was a contact list where Discover is a gallery, a search that conveyed itself through a three-pixel line, and a picture-in-picture that read as a floating rectangle rather than a part of the composition.

## Decision

### Live is a viewport, and the shell is told so

The shell takes a modifier when the page it is holding is immersive, and that modifier bounds it to the window and stops it scrolling. One page uses it. Everything that has to give is given by the canvas, which scrolls inside itself and centres its subject with auto margins rather than with `justify-content` — the second pushes overflowing content past a scroll container's start edge, where nothing can bring it back.

This is what makes the dock's position honest at every text size: the controls are pinned to the bottom of a stage that is bounded by the window rather than by what is inside it.

### Everything that floats is positioned against a measured floor, not a guessed one

The surface measures its dock, its phone chat sheet, and its notice layer, and publishes one composed custom property that every floating layer clears. The preview, the identity plate, the reactions, the connection moment and the sheet all read that one value.

A constant is a constant that is wrong at somebody's text size, and a per-layer constant is a set of them that drift apart: the permission notice cutting a sentence in half was the layer that had been left out. Consumer Mobile already measured its dock for this reason and now measures the keyboard the same way — the stage's own position in the window against the keyboard's top edge, which is correct whether or not the window was resized.

### The picture-in-picture is deterministic on the web and draggable on the phone

On the web it has one place: above the dock, at the trailing edge, landscape because that is the shape a laptop camera produces, moving only when the chat rail or the phone sheet takes the room it was in. A gesture there would compete with a scroll, a text selection and a browser's own affordances, and a preview that has to be found is worse than one that is always in the same place.

On the phone it keeps the drag and the corner snap it already had, because a thumb has nowhere else to put it and the gesture is contained to the view itself. It is portrait there, for the same reason it is landscape on a laptop.

### A wide window moves the identity out of the middle of the picture

Above 1024 px the peer's name, where they are, what the two of you share and what they wrote about themselves leave the centre of the canvas and become a compact plate in the lower corner, above the dock and beside the preview — which is where every video product puts a name, and which leaves the middle of the stage to the person rather than to a paragraph about them. The account of what is carrying them stays with the portrait, last and quietest.

Below that width the same content stays centred under the portrait, because a phone has no corner to spare. It is one component and one DOM order; the arrangement is the stylesheet's.

Nothing is added to what is shown. The bio was already published on the encounter's peer and neither surface was drawing it.

### What cannot fit is dropped in a stated order, rather than clipped

When the phone's chat sheet is open, or when the canvas measures too short for what it holds — a compact phone, a landscape window, twice the text size — the bio and the transport sentence give way, and on a short canvas the portrait and the name step down a size. Who this is stays. Both are back the moment there is room for them.

The alternative, which is what a compact device showed, is a canvas centring content taller than itself and pushing half of it off both ends.

### Choose is drawn the way Discover draws the same people

The candidates in Choose are the discovery feed, and DISCOVERY already answers that a viewer may see a candidate's imagery — it is the same predicate, asked about the same pair, for the same reason. So Choose now shows the portrait somebody chose, obtained the way every other consumer surface obtains one: a reference exchanged for a short-lived address, re-deciding visibility each time, with an identity mark and no explanation when there is nothing to show.

Consumer Web lays them out as a grid of tiles that answers the width it is given; Consumer Mobile uses the card, the avatar and the chips Discover already uses on a phone. Nothing on either says "online", carries a score, or claims a compatibility — none of those exists and every one of them would be invented here.

### Weight follows frequency, and grouping follows purpose

Both docks are three groups: the devices at one end where a hand reaches in a hurry, moving on in the middle or on the row nearest the thumb, and the social controls at the other end with a rule between them and leaving. Next is the widest control on the screen because it is the most frequent act in the product; Connect is quieter beside it and takes the accent only in the state where the other person is waiting on it. End is obvious, labelled, never behind a menu, and never flush against the control that sends a heart.

The floor under Next is stated in pixels rather than in `rem`. It is a statement about a thumb, and a thumb does not get bigger when somebody scales their text — in `rem` two floored controls were wider than a 390 px stage at 200 % text, and Next left the screen with nothing measuring it.

### The searching state conveys itself through the search, and still invents nothing

A slow pulse of three rings leaving a mark, over the person's own live picture, with a soft plate behind the words because the ground is a camera and a camera can be pointed at anything. Every phrasing of the state says that VELORA is looking, including the supporting line — the rotating line above it does not always carry the word, and a screen reading "Nobody yet" with nothing beside it is a screen that looks like it has stopped.

There is still no count of anybody, no queue position, no estimate, and no faces of people who are not there.

### Both docks and both scrims are drawn rather than approximated

Consumer Mobile draws its dock wash, its status-bar wash and its camera scrim as gradients through `react-native-svg`, which the shell already uses. The two flat overlays they replace darkened the whole picture by two thirds to protect the third of it carrying text, and left a hard edge wherever they stopped.

### Two regression guards, in the only place each is real

`/live` joins the width matrix, which is where the four-pixel overflow would have been caught. And the browser journey now presses the dock on a 390 px viewport with the chat closed and with it open — without `force`, which is exactly what an overlay over a control makes untrue. Neither is expressible in the component suite: one is a property of the stylesheet, and the other is a property of the stylesheet meeting a finger.

## Consequences

- Live is bounded to the window on every width, and the canvas is the only part of it that scrolls.
- Every floating layer on both surfaces clears a measured floor rather than a constant.
- Consumer Mobile deals with the keyboard itself, which is what an edge-to-edge Android window now requires.
- Choose shows photographs on both surfaces, through the existing media exchange and the existing visibility predicate. No new route, no new projection field, and no new permission.
- No contract changed. `pnpm runtime:inventory:check` reports the same runtime surface as ADR-0041 left it.

## Open

- **Country and language names on Android** remain wire subtags, which is the same open decision `DECISIONS_REQUIRED.md` already carries and is unchanged by this pass. It is the last visible difference between the two surfaces.
- **Landscape on Android is usable rather than composed.** Nothing clips, nothing is unreachable, and the arrangement is the portrait one in a wider box. A landscape composition is worth having and is not attempted here.
- **The remote pane is still an honest account of an absence.** When an RTC provider is approved, the stage already has the shape a remote picture goes into: the canvas is the picture, the plate is the name over it, and the preview is already in the corner.
