import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans, Source_Serif_4 } from 'next/font/google';
import type { ReactNode } from 'react';

import './globals.css';
import { resolveApiBaseUrl } from '../src/api';
import { StudioProviders, ToastProvider } from '../src/app/providers';
import { Toaster } from '../src/app/shell';

/**
 * The document, and the three things only it can supply.
 *
 * The API endpoint is resolved on the server at request time and handed down as
 * a prop, because a `NEXT_PUBLIC_` value would be inlined at build and bake one
 * environment's endpoint into the artifact every environment shares.
 *
 * Two typefaces, both named by the approved Master Visual Language: IBM Plex
 * Sans for interface text with Noto global-script fallbacks, and Source Serif 4
 * for the Creator editorial moments the foundation reserves it for. Both are
 * downloaded at build time and served from this origin, so no request leaves the
 * browser for a font and no third party learns who is working.
 *
 * `robots` stays closed. Creator Studio is a workspace behind a door; there is
 * no public page here to index and nothing to follow out of.
 */

const interfaceFont = IBM_Plex_Sans({
  display: 'swap',
  fallback: ['Noto Sans', 'system-ui', 'sans-serif'],
  subsets: ['latin', 'latin-ext'],
  variable: '--font-plex-sans',
  weight: ['400', '500', '600', '700'],
});

const editorialFont = Source_Serif_4({
  display: 'swap',
  fallback: ['Noto Serif', 'Georgia', 'serif'],
  subsets: ['latin', 'latin-ext'],
  variable: '--font-source-serif',
  weight: ['400', '600'],
});

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  description:
    'VELORA Creator Studio is where a creator runs their public page, their catalog, and their private clubs.',
  robots: { follow: false, index: false },
  title: {
    default: 'Creator Studio · VELORA',
    template: '%s · Creator Studio',
  },
};

export const viewport: Viewport = {
  colorScheme: 'light',
  initialScale: 1,
  themeColor: '#f8f3ec',
  viewportFit: 'cover',
  width: 'device-width',
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html
      className={`${interfaceFont.variable} ${editorialFont.variable}`}
      lang="en"
    >
      <body>
        <ToastProvider>
          <StudioProviders apiBaseUrl={resolveApiBaseUrl()}>
            {children}
            <Toaster />
          </StudioProviders>
        </ToastProvider>
      </body>
    </html>
  );
}
