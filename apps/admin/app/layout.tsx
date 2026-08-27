import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import type { ReactNode } from 'react';

import './globals.css';
import { resolveApiBaseUrl, resolveAppEnvironment } from '../src/api';
import { AdminProviders, ToastProvider } from '../src/app/providers';
import { Toaster } from '../src/app/shell';

/**
 * The document, and the three things only it can supply.
 *
 * The API endpoint is resolved on the server at request time and handed down as
 * a prop, because a `NEXT_PUBLIC_` value would be inlined at build and bake one
 * environment's endpoint into the artifact every environment shares.
 *
 * Two faces, both from the family the approved Master Visual Language names.
 * The monospace is not decoration: an operator carries opaque identifiers
 * between this console and other systems, and a proportional face makes an `l`
 * and a `1` the same shape at exactly the moment that matters. Source Serif 4
 * is deliberately absent — the approved foundation assigns it to Creator
 * editorial moments, and an audit trail is not one.
 *
 * `robots` is closed and the referrer policy is `no-referrer`, both stricter
 * than the other surfaces. There is nothing here to index and no address on
 * this origin that should travel anywhere as a referrer.
 */

const interfaceFont = IBM_Plex_Sans({
  display: 'swap',
  fallback: ['Noto Sans', 'system-ui', 'sans-serif'],
  subsets: ['latin', 'latin-ext'],
  variable: '--font-plex-sans',
  weight: ['400', '500', '600'],
});

const monoFont = IBM_Plex_Mono({
  display: 'swap',
  fallback: ['ui-monospace', 'monospace'],
  subsets: ['latin'],
  variable: '--font-plex-mono',
  weight: ['400', '500'],
});

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  description: 'VELORA Platform Admin, the privileged operations console.',
  robots: { follow: false, index: false },
  title: {
    default: 'Platform Admin · VELORA',
    template: '%s · Platform Admin',
  },
};

export const viewport: Viewport = {
  colorScheme: 'light',
  initialScale: 1,
  themeColor: '#f6f7f9',
  viewportFit: 'cover',
  width: 'device-width',
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html
      className={`${interfaceFont.variable} ${monoFont.variable}`}
      lang="en"
    >
      <body>
        <ToastProvider>
          <AdminProviders
            apiBaseUrl={resolveApiBaseUrl()}
            appEnvironment={resolveAppEnvironment()}
          >
            {children}
            <Toaster />
          </AdminProviders>
        </ToastProvider>
      </body>
    </html>
  );
}
