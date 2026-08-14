import { render, screen, waitFor } from '@testing-library/react-native';

import ConsumerMobileScreen from '../app/index';

/**
 * The screen mounts with no props at all, exactly as the router renders it.
 * A build with no configured endpoint must say so rather than crash on import,
 * which is what this proves: the module loads, the surface renders, and the
 * refusal is visible.
 */
describe('Consumer Mobile screen', () => {
  it('renders without a configured endpoint and says so', async () => {
    await render(<ConsumerMobileScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('endpoint-unavailable')).toBeTruthy();
    });
    expect(screen.queryByText('Platform Admin')).toBeNull();
  });
});
