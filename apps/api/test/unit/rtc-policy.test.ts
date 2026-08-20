import { describe, expect, it } from 'bun:test';

import {
  callRecordingImplemented,
  callRetentionDuration,
  endReasonsFor,
  isEndReasonValidFor,
  isTerminalRtcSessionState,
  liveRtcSessionStates,
  mayTransitionRtcSession,
  rtcCallMediums,
  rtcEndReasons,
  rtcInvitationTimeoutMilliseconds,
  rtcJoinTimeoutMilliseconds,
  rtcParticipantRoles,
  rtcReconnectGraceMilliseconds,
  rtcSessionStates,
  terminalRtcSessionStates,
} from '../../src/realtime/policy.js';

describe('the call lifecycle is a closed vocabulary', () => {
  it('partitions every state into exactly one of live or terminal', () => {
    for (const state of rtcSessionStates) {
      const live = liveRtcSessionStates.includes(state);
      const terminal = terminalRtcSessionStates.includes(state);
      expect(live).not.toBe(terminal);
      expect(isTerminalRtcSessionState(state)).toBe(terminal);
    }
    expect(liveRtcSessionStates.length + terminalRtcSessionStates.length).toBe(
      rtcSessionStates.length,
    );
  });

  it('has exactly one entry state, and it is `invited`', () => {
    const reachable = new Set(
      rtcSessionStates.flatMap((from) =>
        rtcSessionStates.filter((to) => mayTransitionRtcSession(from, to)),
      ),
    );
    expect(reachable.has('invited')).toBe(false);
  });

  it('lets nothing follow a terminal state', () => {
    for (const state of terminalRtcSessionStates) {
      for (const next of rtcSessionStates) {
        expect(mayTransitionRtcSession(state, next)).toBe(false);
      }
    }
  });

  it('reaches every live state and every terminal state from `invited`', () => {
    const seen = new Set<string>(['invited']);
    const queue = ['invited' as const];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      for (const next of rtcSessionStates) {
        if (!mayTransitionRtcSession(current, next)) continue;
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next as 'invited');
      }
    }
    // A state nothing can reach is a state that can never be recorded, which
    // would make it a vocabulary entry rather than a lifecycle one.
    for (const state of rtcSessionStates) {
      expect(seen.has(state)).toBe(true);
    }
  });

  it('never moves out of a state without passing through the model', () => {
    // Acceptance is the only way past `invited` into a call, so no path can
    // reach `active` without it. This is what stops a provider event moving a
    // call somebody never answered.
    expect(mayTransitionRtcSession('invited', 'connecting')).toBe(false);
    expect(mayTransitionRtcSession('invited', 'active')).toBe(false);
    expect(mayTransitionRtcSession('accepted', 'active')).toBe(false);
  });

  it('lets safety end a ringing call without pretending somebody declined it', () => {
    // The one reason `ended` is reachable from `invited`. Recording a block as
    // a rejection or a cancellation would attribute the decision to one of the
    // two people, and neither of them made it.
    expect(mayTransitionRtcSession('invited', 'ended')).toBe(true);
    expect(isEndReasonValidFor('ended', 'safety_block')).toBe(true);
    expect(isEndReasonValidFor('ended', 'safety_enforcement')).toBe(true);
  });

  it('offers no route back from `ending`, other than finishing', () => {
    for (const next of rtcSessionStates) {
      expect(mayTransitionRtcSession('ending', next)).toBe(next === 'ended');
    }
  });
});

describe('a terminal state and its reason have to agree', () => {
  it('gives every terminal state at least one reason and every live state none', () => {
    for (const state of terminalRtcSessionStates) {
      expect(endReasonsFor(state).length).toBeGreaterThan(0);
    }
    for (const state of liveRtcSessionStates) {
      expect(endReasonsFor(state)).toHaveLength(0);
    }
  });

  it('uses every declared reason for at least one terminal state', () => {
    const used = new Set(
      terminalRtcSessionStates.flatMap((state) => [...endReasonsFor(state)]),
    );
    for (const reason of rtcEndReasons) {
      expect(used.has(reason)).toBe(true);
    }
  });

  it('refuses a reason that belongs to a different ending', () => {
    expect(isEndReasonValidFor('rejected', 'declined')).toBe(true);
    expect(isEndReasonValidFor('rejected', 'provider_failed')).toBe(false);
    expect(isEndReasonValidFor('cancelled', 'withdrawn')).toBe(true);
    expect(isEndReasonValidFor('cancelled', 'hung_up')).toBe(false);
    expect(isEndReasonValidFor('expired', 'invitation_expired')).toBe(true);
    expect(isEndReasonValidFor('ended', 'invitation_expired')).toBe(false);
    expect(isEndReasonValidFor('ended', 'safety_block')).toBe(true);
    expect(isEndReasonValidFor('failed', 'provider_unavailable')).toBe(true);
    expect(isEndReasonValidFor('failed', 'hung_up')).toBe(false);
  });

  it('keeps a block and an enforcement as separate reasons', () => {
    // They are separate decisions with separate owners. Collapsing them would
    // lose which authority ended a call, and neither ever reaches a peer.
    expect(rtcEndReasons).toContain('safety_block');
    expect(rtcEndReasons).toContain('safety_enforcement');
  });
});

describe('the vocabularies stay closed and lowercase', () => {
  it('declares exactly two mediums and two roles', () => {
    expect([...rtcCallMediums]).toEqual(['voice', 'video']);
    expect([...rtcParticipantRoles]).toEqual(['caller', 'recipient']);
  });

  it('keeps every enumerated value safe to inline in a constraint', () => {
    for (const value of [
      ...rtcSessionStates,
      ...rtcEndReasons,
      ...rtcCallMediums,
      ...rtcParticipantRoles,
    ]) {
      expect(value).toMatch(/^[a-z][a-z0-9_]*$/u);
    }
  });
});

describe('the durations are bounded and stated', () => {
  it('keeps an invitation short enough to be an offer rather than an interruption', () => {
    expect(rtcInvitationTimeoutMilliseconds).toBeGreaterThan(0);
    expect(rtcInvitationTimeoutMilliseconds).toBeLessThanOrEqual(120_000);
  });

  it('bounds joining and reconnecting', () => {
    expect(rtcJoinTimeoutMilliseconds).toBeGreaterThan(0);
    expect(rtcReconnectGraceMilliseconds).toBeGreaterThan(0);
    expect(rtcReconnectGraceMilliseconds).toBeLessThanOrEqual(120_000);
  });
});

describe('what this domain refuses to do', () => {
  it('implements no recording, and says so in a value a test can read', () => {
    expect(callRecordingImplemented).toBe(false);
  });

  it('invents no retention duration', () => {
    // `undefined` rather than a number. A duration chosen here would be
    // enforced, would delete evidence a report might need, and would still not
    // be the policy.
    expect(callRetentionDuration).toBeUndefined();
  });
});
