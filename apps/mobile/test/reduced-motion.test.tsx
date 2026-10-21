import {
  act,
  cleanup,
  renderHook,
  waitFor,
} from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { useReducedMotion } from '../src/design/reduced-motion';

const motionInfo: {
  isReduceMotionEnabled(): Promise<boolean>;
  addEventListener(
    event: 'reduceMotionChanged',
    listener: (value: boolean) => void,
  ): { remove(): void };
} = AccessibilityInfo;

afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
});

test('stays still until the system answers and observes later changes', async () => {
  let answer: (value: boolean) => void = () => {
    throw new Error('Read not started');
  };
  let notify: (value: boolean) => void = () => {
    throw new Error('Listener not installed');
  };
  const remove = jest.fn();
  jest.spyOn(motionInfo, 'isReduceMotionEnabled').mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        answer = resolve;
      }),
  );
  jest
    .spyOn(motionInfo, 'addEventListener')
    .mockImplementation((_event, listener) => {
      notify = listener;
      return { remove };
    });
  const view = await renderHook(() => useReducedMotion());
  expect(view.result.current).toBe(true);
  await act(async () => {
    answer(false);
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(view.result.current).toBe(false);
  });
  await act(() => {
    notify(true);
    return Promise.resolve();
  });
  expect(view.result.current).toBe(true);
  await view.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});

test('a current system change outranks a stale initial answer', async () => {
  let answer: (value: boolean) => void = () => {
    throw new Error('Read not started');
  };
  let notify: (value: boolean) => void = () => {
    throw new Error('Listener not installed');
  };
  jest.spyOn(motionInfo, 'isReduceMotionEnabled').mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        answer = resolve;
      }),
  );
  jest
    .spyOn(motionInfo, 'addEventListener')
    .mockImplementation((_event, listener) => {
      notify = listener;
      return { remove: jest.fn() };
    });
  const view = await renderHook(() => useReducedMotion());
  await act(async () => {
    notify(true);
    answer(false);
    await Promise.resolve();
  });
  expect(view.result.current).toBe(true);
});

test('an unavailable system setting keeps the still alternative', async () => {
  jest
    .spyOn(motionInfo, 'isReduceMotionEnabled')
    .mockRejectedValue(new Error('Unavailable'));
  const view = await renderHook(() => useReducedMotion());
  expect(view.result.current).toBe(true);
});
