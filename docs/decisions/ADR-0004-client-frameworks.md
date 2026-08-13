# ADR-0004: Client frameworks and surface isolation

- Decision date: 2026-08-12
- ADR status: Accepted

## Context

Velora has three browser applications and one mobile application. They share account and domain truth but have different actors, risk, navigation, responsive behavior, and release channels. The selected stack must support strong typing, accessibility, deep links, push, media, future RTC, and agent-assisted development without pretending all surfaces share UI.

Current official sources were checked on the decision date. Next.js 16 is Active LTS. Expo SDK 57 targets React Native 0.86 and React 19.2.3, supports Node.js 22.13 or newer, and development builds permit custom native code. See [Next.js support policy](https://nextjs.org/support-policy), [Next.js 16 requirements](https://nextjs.org/docs/app/guides/upgrading/version-16), [Expo SDK matrix](https://docs.expo.dev/versions/latest/), [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/), and [React Native releases](https://reactnative.dev/releases/).

## Requirements

- Keep Consumer Web, Creator Studio, and Platform Admin as separate builds and deployables.
- Keep Consumer Mobile as a native iOS/Android application, not a responsive Web wrapper.
- Share API schemas, generated clients, error codes, safe enums, config contracts, and telemetry conventions without sharing permission assumptions.
- Support SSR/public discovery where useful, authenticated application flows, accessibility, deep links, push, camera/media, secure storage, and future WebRTC.
- Permit platform-native behavior and native modules without provider lock-in.

## Options evaluated

1. Next.js for all three browser surfaces; React Native with Expo for Mobile.
2. Separate browser frameworks per surface.
3. Vite single-page React applications for all browser surfaces.
4. Flutter for Mobile.
5. Bare React Native without Expo tooling.
6. Fully native Swift and Kotlin applications.

## Decision

- Use Next.js 16 App Router with React 19.2 for Consumer Web, Creator Studio, and Platform Admin. Each remains its own application, route tree, security posture, build artifact, environment configuration, and deployment.
- Choose rendering per route: static generation or server rendering for approved public pages; server/client rendering for authenticated workflows; no framework cache may become authorization, entitlement, safety, or country-gate truth.
- Share only low-level packages named in repository architecture: types, runtime validation, generated API client, typed config, and telemetry primitives. Surface-owned components, navigation, permissions, and page state remain inside their application. Future shared visual primitives require approved Figma and an ADR/package-boundary update.
- Use React Native 0.86 through Expo SDK 57 for Consumer Mobile. Use Expo Router, development builds, and Continuous Native Generation/prebuild. Expo Go is not a production or full integration environment.
- Allow reviewed Swift/Kotlin native modules or config plugins for secure storage, push, camera/media, RTC, accessibility, and platform integrations. JavaScript over-the-air updates, if later enabled, may not bypass app-store policy, native compatibility, product phase, security review, or server feature gates.
- Generate or publish TypeScript API contracts for all clients. Mobile imports only client-safe generated packages; it never imports Elysia application internals, Drizzle, or server domain code. ADR-0016 supersedes the backend framework name without changing this client boundary.
- Pin exact framework and native toolchain versions at bootstrap. Upgrade Expo SDK and React Native together according to Expo's compatibility matrix.

## Why

One React/TypeScript browser stack reduces operational and cognitive load while separate applications preserve product isolation. Next.js supports public and authenticated rendering modes without requiring three different frameworks. React Native/Expo preserves a shared TypeScript contract pipeline and strong AI-agent/tooling familiarity while retaining access to native code, push, media, and WebRTC through development builds.

## Rejected alternatives

- One combined Web/Studio/Admin application: risks privilege leakage, deployment coupling, bundle exposure, and confused product ownership.
- Different browser frameworks: multiplies build, security, test, and upgrade work without a current benefit.
- Vite-only single-page apps: excellent for client rendering, but gives up a consistent server-rendering/public-page path and requires more platform assembly.
- Flutter: strong performance and design fidelity, but introduces Dart, a second contract-generation pipeline, and less shared client/backend tooling for the initial team.
- Bare React Native: valid, but Expo now supplies supported native builds and configuration without preventing custom native code.
- Two fully native applications: highest platform control, but doubles product implementation and contract/client work before evidence demands it.

## Consequences

Browser apps can release independently while sharing toolchain and contracts. Mobile UI is not shared with Web. Native build health becomes part of routine release work. Public Next.js rendering must call authorized API projections and must not access domain persistence.

## Risks

- Shared packages can accidentally carry Admin or creator-only semantics into consumer clients.
- Next.js server features can become an unauthorized second backend.
- Expo/native upgrades can break RTC, push, media, or app-store builds.
- One React stack can encourage forced visual sameness across surfaces.

## Mitigations

Use package allowlists and bundle scans; restrict Next.js server code to API-client/BFF concerns with no domain repository or provider credentials; maintain native integration tests and upgrade rehearsals; keep approved Figma and surface documents authoritative.

## Scaling path

Scale each Web application independently. Add edge/CDN rendering only for public, non-sensitive content with explicit cache policy. Extract shared UI primitives only after approved design-system evidence. If Mobile later needs unsupported performance-critical work, add isolated native modules before considering a full framework rewrite.

## Security implications

Never embed provider secrets or Admin capabilities in clients. Web sessions use secure cookie/CSRF architecture from ADR-0009; Mobile uses secure device storage and bounded tokens. Server-rendered pages still re-authorize API data. Deep links, push entry, and cached content never grant access.

## Testing implications

Each surface has unit/component, contract, accessibility, visual-state, and end-to-end tests. Browser applications run Playwright across applicable browser projects. Mobile runs React Native component tests plus real iOS/Android smoke and Maestro flows. Native permissions, deep links, secure storage, push, background/foreground, offline, and upgrade paths require device tests.

## Migration/reversibility

Separate apps and language-neutral HTTP contracts keep framework replacement possible one surface at a time. Next.js pages can move without changing API contracts. Expo prebuild keeps native projects reproducible; ejecting to a maintained native project remains possible if an essential integration cannot be supported.

## Status

| Decision | Classification |
|---|---|
| Next.js 16 App Router for all three browser apps | LOCK NOW |
| Separate browser builds and deploys | LOCK NOW |
| React Native 0.86 through Expo SDK 57 | LOCK NOW |
| Expo development builds and prebuild | LOCK NOW |
| Native Swift/Kotlin modules where required | DECISION REQUIRED BEFORE FEATURE |
| Web visual/component sharing beyond current low-level packages | DECISION REQUIRED BEFORE FEATURE |
| Flutter Mobile | REJECTED |
| Combined Consumer/Creator/Admin Web application | REJECTED |
