# Real-provider proof: two people, one room, media both ways

Recorded 2026-09-01, from `e2e/live-provider.spec.ts`. It is the only evidence
in this repository that two strangers can actually see and hear each other, and
it is deliberately not evidence about any vendor being approved — configuration
refuses `REALTIME_RTC_PROVIDER=livekit` in staging and production on its own,
for the reason recorded in
[RTC provider eligibility](../../compliance/10-rtc-provider-eligibility.md).

The same specification was run against two servers on the same day, and both
runs are recorded below because they found different things. A self-hosted
LiveKit server proved the media path and found four defects. A LiveKit Cloud
project then proved the same media path across somebody else's network, and the
latency of doing so found two more that a server on loopback cannot expose.

Every claim here is an observation from a run. Where something is argued rather
than observed — Android is the one place — it says so.

## What was run: the self-hosted server

```
docker run -d --name velora-livekit-proof \
  -p 7880:7880 -p 7881:7881 -p 7882:7882/udp \
  -e LIVEKIT_KEYS="<key>: <secret>" \
  livekit/livekit-server:latest --dev --bind 0.0.0.0 --node-ip 127.0.0.1

REALTIME_LIVEKIT_URL=ws://127.0.0.1:7880 \
REALTIME_LIVEKIT_API_KEY=<key> \
REALTIME_LIVEKIT_API_SECRET=<secret> \
LIVE_DISCOVERY_SIMULATION=unavailable \
pnpm exec playwright test e2e/live-provider.spec.ts --project=chromium
```

Server version 1.13.6, self-hosted, on loopback. What a cloud project adds is
somebody else's operations, somebody else's network, and somebody else's terms —
and only the last of those is still unanswered, because the Cloud run recorded
below settled the other two. `--node-ip 127.0.0.1` and the published UDP port
matter: without them ICE cannot complete from the host and every
publication hangs, which is a property of running the server in a container and
not of anything in this repository.

`LIVE_DISCOVERY_SIMULATION=unavailable` is required and the spec refuses to run
without it. With the stand-in available, a person searching alone is matched
with a seeded account that has no camera, and the proof would be asserting the
absence of the media it exists to find.

## What passed on the self-hosted server

One test, 4.5 s of assertions after a 55 s cold start:

- two distinct seeded accounts, in two browser contexts with separate cookie
  jars, both admitted through the ordinary sign-in;
- the real matcher paired them because they were the only two people waiting —
  neither browser named anybody;
- a remote video element on both sides, with `videoWidth > 0` and a
  `currentTime` that advanced, which is a decoded frame and then another one;
- `inbound-rtp` byte counts above zero for **both** `video` and `audio`, on
  **both** sides, read from the browsers' own `RTCPeerConnection.getStats`;
- Next removed the peer's video from the other browser;
- both returned to the door.

## What the self-hosted server recorded

The room VELORA created, from the server's own log:

```
"request": {"name": "v99152edf8bd2c5d0e188f6e90f16d312", "emptyTimeout": 60,
            "departureTimeout": 20, "maxParticipants": 2,
            "metadata": "<redacted (69 bytes)>"}
```

The name is an HMAC of the platform's committed idempotency key under the
project's API secret: deterministic, so an ambiguous create is recoverable, and
unguessable without the secret. `maxParticipants: 2` is the provider enforcing
that a random encounter is two strangers and never a third. The metadata is the
platform session reference and nothing else, and the server redacts it in its
own logs.

The grant one participant was minted:

```
"Video": {"RoomCreate": false, "RoomList": false, "RoomRecord": false,
          "RoomAdmin": false, "RoomJoin": true,
          "Room": "v99152edf8bd2c5d0e188f6e90f16d312",
          "CanPublish": true, "CanSubscribe": true, "CanPublishData": false,
          "CanPublishSources": ["camera", "microphone"],
          "CanUpdateOwnMetadata": false, "Hidden": false, "Recorder": false}
```

Join on exactly one room, publish and subscribe, and nothing else. No data
channel, no recording, no room administration, no metadata write, and no source
other than a camera and a microphone — a screen share is refused by the
provider rather than by this platform.

Exactly two participants in that room, `6466c6a45fdde8b9` and `97ea99c9ce7135fd`
— per-session hashes, neither of which is an account identifier — and four
tracks between them:

```
TR_AMGaM2ymCnHEua  TR_AMsRcW669v5Xzk   (audio, one each)
TR_VC79ZevZsYv34T  TR_VC955u7Pgk9SyG   (video, one each)
```

## What the self-hosted run found

Four defects, none of which any simulated adapter can reveal. Each is fixed in
the same change as this evidence.

