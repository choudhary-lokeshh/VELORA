# Consumer Mobile surface

## Purpose and actor

Consumer Mobile is the mobile-app experience for adult users. It uses the same Velora account and backend/domain state as Consumer Web, while adopting mobile-native navigation, lifecycle, permission, notification, and accessibility patterns. It is not a separate product database or Creator/Admin client.

## Responsibilities and non-responsibilities

Mobile presents phase-approved onboarding, profile/availability, discovery, introductions, messaging, safety controls, notifications, account/privacy, and eligible commercial access. It may expose fewer commerce, creator, RTC, AI, or content capabilities than Web when distribution channel, country, device, provider, safety, or legal policy requires.

Mobile does not own domain state, rely on device storage for authorization, bypass Web/channel gates, or provide privileged creator/Admin operations. A locally cached object may improve offline UX but is never current eligibility or entitlement truth.

## Navigation and major screens

Expected navigation groups are onboarding/authentication, discovery, conversations, notifications/activity, profile/account, and persistent safety entry points. Modal, sheet, tab, stack, gesture, and back behavior are `DESIGN REQUIRED` in Figma and platform prototypes.

Major V1 screens cover launch/admission, signup/sign-in/recovery, adult/country/consent gates, profile setup/edit, availability, candidate view, introduction status, conversation/message composer, notifications, block/report, session/privacy, export/deletion, and safe unavailable/error states.

The local/test AI proof in [ADR-0033](../decisions/ADR-0033-local-test-ai-suggestion-platform.md) uses the same generated contract and bearer transport as the rest of Mobile. Profile and conversation assistants expose loading, cancellation, refusal, editable suggestion, and explicit **Use in draft** states. Use changes only native component state; the ordinary Save or Send remains the only effect. No conversation history, counterpart data, hidden state, or device secret enters AI context.

### Calling, and why it carries no media

The calling area drives the call lifecycle — invite, answer, decline, withdraw, hang up, authorize a join — against REALTIME's existing authority over the ordinary bearer transport. It opens no microphone, no camera, no audio route, and no peer connection, it requests no device permission, and it says so on screen rather than implying a capability it does not have.

**Native media is blocked, and what blocks it is now only the provider.** Two of the three former blockers are gone.

- Package compatibility never was one. As of 2026-08-21 `react-native-webrtc@124.0.8` declares `react-native >=0.60.0` and `@config-plugins/react-native-webrtc@15.0.2` declares `expo >=56`, which React Native 0.86 under Expo SDK 57 satisfies.
- The build was one, and is resolved. [ADR-0031](../decisions/ADR-0031-android-native-build-pipeline.md) gives this application an Android native pipeline: `apps/mobile/android` is generated from `app.config.ts`, `pnpm android:verify` asserts what came out, and `pnpm android:build` compiles, links, and packages it in CI. Native code in the tree is now code a gate builds.
- **There is still nothing to connect to.** `REALTIME_RTC_PROVIDER` is rejected by configuration outside local and test, because no provider is approved ([RTC provider eligibility](../compliance/10-rtc-provider-eligibility.md)), so no deployed environment can mint a join credential in the first place.

So the media library is deliberately **not** added, and that is a decision rather than an oversight. Linking twenty megabytes of native media code and declaring a microphone permission for a capability with no provider would be exactly the claimed capability this surface refuses everywhere else. The seam is in place and the vendor is not; adding one is now a provider decision rather than a build one.

The consequences are recorded honestly rather than worked around. There is no camera switch, no audio-route or Bluetooth control, and no microphone permission prompt, because each would be a control over a device this app never opens — and a permission prompt for a capability that does not exist teaches somebody to grant one for nothing. `RECORD_AUDIO` is not merely unused: `expo-image-picker` would contribute it for video capture, so it is blocked in the manifest and `pnpm android:verify` fails if the block ever disappears. Audio routing, front and back camera, and a microphone's permanent-denial path all belong to the change that introduces real media.

What the surface does handle is everything a phone produces around a call, and it handles it by holding no call state of its own. Returning to the foreground re-reads the call, so one that ended while the screen was off is reported rather than left on screen. A cold start restores nothing, so a notification tapped hours later cannot revive a finished call — reaching for the pair opens a new one instead. A network handover is a failed request followed by a re-read, not a state machine. Answering on another device makes this one stale at its next question, which it asks after every action, because the server records one acceptance and tells this device what happened. A safety ending arrives as `ended_by_platform` from any state — ringing, active, or reconnecting — and is shown as itself with no finer vocabulary, because distinguishing a block from an enforcement would publish the other person's decision.

