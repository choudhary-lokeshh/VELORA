import { formatMinorUnits } from '@velora/validation';

import {
  LocalTestPaymentProvider,
  localTestSignatureHeader,
} from './local-test-provider.js';
import type { WebhookService } from './webhook-service.js';

/**
 * The local-test provider's own hosted payment page.
 *
 * A real provider collects payment on its own origin, under its own compliance
 * scope, and tells Velora what happened through a signed webhook. The
 * local-test adapter has no origin, so without this there is no page to send a
 * browser to and the whole purchase flow can only be exercised from a test
 * process. That is the same gap the local-test media transport closes, and this
 * closes it the same way: an endpoint outside `/v1`, registered only when the
 * adapter that needs it is the one configuration built.
 *
 * What it must not become is a shortcut. Nothing here writes a `billing_` row.
 * Pressing the button moves the *adapter's* record and then delivers a signed
 * event through the ordinary webhook intake, which verifies it, persists a
 * receipt, and lets the ordinary drain decide what it means. A browser
 * navigating here therefore cannot settle a payment any more than a browser
 * navigating to a real provider can — the settlement is the verified event, and
 * it goes through exactly the code a production event would.
 *
 * It collects no card details and has no field that could carry one, because
 * the thing being simulated is a redirect and a callback rather than a payment
 * form.
 */

function page(input: {
  readonly amount: string;
  readonly currency: string;
  readonly reference: string;
}): Response {
  // Unstyled, deliberately twice over. The API answers every request with
  // `default-src 'none'`, so a stylesheet — inline or otherwise — would be
  // blocked rather than applied; and dressing a development fixture up as a
  // Velora surface would make it look like a product screen in a screenshot.
  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Test payment provider</title>
</head>
<body>
<main>
<h1>Test payment provider</h1>
<p>Amount due: <strong>${input.amount} ${input.currency}</strong></p>
<form method="post">
<input type="hidden" name="reference" value="${input.reference}">
<button name="outcome" type="submit" value="pay">Pay</button>
<button name="outcome" type="submit" value="cancel">Cancel</button>
</form>
<p><small>No money moves here. This page stands in for a payment provider so
the purchase flow can be walked in a browser. It exists only where the
<code>local-test</code> adapter is configured, which no deployed environment
permits.</small></p>
</main>
</body>
</html>`;
  return new Response(body, {
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/html; charset=utf-8',
    },
    status: 200,
  });
}

function refusal(status: number): Response {
  return new Response(null, {
    headers: { 'cache-control': 'no-store' },
    status,
  });
}

export class LocalTestCheckoutTransport {
  constructor(
    private readonly dependencies: {
      readonly provider: LocalTestPaymentProvider;
      readonly webhooks: WebhookService;
    },
  ) {}

  get(request: Request): Response {
    const reference = new URL(request.url).searchParams.get('reference');
    if (reference === null) return refusal(400);
    const session = this.dependencies.provider.sessionFor(reference);
    // An unknown reference is not found rather than described. The adapter is a
    // fixture, but it should not become the one place that answers questions
    // about what identifiers exist.
    if (session === undefined) return refusal(404);
    if (session.status !== 'pending' && session.status !== 'requires_action') {
      // Already decided. A provider that had finished with a session would send
      // the consumer on rather than offer to charge them again.
      return Response.redirect(session.returnUrl, 303);
    }
    return page({
      amount: formatMinorUnits(
        session.amount.amountMinor.toString(),
        session.amount.currency,
      ),
      currency: session.amount.currency,
      reference,
    });
  }

  /**
   * The consumer decides, on the provider's page.
   *
   * The adapter's record moves first and the signed event follows, which is the
   * order a real provider works in. The event is delivered through the ordinary
   * intake and drained immediately, so by the time the browser lands back on
   * Velora the platform's answer is whatever its own verification decided.
   */
  async post(request: Request, rawBody: string): Promise<Response> {
    const form = new URLSearchParams(rawBody);
    const reference = form.get('reference');
    const outcome = form.get('outcome');
    if (reference === null || (outcome !== 'pay' && outcome !== 'cancel')) {
      return refusal(400);
    }
    const session = this.dependencies.provider.sessionFor(reference);
    if (session === undefined) return refusal(404);
    if (session.status === 'pending' || session.status === 'requires_action') {
      if (outcome === 'pay') {
        this.dependencies.provider.markSucceeded(reference);
      } else {
        this.dependencies.provider.markCancelled(reference);
      }
      const rawEvent = JSON.stringify({
        amountMinor: session.amount.amountMinor.toString(),
        currency: session.amount.currency,
        // Stable per reference and per outcome, so a resubmitted form is the
        // same event and the inbox deduplicates it rather than acting twice.
        eventId: `lt-${outcome}-${reference}`,
        eventType:
          outcome === 'pay' ? 'payment.succeeded' : 'payment.cancelled',
        providerPaymentReference: reference,
        status: outcome === 'pay' ? 'succeeded' : 'cancelled',
      });
      const headers = new Headers({
        [localTestSignatureHeader]:
          LocalTestPaymentProvider.signatureFor(rawEvent),
      });
      const received = await this.dependencies.webhooks.receive({
        correlationId: `local-test-checkout-${reference}`,
        headers,
        rawBody: rawEvent,
      });
      if (received.kind === 'accepted') {
        // Drained here rather than left to the worker, because a person is
        // waiting on the other side of the redirect. It is the same drain the
        // worker runs, so nothing is decided differently.
        await this.dependencies.webhooks.processOnce();
      }
    }
    return Response.redirect(
      outcome === 'pay' ? session.returnUrl : session.cancelUrl,
      303,
    );
  }
}