**A teardown obligation was discharged while its call was still running.**
REALTIME records the obligation to delete a room the moment a call has one, so
that a crash between ending a call and recording the debt cannot leak it — which
makes the row pending for the call's whole life. The reconciler claimed it on
its next five-second cycle and deleted the room out from under two people. It
was invisible with the in-process fixture because the worker holds its own
instance whose map is empty, so every attempt failed harmlessly. The reconciler
now postpones a teardown whose session is not terminal, without spending an
attempt.

**A session never left `connecting`, so the join timeout would have closed every
call at thirty seconds.** `markConnected` existed and had no caller: reaching
`active` requires an observation from the provider rather than from either
endpoint, and nothing was making one. The worker now asks the provider for the
state of sessions that are waiting to be observed.

**Publishing a raw `MediaStreamTrack` was refused by the provider.** A grant
that names permitted sources is enforced against the source a track *declares*,
and a raw track declares none. The web transport now states the source, and the
refusal it was getting — `insufficient permissions to publish` — was silent:
the room stayed joined and nothing was ever carried.

**The remote stream was mutated rather than replaced.** React bails out of a
state update that returns the same reference, so adding a video track to the
stream already in state changed nothing anything downstream could observe — and
the element that mounts when the first video track arrives was never handed the
stream. Audio arrives before video in the ordinary case, which is why it looked
like a video element with no picture.

## What LiveKit Cloud proved

Recorded 2026-09-01, after everything above, against the LiveKit Cloud project
at `wss://velora-m4vtt2eh.livekit.cloud`:

```
REALTIME_LIVEKIT_URL=<cloud project> \
REALTIME_LIVEKIT_API_KEY=<key> \
REALTIME_LIVEKIT_API_SECRET=<secret> \
LIVE_DISCOVERY_SIMULATION=unavailable \
pnpm exec playwright test e2e/live-provider.spec.ts --project=chromium
```

One test, passing: 4.1 s of assertions inside a 54.1 s run. The surfaces were
the built `.next/standalone` artifacts, rebuilt from the current tree before the
run; the API ran from source in a single process.

- `pnpm rtc:doctor` reported that the project accepted the configured
  credential, so server-API authentication against Cloud works;
- two distinct seeded accounts signed in to two browser contexts with separate
  cookie jars, and `LIVE_DISCOVERY_SIMULATION=unavailable` means the only
  possible match for either was the other browser;
- the real matcher paired them, and each was issued its own participant
  credential naming the same Cloud room;
- both joined that room and both published a camera and a microphone;
- a remote video element on both sides, `videoWidth > 0` and a `currentTime`
  that advanced — a decoded frame, and then another one;
- `inbound-rtp` byte counts above zero for **both** `video` and `audio`, on
  **both** sides, read from each browser's own `RTCPeerConnection.getStats` —
  which is media arriving in both directions rather than a negotiated session
  carrying nothing;
- Next removed the peer's video from the other browser;
- End returned both to the door.

This supersedes an earlier note in this file recording that no frame had crossed
a LiveKit Cloud project and that Cloud authentication had been disproved. Both
were true when written and are not true now. What was actually wrong was the
credential: the project answered `401 invalid token` rather than
`401 invalid API key`, which is the refusal a key and a secret taken from two
different key pairs produce — the project knew the key and could not verify the
signature it carried. `pnpm rtc:doctor` exists to ask that question in one
command, prints no credential, and names which of the two refusals it got; it is
what confirmed the replacement credential before this run. Nothing in VELORA
transforms either value on the way, and nothing about the adapter changed to
make Cloud work.

The grants Cloud mints were read from a browser's own connection during the
diagnostic runs that preceded this one, and are the same shape the self-hosted
server logged above: `roomJoin` on exactly one room, publish and subscribe,
`roomCreate`, `roomList`, `roomAdmin`, `roomRecord`, `canPublishData`,
`canUpdateOwnMetadata`, `hidden` and `recorder` all false, publishable sources
exactly `camera` and `microphone`, a per-session participant hash as the
subject, and a two-minute lifetime.

## What the Cloud attempt found

Three defects, in the order they were reached. The first is about diagnosis; the
other two are races that only exist because a real provider is a network away.