No join credential is retained. Joining asks for one and drops it, and asks again on every join and every reconnect, which is what lets a block landing mid-call be enforced rather than outlived.

## Domains and dependencies

Domain ownership matches Consumer Web: AUTH owns authentication; IDENTITY ASSURANCE owns verified evidence; USERS owns self-declaration/profile/account; DISCOVERY, MESSAGING, TRUST & SAFETY, and NOTIFICATIONS own their states; REALTIME/BILLING/AI remain phase-gated. Mobile calls published API contracts only. Device push, camera, microphone, photo library, contacts, and location are platform capabilities, not automatic permissions or domain truth.

## Authentication, permissions, and app lifecycle

Mobile uses the short-lived access and rotating opaque refresh-token architecture from [ADR-0009](../decisions/ADR-0009-auth-authorization.md), with approved secure platform storage and per-device revocation. Exact token lifetimes, refresh single-use rotation, refresh-family reuse response, and secure-storage requirements are locked in [ADR-0017](../decisions/ADR-0017-auth-session-recovery-security-policy.md).

Token material is held by `expo-secure-store`, the first-party Expo module backed by the iOS Keychain and the Android Keystore. It is written with device-only accessibility that requires the device to be unlocked, so the entry is excluded from encrypted device backups and does not migrate to another device. There is no fallback: the module is reached only through a port, and nothing writes token material to asynchronous storage, the filesystem, a log, or analytics. An in-memory implementation exists for tests and is named so that no test can be read as evidence about the platform keystore.

Platform persistence is never authentication truth. iOS may retain a Keychain entry across a reinstall and Android clears Keystore data with the application, and neither outcome changes anything: the server owns revocation, so a surviving entry still fails the moment its family is revoked, and a lost entry only means re-authentication. A keystore failure is reported rather than hidden, and a device that cannot open its keystore re-authenticates instead of crashing.

Because the refresh token is single-use, every rotation passes through one in-flight exchange that concurrent callers share. A burst of requests meeting an expired access token therefore produces one rotation, never a replay that would revoke the family. When the server refuses a refresh, local material is dropped and the surface returns to authentication rather than retrying.

A transport failure is not an answer about a token. Launching offline, or losing the network mid-rotation, reports an unreachable service and keeps the stored session, so a connectivity blip never forces re-authentication. Only an explicit refusal from the server drops local material. Signing out clears local material even when the request does not reach the server, because leaving a usable token on the device would be the worse outcome; the family then remains live server-side until it expires. Sensitive operations may require biometric/device confirmation only as an additional local step; server assurance and domain authorization remain decisive. App foreground/background, termination, reinstall, device change, and clock/network issues must not duplicate mutations or extend expired access.

Request device permission only at point of need with clear purpose and a usable denied path. Contacts/location are not collected by default and require separate product/privacy approval. Camera/microphone access for future RTC does not imply consent to record.

## Deep links and notifications

Universal/app links validate scheme, host, route, token, feature phase, country/channel, session, and object authorization. Unknown, expired, or unauthorized links land safely without revealing object existence. Notification open re-authorizes destination; lock-screen copy is minimized and respects device/user privacy settings.

Push token registration, rotation, logout, account deletion, and multi-device behavior follow NOTIFICATIONS/AUTH contracts. Delivery is not proof that user saw content.

### Implemented: what a link and a notification actually do

**Only `velora://` reaches the application.** The manifest declares that scheme and no verified HTTPS App Link, because a verified link needs a domain whose `assetlinks.json` this platform serves, and no domain is owned or configured. Claiming one would fail verification on every device and open nothing, so `pnpm android:verify` fails if an `autoVerify` filter ever appears.

A link is matched against an allow-list of the addresses this application publishes and mapped through the same builders every screen uses. Nothing is concatenated or interpolated from what arrived, so there is no traversal to defend against: an unrecognized segment produces no address at all. An identifier is validated as a UUID before it is used, and a refused link lands on Notices with a sentence saying so rather than on a dead end.

**Possession still grants nothing**, and the parser is not what makes that true. The gate above the routes decides whether they are mounted at all, so a link followed while signed out lands on the welcome screen and reaches its destination only once the session is real; every request behind it carries the session and the server re-authorizes. A link to an object somebody may not see resolves to a real address and then shows a refusal, which is indistinguishable from an object that does not exist — the required behaviour, because telling the two apart would disclose that it exists.

