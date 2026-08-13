import { render, screen } from '@testing-library/react-native';

import ConsumerMobileShell from '../app/index';

describe('Consumer Mobile shell', () => {
  it('identifies its isolated surface', async () => {
    await render(<ConsumerMobileShell />);

    expect(screen.getByText('Consumer Mobile')).toBeTruthy();
    expect(screen.queryByText('Platform Admin')).toBeNull();
  });
});
