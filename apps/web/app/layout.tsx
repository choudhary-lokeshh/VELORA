import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans } from 'next/font/google';
import type { ReactNode } from 'react';

import './globals.css';
import { resolveApiBaseUrl } from '../src/api';
import { ToastProvider, VeloraProviders } from '../src/app/providers';
import { Toaster } from '../src/app/shell';
import { AcquisitionCapture } from '../src/product/acquisition-capture';
import { resolvePublicSite } from '../src/seo/site';

/**
 * The document, and the three things only it can supply.
 *
 * The API endpoint is resolved on the server at request time and handed down as
 * a prop, because a `NEXT_PUBLIC_` value would be inlined at build and bake one
 * environment's endpoint into the artifact every environment shares.
 *
 * The interface typeface is the one the approved Master Visual Language names.
 * It is downloaded at build time and served from this origin, so no request
 * leaves the browser for a font and no third party learns who is reading.
 *
 * `viewport-fit=cover` is what makes the safe-area insets the shell uses have
 * values at all on a phone with a rounded display.
 */

const interfaceFont = IBM_Plex_Sans({
  display: 'swap',
  fallback: ['Noto Sans', 'system-ui', 'sans-serif'],
  subsets: ['latin', 'latin-ext'],
  variable: '--font-plex-sans',
  weight: ['400', '500', '600', '700'],
});

export const dynamic = 'force-dynamic';

/**
 * The document-level defaults every page inherits.
 *
 * A function rather than a constant because one of these depends on the
 * environment, and for the same reason the API endpoint does: `metadataBase` is
 * the origin every relative address in a page's metadata is resolved against,
 * and a value fixed at build would resolve a production page's canonical
 * against a build machine. An environment with no declared public origin gets
 * none, which is honest — it has no absolute address to offer — and every page
 * there writes its own addresses as paths.
 *
 * The title template is the reason no page has to remember to say VELORA. A
 * page supplies what it is; the suffix is added here, once, so no page can
 * publish `VELORA · VELORA` and none can forget the suffix entirely.
 */
export function generateMetadata(): Metadata {
  const site = resolvePublicSite();
  return {
    description:
      'VELORA is an adults-only social platform for meeting new people through live conversations.',
    ...(site.origin === undefined
      ? {}
      : { metadataBase: new URL(site.origin) }),
    title: {
      default: 'VELORA',
      template: '%s · VELORA',
    },
  };
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#0c0a0c',
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html className={interfaceFont.variable} lang="en">
      <body>
        <ToastProvider>
          <VeloraProviders apiBaseUrl={resolveApiBaseUrl()}>
            {children}
            <Toaster />
            {/* Draws nothing. It notes where somebody arrived from, once, so a
                shared link is still attributable when they sign up later. */}
            <AcquisitionCapture />
          </VeloraProviders>
        </ToastProvider>
      </body>
    </html>
  );
}
