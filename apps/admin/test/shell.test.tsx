import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import PlatformAdminShell from '../app/page.js';

describe('Platform Admin shell', () => {
  it('identifies its isolated privileged surface', () => {
    render(<PlatformAdminShell />);

    expect(
      screen.getByRole('heading', { name: 'Platform Admin' }),
    ).toBeDefined();
    expect(screen.queryByText('Creator Studio')).toBeNull();
  });
});
