# Android against a real provider: a phone and a browser in one Cloud room

The first time a frame has crossed an RTC provider on an Android runtime from
this repository. Recorded on 1 September 2026, against the same LiveKit Cloud
project the [Web ↔ Web proof](../live-provider/README.md) used, on the same
machine, within the hour.

Every claim below is an observation from that run. Where something is argued
rather than observed — and there is one such place, the difference between an
emulator and a handset — it says so.

## What was run

| | |
| --- | --- |
| Runtime | `velora-android36` emulator, Android 16, API 36, `arm64-v8a`, Pixel 7 profile, headless (`-gpu guest`), cameras `-camera-front emulated -camera-back emulated` |
| Build | `com.velora.consumer` 0.1.0 (1), debug APK from `pnpm android:build --debug`, `minSdk` 24, `targetSdk` 36, debug-signed |
| JavaScript | served by Metro from this working tree, not a stale bundle |
| Provider | LiveKit Cloud, `REALTIME_RTC_PROVIDER=livekit` |
| Matcher | real; `LIVE_DISCOVERY_SIMULATION=unavailable`, so the only possible match for either side was the other |
| Android account | `person-02@velora.seed` |
| Web peer | `person-04@velora.seed` in headless Chromium with synthetic capture devices |
| API | local `bun run dev` stack, reached from the device through `adb reverse tcp:4000` |

The APK's own manifest, read back from the artifact rather than from the source:
14 permissions, including `CAMERA`, `RECORD_AUDIO` and `MODIFY_AUDIO_SETTINGS`,
and none of `BLUETOOTH`, `BLUETOOTH_ADMIN` or `FOREGROUND_SERVICE`. The
application was uninstalled before this build was installed, so nothing about
this run inherited an earlier install's state or permissions.

## What the permission model did

Observed on a fresh install with all three runtime permissions denied:

- Cold launch, sign-in, and arrival on Live prompted for **nothing**. `CAMERA`
  and `RECORD_AUDIO` both still read `granted=false` from
  `dumpsys package com.velora.consumer` after the account had signed in and the
  Live door had rendered.
- Pressing **Start** produced the camera dialog, and then the microphone
  dialog — in that order, one at a time, each naming what it is for.
- `POST_NOTIFICATIONS` was never requested by any of this.

## What crossed the network

Read from the Web peer's own `RTCPeerConnection.getStats()`, because a byte
count is the only thing that separates a negotiated session from a carried one.

- Android joined LiveKit Cloud room `v660e3382…`, region India South, protocol
  17. **One** signal connection for the whole encounter, and **one** audio-focus
  request with no abandon until the encounter ended.
- The Web peer's identity plate named the Android account, and the Android
  screen named the Web account. The matcher paired them; neither client chose.
- **Android → Web video:** 3.2 MB and 979 decoded frames, `videoWidth` above
  zero and `currentTime` advancing throughout.
- **Android → Web audio:** 33 kB, rising continuously while unmuted.
- **Web → Android:** the Web peer's synthetic camera rendered full-bleed on the
  phone, with its own frame counter visibly advancing between screenshots taken
  a minute apart — see [`01-carried-both-ways.png`](01-carried-both-ways.png).
- **Both directions at once**, from a single encounter, with the local
  self-view showing the emulator's own capture in the corner.

## What the controls did to the transport

Each of these was measured at the far end, not read off an icon.