**A refused credential was being treated as an ambiguous create.** REALTIME
answers a provider that did not respond by asking it what it did with the
idempotency key committed before the call — the mechanism that stops a timeout
from creating two rooms. A `401` is not that: it is a definite answer, nothing
was created, and asking again with the same credential refuses again for the
same reason. The operator-facing consequence was the whole cost of it: the log
said `rtc provider lookup after an ambiguous create also failed`, which names
neither the credential nor the project, and every call paid two round trips
instead of one. The adapter now translates a `401` or `403` into a refusal the
port declares, and the orchestrator reports it as itself and does not look up
what was never created. The outcome is unchanged and still fail-closed: the
binding is unresolved, the call stays connecting, the join timeout closes it,
and nothing falls back to a simulated transport. Fixed in `22c06a6`; the
question it made askable is `a534c05`.

**A call was published before the room it names existed.** `LiveService.ensureSession`
bound `live_encounters.realtime_session_id` and *then* reached the provider, so
between those two writes both clients could read a `call` whose session had no
`provider_reference`. REALTIME refuses a join credential for one of those,
correctly — and reported it as `ACTION_NOT_PERMITTED`, which is what a blocked
pair is told and which a live surface treats as final, because a refusal is a
decision and a client that kept asking would be arguing with a safety answer. So
the browser asked once, gave up, and never joined a call it was in.

The window is exactly one provider round trip. Against a server on loopback it
is too narrow to land in; against Cloud it was 375 ms wide and the browser that
did not trigger the match landed in it on every run, while the other sat alone
in a room. Fixed in `d7ee810` by reaching the provider first and binding
afterwards, whatever the provider answered — a session that failed to reach one
is a fact the encounter has to carry, because the surface reads that state and
says the camera and voice could not be connected, which is true. `2d83249`
answers the remaining window honestly: `not_ready`, reported as `409
STATE_CONFLICT` beside the unchanged `ACTION_NOT_PERMITTED`, decided *after* the
eligibility composition so the softer answer is never reachable by somebody who
may not join at all. Both consumer surfaces ask again on that one code and on no
other.

**The loser of a bind was ending a live session.** A poll by somebody already
matched runs the same session work as the request that allocated the encounter,
so two runs overlap as a matter of course — and `openLiveSession` answers the
second with the *same* session rather than opening another one, which is what
makes one encounter mean one room. Losing the bind therefore left a runner
holding the session the winner had just published, and it was calling
`endLiveSession` on it.

It was latent while the window was microseconds wide. Putting the provider call
inside that window made it certain: every Cloud match ended with one browser
connected and publishing while the other's poll tore the session out from under
it, after which the platform correctly refused every credential for a call that
no longer existed. The loser now asks the encounter what it names — naming this
session is success by somebody else's hand — and only a session nothing will
ever reference is torn down. Fixed in `d7ee810`.

Three regression proofs cover the pair, each verified failing without its fix:
the ordering is observed from inside the provider call rather than inferred from
the rows afterwards, because the row order is identical either way; the overlap
is produced by holding both requests inside the provider call, and bounded so a
proof cannot hang waiting for a stronger version of a race it already has; and a
matched pair can both obtain a credential the instant they are matched, which is
the product statement the other two exist to keep true.

## Android: carried, on an emulator

Superseded on the same day this document last changed. What stood here said that
no frame had crossed any RTC provider on an Android runtime from this repository.
That was true when it was written and is not true now: a real Android client and
a real browser were matched by VELORA with simulation disabled, joined one
LiveKit Cloud room, and carried camera and microphone in both directions. The
run, the byte counts, the control-by-control transport measurements, and the five
Android-only defects it found are recorded in
[`../live-android-provider`](../live-android-provider/README.md).

What still stands from the older text is the integration itself:
`@livekit/react-native` reached only through `apps/mobile/src/product/live-rtc.ts`,
so no surface component imports a vendor; `RECORD_AUDIO` requested only after
somebody presses Start; `BLUETOOTH`, `BLUETOOTH_ADMIN` and `FOREGROUND_SERVICE`
refused, each for a reason recorded in
[ADR-0043](../../decisions/ADR-0043-livekit-transport-coins-and-paid-live-preferences.md);
and the preview yielding the camera to the room on the *server's* answer about
the encounter rather than on the transport's own success. `pnpm android:verify`
asserts the permission allow-list, the manifest, the signing configuration and
the SDK levels against a regenerated project on every gate run.

What is still not proved is narrower than it was, and it is a real limit rather
than a formality: the Android runtime was an **emulator**, whose camera is a
synthetic scene and whose microphone is silence. Transport, lifecycle, device
ownership and the controls are observed; picture quality, real microphone
routing, Bluetooth headsets, cellular networks and any physical handset are not.
The screenshots in [`../live-android`](../live-android) and
[`../live-v2-android`](../live-v2-android) predate all of this and were taken
against the `local-test` adapter, which carries no media and reaches no network.
