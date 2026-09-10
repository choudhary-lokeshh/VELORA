import { afterEach, describe, expect, it } from 'bun:test';

import { TlsRequiredSmtpSubmission } from '../../src/security/smtp-client.js';
import {
  submissionEndpoint,
  type FakeSubmissionEndpoint,
} from '../support/smtp-endpoint.js';

/**
 * Protocol proof, not delivery proof.
 *
 * What is provable in process is the part that carries the security
 * consequence: the adapter demands an encrypted transport before it will say
 * anything worth intercepting, and it stops rather than continuing in cleartext
 * when the server will not provide one. Whether a real submission endpoint
 * accepts the message is `PROVIDER CREDENTIAL REQUIRED` and is not claimed
 * here — a fake endpoint answering 250 would prove only that this test can type
 * a number.
 */

let endpoint: FakeSubmissionEndpoint | undefined;

afterEach(async () => {
  await endpoint?.stop();
  endpoint = undefined;
});

const recoveryToken = 'recovery-token-value';
const delivery = {
  message: [
    'From: no-reply@velora.test',
    'To: person@velora.test',
    'Subject: Velora account recovery',
    '',
    `Recovery code: ${recoveryToken}`,
  ].join('\r\n'),
  recipient: 'person@velora.test',
  sender: 'no-reply@velora.test',
};

function submissionAdapter(submissionUrl: string): TlsRequiredSmtpSubmission {
  return new TlsRequiredSmtpSubmission({
    submissionUrl,
    timeoutMilliseconds: 2_000,
  });
}

/**
 * The rejection, as a value.
 *
 * `expect(...).rejects` returns nothing here, so awaiting it asserts nothing
 * and lints as a mistake. Capturing the error instead makes each case say which
 * failure it expected rather than merely that one happened.
 */
async function rejectionOf(work: Promise<unknown>): Promise<Error | undefined> {
  try {
    await work;
    return undefined;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

describe('SMTP recovery delivery', () => {
  it('refuses to send when the endpoint will not upgrade the transport', async () => {
    endpoint = await submissionEndpoint({ offerStartTls: false });
    const adapter = submissionAdapter(
      `smtp://user:pass@127.0.0.1:${String(endpoint.port)}`,
    );
    expect(await rejectionOf(adapter.submit(delivery))).toBeDefined();
    // Everything worth protecting stayed unsent: no credential, no recipient,
    // no token.
    expect(endpoint.commands).toEqual(['EHLO velora.test', 'STARTTLS']);
  });

  it('never authenticates or addresses a recipient before the upgrade', async () => {
    endpoint = await submissionEndpoint({ offerStartTls: true });
    const adapter = submissionAdapter(
      `smtp://user:pass@127.0.0.1:${String(endpoint.port)}`,
    );
    // The endpoint answers 220 and then speaks no TLS, so the handshake fails.
    expect(await rejectionOf(adapter.submit(delivery))).toBeDefined();
    expect(endpoint.commands.some((line) => line.startsWith('AUTH'))).toBe(
      false,
    );
    expect(endpoint.commands.some((line) => line.startsWith('MAIL FROM'))).toBe(
      false,
    );
    expect(endpoint.commands.join('\n')).not.toContain(recoveryToken);
  });

  it('refuses a recipient carrying a header break before opening a socket', async () => {
    // Deliberately unroutable: reaching it would already be the failure.
    const adapter = submissionAdapter('smtps://127.0.0.1:1');
    const refusal = await rejectionOf(
      adapter.submit({
        ...delivery,
        recipient: 'person@velora.test>\r\nRCPT TO:<attacker@evil.example',
      }),
    );
    expect(refusal?.message).toBe('SMTP address is not a single address');
  });
});
