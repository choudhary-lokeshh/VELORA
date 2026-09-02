# ADR-0045: Doorways, keyboards, and a camera that is off

- Decision date: 2026-09-02
- ADR status: Accepted
- Owners: Founder (decision owner), Consumer Web, Consumer Mobile, LIVE, REALTIME, design

## Context

[ADR-0037](ADR-0037-consumer-web-experience-refinements.md), [ADR-0039](ADR-0039-consumer-mobile-device-refinements.md) and [ADR-0042](ADR-0042-live-surface-refinements.md) each finished a surface by looking at it. This one walked the whole consumer product as a person rather than as a surface — signed out, in, through Live, into a conversation, out to a creator, into the wallet and back — and deliberately tried to get lost.

Getting lost was easy, and it was the same defect wearing different clothes each time.

**Five ways into a page had no way out of it.** A creator opened from your own memberships or your own sent gifts landed on the public creator page, which sits outside the application shell: no tab bar, no sidebar, and a Back that renders only when the address carries where it was followed from — which those links did not. A conversation opened from a Live encounter, from an introduction that had just become mutual, or from the notice announcing a message walked Back to the Inbox list, a place the person had not been. A person opened from Live was replaced to Discover the moment they pressed Interested, pulling somebody out of a live encounter they were still in — because the code deciding where to go held its own opinion instead of asking the table that owns the question. "Get coins" on the Live door led to a wallet whose Back went to You, abandoning a half-made choice. And a signed-out deep link came back from sign-in stripped of its query: a checkout return with no payment identifier renders as unavailable, and Discover forgets which half was being read.

**Back itself grew history instead of walking it.** The control is a link, and a link pushes. Discover, a person, Back left three entries; the return remounted Discover from nothing, losing the scroll position and every page the person had already loaded; and the browser's own Back then walked forwards into the person they had just left.

**No dialog participated in history at all.** On a phone the system Back is how an overlay is dismissed, and with a sheet open it navigated the page out from underneath it.

**On Android every keyboard-avoiding view in the application was inert.** The build is Android-only and each one chose its behaviour by platform, so the behaviour was always `undefined` — which renders a plain view. Android 15 stopped resizing an edge-to-edge window for the keyboard, so the composer, the profile's bio field and its Save, the sign-in field, the onboarding ladder, and the primary action of the report and appeal sheets were all simply behind the keys. The Live stage had already solved this by measuring itself against the keyboard's top edge; nothing else had.

**On Android the hardware Back was undefined inside a live encounter.** It closed the chat sheet if one was open and otherwise fell through to the navigator, which on a root activity moves the task to the background — leaving the encounter allocated and the other person looking at a participant who has stopped sending. A person is on the other end of that press.

**Creators were unreachable on a phone.** `CreatorScreen` and `ClubScreen` existed, served deep links, and nothing in the product linked to either: rooms in a building with no corridor. Sent gifts named a creator as plain text where the web linked it, and the mobile creator page rendered the word "Creator" as its title with no name, no bio, and no links — parity in what could be bought and none in who was selling.

**Spoken languages were a plaque.** They gate discovery matching and the paid Live language preference, and on a phone they were badges: whatever somebody answered during onboarding, on the only device many people have.

**Failures impersonated other states.** A failed wallet read was an infinite skeleton with the failure text rendered nowhere. A failed person read said "there is nothing to show here" — a claim about the world made on the strength of a network that did not answer. A failed offers read captioned a paid club "by invitation — there is nothing to buy here", which is a commercial claim. A failed availability read asserted that nobody could see you. A failed gift catalogue blamed the creator. A "Show more" that failed looked exactly like the end of the list.

**And the far end of a camera being turned off was a lie.** Turning a camera off mutes the publication rather than unpublishing it, so the subscription survives — and both transports tracked subscription alone. The remote element stayed mounted over a track that had stopped producing frames, which renders as the last frame the camera sent, frozen, under a caption still reading "Connected." A frozen stranger is worse than an empty pane: a person who appears to be there and is not.

## Decision

### Every doorway is declared, and Back walks history rather than growing it

The ancestry table already owned the question "where does this page belong". It now also owns "which doorways are real", per route, as a closed list: a conversation is reached from Live, from Introductions and from Notices; a creator from a person's own memberships and sent gifts; a club from memberships; the wallet from the Live door; a checkout return from the wallet. Every link into a nested page carries where it was followed from through the one builder that writes that parameter, and the gate carries the whole address — query included — through sign-in.

Nothing about the safety of this changes: what arrives in the parameter is still somebody else's string, still accepted only when it matches this origin's own declared parent or one of that route's declared origins, and a crafted value still degrades to the parent, which is where Back was going anyway.

The Back control stays a link, and becomes a link that pops when popping is right. When the previous page in this session is the page Back points at, it goes back through history and the browser restores that page as it was, with its scroll and everything it had loaded. The href remains for a deep link, a new tab and a modifier-click, where there is no history to return through. The memory of the previous address lives at module scope rather than in a component, because every page mounts its own shell — a ref was empty exactly when Back needed it.

### A dialog holds one history entry while it is open

