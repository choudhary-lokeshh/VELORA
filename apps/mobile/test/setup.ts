import { configure } from '@testing-library/react-native';

/**
 * React 19 refuses to treat updates as test-scoped unless the environment says
 * it is one. React Native Testing Library drives its own act() calls, so the
 * flag has to be set before any component renders.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Re-asserted before every test: the flag is saved and restored around each
// act() call, and a restore that predates this file leaves it unset for
// everything that follows.
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

/**
 * A launch makes several requests in sequence — session, account, onboarding,
 * profile, then whatever the open area needs — and each one is a real promise
 * chain through the generated client. The default one-second budget is a
 * stopwatch on that chain rather than on the app, so it is widened to something
 * that only a genuinely stuck surface would exceed.
 */
configure({ asyncUtilTimeout: 3_000 });