| Control | What the Web peer saw |
| --- | --- |
| Mute | inbound audio froze at 24,948 bytes for 16 s while video kept climbing |
| Unmute | inbound audio resumed within one tick |
| Camera off | inbound video froze; `Camera2Session: Camera device closed` on the phone — the device was released, not merely muted |
| Camera on | camera reopened, inbound video resumed |
| Switch camera | `Stop camera2 session on camera 1` then `Opening camera 0`, with `remoteVideoTracks` still 1 and inbound video never interrupted — the publication survived the device change |
| Background | camera evicted by the system (`PID 0` in the camera service's own history) |
| Foreground | `Opening camera 0` within 4 s, inbound video resumed |
| Next | the Web peer's remote tracks went to zero and the peer's name cleared; the phone abandoned audio focus and closed the camera |
| End | the phone returned to the Live door with `Active Camera Clients: []` — see [`03-end-returns-to-the-door.png`](03-end-returns-to-the-door.png) |

## What the attempt found

Five defects, none of which any simulated adapter can reach: three need a room
that actually connects, one needs an operating system that takes a camera away,
and one needs a remote video track to lay out. Each is fixed, and each has a
regression test in `apps/mobile/test/live-transport.test.tsx` that was watched
failing before its fix.

**The microphone permission tore down the call.** The effect that joins and
leaves the room was keyed on whether the microphone had been granted. The
microphone dialog arrives *beside* the search, so the ordinary sequence — match,
connect, then say yes to being heard — disconnected the established room and
joined it again, costing the audio session, both publications, and about a
second of the call. Measured before the fix: two signal connections and an
abandoned audio focus 25 s into a call nobody had touched. After: one of each.

**The camera was opened once and never retried.** Android refuses the camera to
an application that is not in front, and the microphone dialog is exactly that.
The single open attempted behind it failed silently, and nothing tried again —
so the fixed call carried no video at all for its whole life. This defect was
*hidden* by the one above: the teardown-and-rebuild happened to re-attempt the
camera a second later, and removing the teardown exposed it. Publishing now
retries whenever the application returns to the front, which is precisely when
the dialog goes away; observed on the device as `Opening camera 1` nine seconds
after the connection, in the same room.

**A camera the person had switched off was published anyway.** Connecting
force-enabled the camera and the mute effect turned it off a render later.
Publishing now reads the person's intent from the start.

**The picture never came back after a background.** The system evicts the camera
from a backgrounded application and hands nothing back; the publication survives,
so the far end kept a frozen frame of somebody who was still in the call while
the surface went on saying "Connected." Returning to the front now restarts the
track under the same publication.

**"Switch camera" did nothing during a call.** The provider owns the device once
an encounter is carried, and the control was flipping the facing of a preview
that had already been unmounted. It now restarts the published track with the
other facing, which keeps the far end's subscription.

**The other person's picture was a strip across the middle of the screen.** An
absolutely-positioned layer on a phone fills its own parent and nothing further,
and the video was mounted inside the pane that names somebody — a column sized
to a name, a country and a sentence. The identity text was drawn on top of the
face. [`02-letterboxed-before-the-fix.png`](02-letterboxed-before-the-fix.png)
is what that looked like with a real remote camera; the picture is now a
full-bleed layer on the stage with the words on their own ground over it. The
red strip along the bottom of that screenshot is the development client's log
overlay, not product interface.

## What this run does not prove

**It is an emulator, not a handset.** The capture pipeline is the emulator's
synthetic camera and its audio input is silence, so this proves transport,
lifecycle and device ownership rather than picture or sound quality. Audio bytes
were non-zero and moved with the mute control, which is the transport claim;
nobody has heard anybody.

**No physical Android device has been used.** Camera hardware quirks, real
microphone routing, thermal behaviour, and cellular networks are all untested.

**Bluetooth headset routing is not supported and was not tested.** `BLUETOOTH`
and `BLUETOOTH_ADMIN` remain refused, which is a product decision nobody has
made rather than an oversight.

**Background media is deliberately absent.** There is no `FOREGROUND_SERVICE`,
so a backgrounded encounter loses the camera and the microphone by design. What
was fixed here is the return, not the absence.

**Android ↔ Android was not run.** One emulator is what this machine can hold.

## Cross-references

[Real-provider proof (Web ↔ Web)](../live-provider/README.md),
[ADR-0043](../../decisions/ADR-0043-livekit-transport-coins-and-paid-live-preferences.md),
[Android native build](../../engineering/11-android-native-build.md),
[Consumer Mobile surface](../../surfaces/02-consumer-mobile.md).
