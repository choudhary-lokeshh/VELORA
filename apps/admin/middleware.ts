import { browserSecurityHeaders } from '@velora/config/client';
import { NextResponse } from 'next/server';

// Applied at request time so the API origin the browser may reach comes from
// the environment rather than from whatever value happened to be set at build.
const headers = () =>
  browserSecurityHeaders({
    apiBaseUrl: process.env.VELORA_API_BASE_URL,
    appEnvironment: process.env.VELORA_APP_ENV,
    referrerPolicy: 'no-referrer',
    robots: 'noindex, nofollow, noarchive',
  });

export function middleware(): NextResponse {
  const response = NextResponse.next();
  for (const [name, value] of Object.entries(headers())) {
    response.headers.set(name, value);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
