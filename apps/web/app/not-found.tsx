import Link from 'next/link';

/**
 * An address that is not part of the product.
 *
 * Deliberately says nothing about why. A page that distinguished "no such route"
 * from "not yours" would be a way to find out that something exists.
 */
export default function NotFound() {
  return (
    <div className="v-focus-page">
      <main className="v-focus-page__panel" id="main">
        <p className="v-wordmark">VELORA</p>
        <h1 className="v-title">There is nothing at this address</h1>
        <p className="v-muted">
          The link may be old, or it may never have pointed anywhere.
        </p>
        <div>
          <Link className="v-btn v-btn--primary" href="/">
            Go to VELORA
          </Link>
        </div>
      </main>
    </div>
  );
}
