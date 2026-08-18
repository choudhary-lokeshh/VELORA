# Consumer Mobile surface

## Purpose and actor

Consumer Mobile is the mobile-app experience for adult users. It uses the same Velora account and backend/domain state as Consumer Web, while adopting mobile-native navigation, lifecycle, permission, notification, and accessibility patterns. It is not a separate product database or Creator/Admin client.

## Responsibilities and non-responsibilities

Mobile presents phase-approved onboarding, profile/availability, discovery, introductions, messaging, safety controls, notifications, account/privacy, and eligible commercial access. It may expose fewer commerce, creator, RTC, AI, or content capabilities than Web when distribution channel, country, device, provider, safety, or legal policy requires.

Mobile does not own domain state, rely on device storage for authorization, bypass Web/channel gates, or provide privileged creator/Admin operations. A locally cached object may improve offline UX but is never current eligibility or entitlement truth.

## Navigation and major screens

Expected navigation groups are onboarding/authentication, discovery, conversations, notifications/activity, profile/account, and persistent safety entry points. Modal, sheet, tab, stack, gesture, and back behavior are `DESIGN REQUIRED` in Figma and platform prototypes.

Major V1 screens cover launch/admission, signup/sign-in/recovery, adult/country/consent gates, profile setup/edit, availability, candidate view, introduction status, conversation/message composer, notifications, block/report, session/privacy, export/deletion, and safe unavailable/error states.

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

## Responsive and platform rules

Mobile favors touch targets, safe areas, dynamic text, reduced motion, platform back behavior, keyboard/IME handling, portrait baseline, and explicit tablet adaptation. It need not match Web interface or expose identical features. Creator Studio and Platform Admin are not embedded as hidden Mobile screens.

## Offline, loading, error, and empty states

Reads may show clearly labeled cached data with freshness and refresh. Mutations queue only when contract explicitly supports idempotent offline submission; payment, entitlement, enforcement, and security changes do not assume offline success. Define initial/skeleton, pagination, empty, permission denied, offline, reconnect, retry, partial sync, rate limit, session expired, feature revoked, success, and destructive-confirmation states.

## Security, phase, and authority

Follow [consumer product](../product/02-consumer-product.md), [mobile responsive rules](../design/04-responsive-platform-rules.md), [accessibility/motion](../design/05-accessibility-motion.md), and [security baseline](../security/01-security-baseline.md). V1 includes consumer core and no new verification workflow UI. Phase 2 may add approved provider handoff/resume while the server remains evidence authority; Phase 2/3 and Conditional features otherwise follow phase/channel authority. Mobile distribution never silently broadens or narrows backend authorization.