**An invitation is the one link that is remembered rather than navigated.** `velora://invite/<code>` resolves to the launch address and its code is held in the platform keystore until an account exists, then handed over on the request that creates it and forgotten. It is captured in the link router rather than by a screen, and that is the only place it can be: the gate replaces every route with the welcome screen while there is no session, so a route component for that address would never mount for exactly the person the link is for. There is no invitation screen on this platform and there should not be — somebody opening it already has the application.

The invitation link the app *shares* is a web address rather than a `velora://` one, because the person being invited does not have the application, which is the entire reason they are being invited. A build with no `EXPO_PUBLIC_WEB_ORIGIN` offers no share control at all rather than handing somebody an address that opens nothing.

A notification tap carries a template key and one identifier and nothing else, so arriving fetches everything from the API at that moment. A cold launch is read once at mount, because an application started *by* a notification never receives the listener event for it; a tap is acted on once, keyed by the platform's own notification identifier, because Android re-delivers a response to a resumed activity. A call notice opens the relationship rather than a call, since a cold start restores nothing and the call it announced is over.

The Notices destination applies the same rule to its durable in-app activity. It resolves each subject through DISCOVERY's authorized person projection, renders the safe current display name and portrait when available, and keeps a deleted or revoked line readable as unavailable without a broken action. Message rows open their conversation; mutual-introduction and call-history rows open Introductions. Opening acknowledges the row, while unavailable rows retain an explicit read action. Initial load, refresh failure, empty, pagination-bound page, and retry states are rendered rather than inferred from a device cache.

## Responsive and platform rules

Mobile favors touch targets, safe areas, dynamic text, reduced motion, platform back behavior, keyboard/IME handling, portrait baseline, and explicit tablet adaptation. It need not match Web interface or expose identical features. Creator Studio and Platform Admin are not embedded as hidden Mobile screens.

## Offline, loading, error, and empty states

Reads may show clearly labeled cached data with freshness and refresh. Mutations queue only when contract explicitly supports idempotent offline submission; payment, entitlement, enforcement, and security changes do not assume offline success. Define initial/skeleton, pagination, empty, permission denied, offline, reconnect, retry, partial sync, rate limit, session expired, feature revoked, success, and destructive-confirmation states.

## Security, phase, and authority

Follow [consumer product](../product/02-consumer-product.md), [mobile responsive rules](../design/04-responsive-platform-rules.md), [accessibility/motion](../design/05-accessibility-motion.md), and [security baseline](../security/01-security-baseline.md). V1 includes consumer core and no new verification workflow UI. Phase 2 may add approved provider handoff/resume while the server remains evidence authority; Phase 2/3 and Conditional features otherwise follow phase/channel authority. Mobile distribution never silently broadens or narrows backend authorization.

## Implemented: the interface

The interface is NIGHT CURRENT, recorded in [ADR-0030](../decisions/ADR-0030-consumer-mobile-product-interface.md). It is not a fourth expression: the approved Master names exactly one Consumer expression, and this is the same product for the same person on a different device, so it carries the same palette, type scale, radii, motion, and icon set that `apps/web` publishes. What changes is the idiom, not the language — native navigation, native lifecycle, native gestures, touch-first density, and no hover state anywhere.

React Native cannot consume a CSS custom property, so the values exist twice, and neither copy is trusted: `pnpm design:parity` reads both files and fails the build if they disagree about a colour, a spacing step, a radius, a duration, an easing curve, label tracking, or any icon path. Exhaustiveness is checked in both directions, so a value added on one surface and mirrored on neither fails rather than shipping as a difference nobody chose.

Two things the approved DNA fixes needed a dependency each. IBM Plex Sans is not a system font on either platform, so it travels with the bundle in four weights; the 1.75 px icon stroke has no implementation in React Native without a vector library, so the marks are drawn with `react-native-svg` from the same 24-unit path table Consumer Web uses.

## Implemented: navigation and screens

Six destinations, the same six Consumer Web has and named the same way: Live, Discover, Introductions, Messages, Notices, You. Live is first and is where a launch lands, on the rule [ADR-0040](../decisions/ADR-0040-random-live-discovery.md) fixes: a bare `velora://` is somebody opening the product rather than following a link to a particular thing. They are real routes, so the system back gesture, a deep link, and a notification all land where they should, and the platform restores the right tab on a cold start.

**Calling is not a destination.** A call is placed against a mutual introduction and against nothing else, and the server derives who the other party is from the relationship — so entry lives beside that relationship in Introductions and in the conversation it authorized. A calling tab would be a second list of the same people with a field somewhere that took a person.