Opening pushes an entry whose only meaning is "an overlay is open". Popping it — the phone's system Back, the browser's Back — closes the dialog and goes nowhere. Closing any other way consumes the entry, so Back afterwards is the page's own and never a ghost press. A dialog whose action navigated keeps that navigation: the entry is consumed only while it is still the current one.

### One keyboard mechanism, owned by the frame

The Live stage's measurement — this view's position in the window against the keyboard's top edge — becomes a hook the screen frame, the plain screen, the bottom sheet and the stage all use. It is correct whether or not the window is resized, so it is right on the Android that honours `adjustResize` and on the Android that does not. The inert keyboard-avoiding views are deleted rather than left looking like handling, and leaving a screen or closing a sheet dismisses the keys instead of leaving them standing over what is underneath.

### The hardware Back answers in one place, in the order a phone promises

An open sheet closes. An open confirmation closes. An active encounter asks — with the same End the dock offers, because ending is a thing done to somebody rather than a way of leaving a screen. A running search stops, which involves nobody else. Anything else falls through to the navigator. One handler with the order written out, rather than one per concern: the platform answers listeners most-recent-first, and two effects racing over mount order is how Back closes the wrong thing.

### The phone gets the corridor, and the creator gets a face

Discover has the two halves Consumer Web has, People and Creators, with the section in the address under the same name so Back, a relaunch and a deep link all restore the half being read. The creator half lists the public directory through the same credential-free client the web uses — these answers are identical for every requester, and attaching a session would collect an identity for no purpose. A creator's page opens on who they are: their name as the title, their bio, the links they published, and then what they sell.

Whether a club is invitation-only is the offers read's answer and no one else's. Until that read has answered, and if it fails, the surface says so rather than making a commercial claim on a network error's behalf.

### A failure is said, and never dressed as an absence

Every consumer surface that reads from the server distinguishes four things: it has not asked yet, it is asking, it asked and was told, and it asked and could not be told. The last of those says what happened and offers the retry that might change it, and it never renders as "there is nothing here" — because an absence is a claim about the world and a failure supports no claim at all. Where the difference is a privacy answer rather than a state, the ambiguity is kept deliberately: a person who does not exist and a person you may not see remain one answer.

### A camera that is off is rendered as off, in the same session

Both transports fold the provider's mute events into the fact the surface renders: a remote track counts as arriving only while it is subscribed *and* unmuted, this side's own mute is ignored, and a track that arrives already muted is never rendered. The room's own presence becomes a separate fact, so a peer with camera and microphone both off is described as here and quiet rather than as not having joined.

Consumer Web gains an audio element that is mounted for the whole encounter. The video element cannot be the sink for a voice, because it exists only while a picture is arriving — an audio-only peer was silent, and a camera turned off mid-call would have taken the voice with the face. The video element is muted so a camera coming back on does not add a second copy of the same person's voice.

This is the whole of "audio only" in this product. There is no voice matchmaking queue, no voice room, no second RTC state machine and no separate call button: somebody who wants to be heard and not seen turns their camera off inside the Live session they are already in, and everything else — microphone, chat, reactions, Connect, Next, End — continues untouched.

### A browser run owns its ports, or refuses to run

Playwright reuses whatever already listens on a `webServer` URL outside CI and never asks what answered. An unrelated development server adopted that way produces assertion failures that read as a broken product. The three surface ports come from one place, defaulted to the ones the rest of the repository uses and overridable per run, and the run refuses before it starts anything if a port is held by something that is not the surface it expects — naming the port, and telling the operator to move this run rather than that process.

## Consequences

- A person can leave every page they can enter, and leaving returns them to the place they came from with what they had loaded still there.
- The system Back on a phone means what it means everywhere else on the platform, including the one place where pressing it carelessly would abandon another person.
- A form on a phone can be filled in with the keyboard open, on every screen rather than on the one screen that had solved it.
- Creators are a reachable part of the consumer product on both surfaces, and a creator is a person on both.
- No consumer surface can produce an infinite skeleton, and no failure can be read as a fact about somebody else.
- Camera-off is a rendered product state proved against a real provider, and audio-only needs no second architecture. The proof is recorded in [live-provider evidence](../evidence/live-provider/README.md), and what was watched happen on a device and in a browser for the rest of this phase is in [consumer-completion evidence](../evidence/consumer-completion/README.md).
- A browser run on a shared machine either owns its ports or says so.

## Alternatives considered

**Derive Back by truncating the address.** Rejected before, and the same answer here: truncation produces addresses this product does not serve. What is new is that a route can have more than one honest doorway, and deriving those from the referrer would mean trusting a string somebody else can write.

**Let Back always call `history.back()`.** Simpler, and wrong for the arrival that has no history: a deep link, a notification, a new tab. Those are exactly the arrivals a fallback exists for, and sending somebody out of the site because their history was empty is the defect this table was built to prevent.

**Give the phone a second, voice-only meeting surface.** Rejected. Two matchmaking paths, two session lifecycles and two sets of safety plumbing for what is one camera control, and every one of those is a place for the two to disagree about who somebody is talking to.

**Keep the frozen frame and add a "camera off" caption over it.** Rejected. The caption would be true and the picture would still be a person who is not there; the honest thing to remove is the picture.
