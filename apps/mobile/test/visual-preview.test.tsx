import { act, cleanup, fireEvent, render } from '@testing-library/react-native';

import { Portrait } from '../src/design/portrait';
import { ivoryPreview, nativePreviewEnabled } from '../src/design/theme';
import { TabBar } from '../src/frame/shell';
import { SafeAreaProvider } from 'react-native-safe-area-context';

test('compact tab labels preserve full accessible names and navigation', async () => {
  const select = jest.fn();
  const view = await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, bottom: 34, left: 0, right: 0 },
      }}
    >
      <TabBar
        current="discover"
        onSelect={select}
        signals={{ conversations: 2 }}
      />
    </SafeAreaProvider>,
  );
  await fireEvent.press(view.getByRole('tab', { name: 'Messages, 2 waiting' }));
  expect(select).toHaveBeenLastCalledWith('messages');
  await fireEvent.press(view.getByRole('tab', { name: 'Introductions' }));
  expect(select).toHaveBeenLastCalledWith('introductions');
  expect(view.getByText(ivoryPreview ? 'Chats' : 'Messages')).toBeTruthy();
  expect(
    view.getByText(ivoryPreview ? 'Intros' : 'Introductions'),
  ).toBeTruthy();
});

afterEach(cleanup);

test('a late decode error from an old address does not hide its replacement', async () => {
  const view = await render(
    <Portrait
      displayName="Test Person"
      source="https://media.test/old"
      testID="portrait"
    />,
  );
  const oldError = view.getByTestId('portrait', { includeHiddenElements: true })
    .props.onError as () => void;
  await view.rerender(
    <Portrait
      displayName="Test Person"
      source="https://media.test/new"
      testID="portrait"
    />,
  );
  await act(() => {
    oldError();
    return Promise.resolve();
  });
  expect(
    view.getByTestId('portrait', { includeHiddenElements: true }),
  ).toBeTruthy();
});

test('native preview requires an explicit local or test build', () => {
  for (const value of [undefined, '', 'invalid', 'staging', 'production']) {
    expect(nativePreviewEnabled(value)).toBe(false);
  }
  expect(nativePreviewEnabled('local')).toBe(true);
  expect(nativePreviewEnabled('test')).toBe(true);
});

test('a failed authorized portrait falls back without substituting a photograph', async () => {
  const view = await render(
    <Portrait
      displayName="Test Person"
      source="https://media.test/short-lived"
      testID="portrait"
    />,
  );
  await fireEvent(
    view.getByTestId('portrait', { includeHiddenElements: true }),
    'error',
  );
  expect(
    view.queryByTestId('portrait', { includeHiddenElements: true }),
  ).toBeNull();
  expect(view.getByText('TP', { includeHiddenElements: true })).toBeTruthy();
  await view.rerender(
    <Portrait
      displayName="Test Person"
      source="https://media.test/replacement"
      testID="portrait"
    />,
  );
  expect(
    view.getByTestId('portrait', { includeHiddenElements: true }),
  ).toBeTruthy();
});