**Safety is not a destination either.** Blocking and reporting are one unobtrusive control on every surface that shows somebody, opening a sheet where the identifier is already known. A safety flow that asks a frightened person to paste an identifier is a safety flow that does not get used. What sits under You is the record — standing, appeals, blocks, and reports — and it says where the controls are.

Account, availability, notice preferences, safety, and the session sit under one You, each as its own address, so the first four destinations stay about other people and no single screen becomes a settings page nobody can find anything in.

## Implemented: what the surface refuses to claim

Every capability this build does not have is stated on the screen it would have appeared on, rather than hidden or faked.

- **A photograph can be added and is shown to nobody.** The native build resolved half of this: there is a camera control and a photo picker, and an image can be uploaded, inspected by the platform, and marked `ready` from a phone. The other half is untouched — `packages/validation` publishes image references with no address, because authorized delivery needs an approved storage provider and there is none. So every person is still an identity mark on a stable tone, and the screen that offers the control says plainly that no photograph is displayed anywhere, for anybody.
- **No push notification, and a permission asked for only when something is behind it.** This build can register a device: it declares notification channels, handles `POST_NOTIFICATIONS`, acquires a token behind a provider-neutral port, and registers and revokes against the contract. With no provider configured the port answers that there is none, no token is issued, and **no permission is ever requested** — the prompt appears only in the one state where a permission is the single thing missing, which a build with no provider cannot reach. A prompt in any other state would teach somebody to grant one for nothing.
- **No call carries media, and it is said before a call is placed** rather than only once one is ringing.
- **A bounded message preview on the conversation list.** It is the server's whitespace-normalized projection of the exact newest durable message, identifies the sender only relative to this account, and never represents a draft, delivery receipt, counterpart read position, typing, or presence. A future notification/privacy preference may hide it, but the client does not invent a local rule that contradicts the current product requirement.
- **No name against a block**, because the contract publishes none. The list is by date and says so.

The conversation screen is a pushed route with system Back. It marks the newest loaded server sequence read through the monotonic API, keeps a failed body available for an idempotent retry, blocks double-send through one in-flight action, accepts and wraps the published maximum body, and states that the composer is text only, has no attachments, and is not end-to-end encrypted. Voice/video call entry is bound to the conversation's published mutual-introduction relationship; the existing call lifecycle remains server-authoritative and still opens no microphone, camera, route, peer connection, or provider.
- **No account closure**, because every retention schedule it depends on is an open legal decision.

### Live, as a camera product

Live is the only screen that does not scroll while it is in use, and that is the point of it. One full-bleed canvas with absolute layers over it: the camera is the ground while there is nobody to look at, and becomes a picture-in-picture the moment somebody is found. The picture can be dragged and snaps to the nearest corner, through a pan gesture claimed only after a finger has travelled — so a tap on it is still a tap, and nothing outside the preview ever sees the touch, which is why it cannot fight the tab bar or the system back gesture.

The dock is fixed above the tab bar inside the safe area, and nothing that grows can push it away: not a long name, not a permission notice, not a chat filling up. Next is the widest control because it is the most frequent act in the product and it acknowledges before the server answers; Connect takes the accent only when the other person is waiting on it; the devices are at the thumb end and End is at the other, obvious without being loud.

Chat is a bottom sheet bounded to part of the screen rather than a card in a column, which is the only arrangement that survives a keyboard — and the hardware Back closes the sheet before it leaves the screen, because that is what Back is for on this platform.

The door explains itself once per launch and is then the fast door. That is a module flag rather than stored state on purpose: the honest alternative is a new persistence dependency for one boolean about a nicety, and this build pins its Expo tree too carefully to spend that on shortening a screen.

**No microphone is requested, and `RECORD_AUDIO` stays blocked in the merged manifest.** The camera opens so the person somebody meets can see them. Nothing records, and no approved provider carries audio anywhere, so asking for a microphone would be asking for a permission this build cannot use. The mute control still exists and is still authoritative over intent, and the screen says plainly that nothing is carrying audio yet — which is also why an emulator walk showing `CAMERA` granted and `RECORD_AUDIO` absent is the product behaving correctly rather than a defect.

## Implemented: the phone-specific behaviour

A cold launch restores from the platform keystore before asking the server anything, and the launch state is real and rendered rather than skipped. An offline launch keeps the stored session and reports that the service could not be reached, rather than claiming somebody is signed out. A session the server has ended drops local material and says which of the two happened.

Nothing polls. Every list asks again when the application returns to the foreground and when somebody acts, because a background timer would spend a battery keeping a screen nobody is looking at fresh.

