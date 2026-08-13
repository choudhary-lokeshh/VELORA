import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import ConsumerWebShell from '../app/page';

describe('Consumer Web shell', () => {
  it('identifies its isolated surface', () => {
    render(<ConsumerWebShell />);

    expect(screen.getByRole('heading', { name: 'Consumer Web' })).toBeDefined();
    expect(screen.queryByText('Platform Admin')).toBeNull();
  });
});
