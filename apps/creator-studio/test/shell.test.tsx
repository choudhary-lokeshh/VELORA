import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import CreatorStudioShell from '../app/page.js';

describe('Creator Studio shell', () => {
  it('identifies its isolated surface', () => {
    render(<CreatorStudioShell />);

    expect(
      screen.getByRole('heading', { name: 'Creator Studio' }),
    ).toBeDefined();
    expect(screen.queryByText('Consumer Web')).toBeNull();
  });
});