Bottom sheets rather than centred dialogs, so a confirming control lands under the thumb of a hand already holding the device. A composer that lifts above the keyboard and keeps the words when a send fails. Pull to refresh on every list. Nothing tappable is smaller than 44 points, including a switch whose visible track is 28. Text scales with the system setting — uncapped for body copy, capped for the display steps, because an uncapped heading pushes the thing it heads off the screen.

## Implemented: how it was verified

**There is no simulator, no device, and no Xcode in the environment this was built in**, so the product was rendered through `react-native-web` in a real browser and walked at 320, 360, 390, 430, and 768 points across every screen, checking for element overflow, a document that scrolls sideways, and any tappable control under the minimum target.

That proves layout, state, reachability, and target size. It does not prove native chrome — the real status bar, the real keyboard, the real safe-area insets, the platform's scroll physics, or how the typeface renders on a device. [The freeze report](../architecture/21-consumer-mobile-freeze-report.md) records that limitation alongside the defects the walk did find.

## As built, after ADR-0039

[ADR-0039](../decisions/ADR-0039-consumer-mobile-device-refinements.md) records what changed once the application could be run on a device rather than only rendered in a browser. The limitation above is closed: an Android 36 device now runs the real bundle, and the fixes below were each found and confirmed on it.

**Two surfaces the phone did not have.** A person has an address — `/people/[personId]`, opened from a Discover card and reachable as `velora://people/<uuid>` — carrying every photograph the projection published rather than the one a card shows. Gifts sent have a history under You, with the gift's own silhouette, the amount the ledger posted, and what each state means for the person who sent it. **Sending is not offered and is not linked**: the API admits only `consumer_web`, and whether an application may point somebody at an outside payment page is unresolved store policy, so the screen says where sending happens and does nothing else.

**Three things the surface was saying that were not true.** You and Profile no longer assert that no photograph is displayed anywhere in the product; You reports what the server says about this person's own image and adds the platform-wide sentence only when the last delivery exchange refused for that reason. The You identity card shows the person's own portrait, as every other card in the product shows everybody else's.

**`velora://you/memberships` works.** The deep-link parser kept a second copy of the section list and had never gained the entry; `links.ts` owns the one list now, and the test walks all of it.

**The atmosphere is the strength it was specified at.** `react-native-svg` discards the alpha in `stopColor`, so both washes had been painting at full opacity — four and a half times over for the ember, seven for the neutral.

**Large text changes the layout rather than the words.** Past 1.3× a row of equal-weight controls becomes a column, a button drops its decorative mark before it costs the label a character, and a header stops counting lines instead of clipping a sentence. A screen with no tab bar under it holds the system gesture band open itself.

**Country and language still read as wire subtags on Android** — `NG`, `Both speak en` — because Hermes ships `Intl` without `DisplayNames`. Nothing is invented by that and no country list is hand-written; closing it is a bundle-size and dependency decision, open in [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md).

## As built, after ADR-0045

[ADR-0045](../decisions/ADR-0045-consumer-completion-doorways-keyboards-and-a-camera-that-is-off.md) closes the gaps a walk through the product found, on the device.

The keyboard is the screen frame's business rather than each screen's. One measurement — this view's position in the window against the keyboard's top edge — is used by the framed screen, the plain screen, the bottom sheet and the Live stage, so a form near the bottom of any screen can be filled in whether or not this Android resizes the window for the IME. Leaving a screen or closing a sheet dismisses the keys rather than leaving them over what is underneath.

The hardware Back answers in one place, in one order: an open sheet closes, an open confirmation closes, an active encounter asks with the same End the dock offers, a running search stops, and anything else falls through to the navigator. A person is on the other end of an encounter, and an accidental press may not abandon them.

Discover has two halves, People and Creators, with the section in the address under the same name Consumer Web uses. The creator half lists the public directory through a client that sends no credential, and a creator's page opens on their name, their bio and the links they published before anything they sell. Whether a club is invitation-only is the offers read's own answer; a read that failed says so instead.

Spoken languages are edited here rather than only during onboarding, because they gate discovery matching and the paid Live language preference and a phone is the only device many people have.

A decision made about a person leaves the way Back leaves, popping to the encounter or the feed they were opened from. The not-found screen has a header Back and pops to what was on screen before it. Signing out everywhere asks first. Coins can be pulled to refresh, and every read that fails — the wallet, its history, a person, memberships, payments, a creator's offers — says so with a retry rather than resting on a skeleton.

A far-end camera turned off removes the picture and says whose camera it is, in the same room, with the voice still arriving. There is no voice-only surface, because there is no need for one.

