import type { SmtpSubmissionPort } from '../security/smtp-client.js';
import type { RecoveryDelivery, RecoveryDeliveryPort } from './recovery.js';

/**
 * Recovery delivery over SMTP submission.
 *
 * An open standard rather than a vendor SDK, so the email-provider decision in
 * `docs/decisions/DECISIONS_REQUIRED.md` stays open: an owner can point this at
 * a hosted provider's submission endpoint or at a relay they run, and neither
 * choice is embedded in VELORA.
 *
 * This module owns the message and nothing else. The socket, the mandatory TLS
 * upgrade, and the refusal to send anything over a cleartext transport belong
 * to the approved submission adapter in `security/smtp-client.ts`, which is the
 * one place in the backend permitted to hold a socket at all.
 *
 * It is production-*capable*, not production-*approved*. A recovery message
 * still needs a destination, and no domain stores a consumer's email address
 * today; that is its own decision in `DECISIONS_REQUIRED` and this adapter does
 * not answer it.
 */

export interface SmtpRecoveryDeliveryOptions {
  /** The envelope and header sender. */
  readonly senderAddress: string;
  readonly submission: SmtpSubmissionPort;
}

export class SmtpRecoveryDelivery implements RecoveryDeliveryPort {
  readonly kind = 'smtp';

  constructor(private readonly options: SmtpRecoveryDeliveryOptions) {}

  async deliver(delivery: RecoveryDelivery): Promise<void> {
    await this.options.submission.submit({
      message: this.compose(delivery),
      recipient: delivery.destination,
      sender: this.options.senderAddress,
    });
  }

  /**
   * The message.
   *
   * Deliberately plain text with no link. Consumer Web has no recovery
   * destination to link to yet, and an address invented here would send people
   * to a page that does not exist. Dot-stuffing is applied because a body line
   * beginning with a period would otherwise end the message early.
   */
  private compose(delivery: RecoveryDelivery): string {
    const body = [
      'Somebody asked to recover a Velora account with this address.',
      '',
      `Recovery code: ${delivery.token}`,
      `Valid until: ${delivery.expiresAt.toISOString()}`,
      '',
      'If this was not you, no action is needed and the code expires on its own.',
    ]
      .map((line) => (line.startsWith('.') ? `.${line}` : line))
      .join('\r\n');

    return [
      `From: ${this.options.senderAddress}`,
      `To: ${delivery.destination}`,
      'Subject: Velora account recovery',
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Auto-Submitted: auto-generated',
      '',
      body,
    ].join('\r\n');
  }
}
