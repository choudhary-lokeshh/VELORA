import { act, renderHook } from '@testing-library/react-native';

import { useSingleFlight } from '../src/product/resource';

/**
 * The guard every action on this surface goes through.
 *
 * It is asserted here rather than by firing two synthetic presses at a control.
 * A phone produces the double tap this defends against, but the test renderer
 * does not: two events dispatched before the first has settled leave React's
 * act bookkeeping unbalanced and poison every later mount in the file. The
 * property is the same either way — two calls in one frame produce one piece of
 * work — and this asserts it where it actually lives.
 *
 * Why it matters is not tidiness. Two presses of "Sign in" are two sessions and
 * two sets of credential material this device never asked for; two presses of
 * "Interested" are two writes the server has to make idempotent; two sends are
 * two messages unless every one carries the same client identifier.
 */
describe('one action at a time', () => {
  it('runs one piece of work when two calls land in the same frame', async () => {
    const { result } = await renderHook(() => useSingleFlight());
    let started = 0;
    let release: (() => void) | undefined;
    const work = async () => {
      started += 1;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    };

    // A guard held in component state is not a guard: both calls would read it
    // as it was before either committed. The one inside the hook is a ref,
    // written synchronously, so the second call sees the first.
    await act(() => {
      result.current.run(work);
      result.current.run(work);
      return Promise.resolve();
    });

    expect(started).toBe(1);
    expect(result.current.busy).toBe(true);

    await act(() => {
      release?.();
      return Promise.resolve();
    });

    expect(result.current.busy).toBe(false);
  });

  it('lets the next action run once the first has finished', async () => {
    const { result } = await renderHook(() => useSingleFlight());
    let started = 0;
    const work = () => {
      started += 1;
      return Promise.resolve();
    };

    await act(() => {
      result.current.run(work);
      return Promise.resolve();
    });
    await act(() => {
      result.current.run(work);
      return Promise.resolve();
    });

    expect(started).toBe(2);
  });
});
