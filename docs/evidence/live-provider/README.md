# Real-provider proof: two people, one room, media both ways

Recorded 2026-09-01, from `e2e/live-provider.spec.ts` run against a real
LiveKit server. It is the only evidence in this repository that two strangers
can actually see and hear each other, and it is deliberately not evidence about
any vendor being approved — configuration refuses `REALTIME_RTC_PROVIDER=livekit`
in staging and production on its own, for the reason recorded in
[RTC provider eligibility](../../compliance/10-rtc-provider-eligibility.md).

## What was run

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

Server version 1.13.6, self-hosted rather than LiveKit Cloud. The protocol, the
token format, the server API, and the browser SDK are the same; what a cloud
project adds is somebody else's operations and somebody else's terms, which is
exactly the part that is unapproved. `--node-ip 127.0.0.1` and the published UDP
port matter: without them ICE cannot complete from the host and every
publication hangs, which is a property of running the server in a container and
not of anything in this repository.

`LIVE_DISCOVERY_SIMULATION=unavailable` is required and the spec refuses to run
without it. With the stand-in available, a person searching alone is matched
with a seeded account that has no camera, and the proof would be asserting the
absence of the media it exists to find.

## What passed

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

## What the provider recorded

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

## What it found

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
