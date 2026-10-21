import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ivoryPreviewEnabled } from '../src/design/visual-preview';
import { VisualPreviewProvider } from '../src/design/visual-preview-provider';
import { Discovery } from '../src/product/discovery';
import { Live } from '../src/product/live';
import {
  admittedState,
  createApiDouble,
  otherPersonId,
} from './support/api-double';
import { renderProduct } from './support/render';

afterEach(cleanup);

describe('Ivory localhost visual preview', () => {
  it('requests only the visible portrait and keeps identity when image decoding fails', async () => {
    const state = admittedState();
    const first = state.candidates[0];
    if (first === undefined) throw new Error('Fixture needs a candidate');
    const firstAsset = 'aaaabbbb-1111-4111-8111-111111111111';
    const secondAsset = 'aaaabbbb-2222-4222-8222-222222222222';
    state.candidates = [
      { ...first, media: [{ id: firstAsset, position: 0 }] },
      {
        ...first,
        id: 'aaaabbbb-3333-4333-8333-333333333333',
        displayName: 'Other person',
        media: [{ id: secondAsset, position: 0 }],
      },
    ];
    const double = createApiDouble(state);
    renderProduct(
      <VisualPreviewProvider enabled>
        <Discovery />
      </VisualPreviewProvider>,
      double,
      { pathname: '/discover' },
    );
    const photo = await screen.findByTestId(`candidate-portrait-${first.id}`);
    const deliveries = double.calls.filter(
      (call) => call.path === '/v1/media/deliveries',
    );
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.body).toMatchObject({ assetIds: [firstAsset] });
    fireEvent.error(photo);
    expect(screen.queryByTestId(`candidate-portrait-${first.id}`)).toBeNull();
    expect(
      screen.getByRole('link', { name: `Open ${first.displayName}` }),
    ).toBeTruthy();
    fireEvent.click(screen.getByTestId(`discovery-pass-${first.id}`));
    await screen.findByText('Other person');
    await waitFor(() => {
      expect(
        double.calls
          .filter((call) => call.path === '/v1/media/deliveries')
          .at(-1)?.body,
      ).toMatchObject({ assetIds: [secondAsset] });
    });
  });
  it('keeps free Live entry available while optional prices are folded away', async () => {
    const state = admittedState();
    state.wallet.enabled = true;
    const double = createApiDouble(state);
    renderProduct(
      <VisualPreviewProvider enabled>
        <Live />
      </VisualPreviewProvider>,
      double,
      { pathname: '/live' },
    );
    const panel = await screen.findByTestId<HTMLDetailsElement>('live-premium');
    expect(panel.tagName).toBe('DETAILS');
    expect(panel.open).toBe(false);
    expect(
      screen.getByTestId<HTMLButtonElement>('live-start-video').disabled,
    ).toBe(false);
    const summary = panel.querySelector('summary');
    if (summary === null)
      throw new Error('Optional preferences need an accessible summary');
    fireEvent.click(summary);
    expect(panel.open).toBe(true);
    expect(panel.textContent).toContain('Women — 25 coins');
    expect(panel.textContent).toContain('returned in full');
  });
  it('refuses deployed and invalid environments, even on a development runtime', () => {
    for (const appEnvironment of ['staging', 'production', 'invalid']) {
      expect(
        ivoryPreviewEnabled({
          NODE_ENV: 'development',
          VELORA_APP_ENV: appEnvironment,
          VELORA_API_BASE_URL: 'https://api.example.com',
        }),
      ).toBe(false);
    }
    expect(ivoryPreviewEnabled({ NODE_ENV: 'production' })).toBe(false);
    // The resolver would infer `local` here; a missing value keeps the baseline.
    expect(ivoryPreviewEnabled({})).toBe(false);
    expect(ivoryPreviewEnabled({ NODE_ENV: 'development' })).toBe(false);
    // The browser suite runs a production build declared local; it proves the
    // deployed baseline, so the review stays on the development server.
    expect(
      ivoryPreviewEnabled({ NODE_ENV: 'production', VELORA_APP_ENV: 'local' }),
    ).toBe(false);
    expect(ivoryPreviewEnabled({ VELORA_APP_ENV: 'local' })).toBe(true);
    expect(ivoryPreviewEnabled({ VELORA_APP_ENV: 'test' })).toBe(true);
  });

  it('shows server order one person at a time and advances only after an accepted decision', async () => {
    const state = admittedState();
    const first = state.candidates[0];
    if (first === undefined) throw new Error('Fixture needs a candidate');
    const secondId = '12ce271c-2efb-44f2-a602-c98805474ce4';
    state.candidates = [
      first,
      { ...first, id: secondId, displayName: 'Second person' },
    ];
    const double = createApiDouble(state);
    const pagedDouble = {
      ...double,
      fetch: async (...args: Parameters<typeof globalThis.fetch>) => {
        const response = await double.fetch(...args);
        const input = args[0];
        const url = input instanceof Request ? input.url : input.toString();
        if (!url.includes('/v1/discovery/candidates') || !response.ok)
          return response;
        const body = (await response.json()) as Record<string, unknown>;
        return Response.json({ ...body, nextCursor: 'more-candidates' });
      },
    };
    renderProduct(
      <VisualPreviewProvider enabled>
        <Discovery />
      </VisualPreviewProvider>,
      pagedDouble,
      { pathname: '/discover' },
    );
    await screen.findByTestId(`candidate-${otherPersonId}`);
    expect(screen.queryByTestId(`candidate-${secondId}`)).toBeNull();
    expect(screen.getByRole('button', { name: 'Interested' })).toBeTruthy();
    expect(screen.queryByTestId('discovery-more')).toBeNull();

    double.refuseNext(
      '/v1/discovery/passes',
      'POST',
      409,
      'ACCOUNT_NOT_ELIGIBLE',
    );
    fireEvent.click(screen.getByTestId(`discovery-pass-${otherPersonId}`));
    await screen.findByText(
      'Your account cannot do that in its current state.',
    );
    expect(screen.getByTestId(`candidate-${otherPersonId}`)).toBeTruthy();
    expect(screen.queryByTestId(`candidate-${secondId}`)).toBeNull();
    await waitFor(() => {
      expect(
        screen.getByTestId<HTMLButtonElement>(`discovery-pass-${otherPersonId}`)
          .disabled,
      ).toBe(false);
    });
    fireEvent.click(screen.getByTestId(`discovery-pass-${otherPersonId}`));
    await screen.findByTestId(`candidate-${secondId}`);
    expect(screen.queryByTestId(`candidate-${otherPersonId}`)).toBeNull();
  });

  it('holds the current person while a decision is pending and sends only once', async () => {
    const state = admittedState();
    const first = state.candidates[0];
    if (first === undefined) throw new Error('Fixture needs a candidate');
    const secondId = '12ce271c-2efb-44f2-a602-c98805474ce4';
    state.candidates = [
      first,
      { ...first, id: secondId, displayName: 'Second person' },
    ];
    const double = createApiDouble(state);
    let release: () => void = () => {
      throw new Error('Gate has not initialized');
    };
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let attempts = 0;
    const delayed = {
      ...double,
      fetch: async (...args: Parameters<typeof globalThis.fetch>) => {
        const input = args[0];
        const url = input instanceof Request ? input.url : input.toString();
        const method =
          args[1]?.method ?? (input instanceof Request ? input.method : 'GET');
        if (url.includes('/v1/discovery/passes') && method === 'POST') {
          attempts += 1;
          await gate;
        }
        return double.fetch(...args);
      },
    };
    renderProduct(
      <VisualPreviewProvider enabled>
        <Discovery />
      </VisualPreviewProvider>,
      delayed,
      { pathname: '/discover' },
    );
    const pass = await screen.findByTestId<HTMLButtonElement>(
      `discovery-pass-${otherPersonId}`,
    );
    fireEvent.click(pass);
    fireEvent.click(pass);
    expect(pass.disabled).toBe(true);
    expect(screen.getByTestId(`candidate-${otherPersonId}`)).toBeTruthy();
    expect(screen.queryByTestId(`candidate-${secondId}`)).toBeNull();
    await waitFor(() => {
      expect(attempts).toBe(1);
    });
    release();
    await screen.findByTestId(`candidate-${secondId}`);
  });

  it('keeps unavailable photographs as identity marks and makes safety reachable', async () => {
    const state = admittedState();
    state.mediaDelivery = 'unavailable';
    const double = createApiDouble(state);
    renderProduct(
      <VisualPreviewProvider enabled>
        <Discovery />
      </VisualPreviewProvider>,
      double,
      { pathname: '/discover' },
    );
    await screen.findByTestId(`candidate-${otherPersonId}`);
    expect(
      screen.queryByTestId(`candidate-portrait-${otherPersonId}`),
    ).toBeNull();
    fireEvent.click(screen.getByTestId(`safety-menu-${otherPersonId}`));
    await screen.findByTestId('safety-open-report');
    expect(screen.getByTestId('safety-open-block')).toBeTruthy();
  });
});
