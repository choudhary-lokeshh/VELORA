import {
  browserSecurityHeaders,
  loopbackAliasPage,
  loopbackAliasRedirect,
  resolveSurfaceConfig,
} from '@velora/config/client';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Resolved, not read raw. The origin named in `connect-src` has to be the
 * origin the pages of this same process will actually call, and reading the
 * two variables here while `src/api.ts` resolved them meant a local surface
 * advertised `connect-src 'self'` and then served a page calling the loopback
 * API, which the browser refused.
 *
 * A surface that cannot resolve an endpoint at all gets `'self'` and the
 * deployed upgrade directive: refusing is correct, and a thrown header
 * computation would turn a configuration mistake into a 500 on every route.
 */
function surfaceConfig() {
  try {
    return resolveSurfaceConfig(process.env);
  } catch {
    return undefined;
  }
}

// Applied at request time so the API origin the browser may reach comes from
// the environment rather than from whatever value happened to be set at build.
const headers = () => {
  const config = surfaceConfig();
  return browserSecurityHeaders({
    apiBaseUrl: config?.apiBaseUrl,
    appEnvironment: config?.appEnvironment,
    developmentRuntime: process.env.NODE_ENV === 'development',
    mediaDeliveryOrigin: config?.mediaDeliveryOrigin,
    referrerPolicy: 'same-origin',
  });
};

export function middleware(request: NextRequest): NextResponse {
  // A development surface opened on `localhost` cannot reach the loopback API
  // or keep its session, so it is sent to the address that can.
  const alias = loopbackAliasRedirect({
    appEnvironment: surfaceConfig()?.appEnvironment,
    developmentRuntime: process.env.NODE_ENV === 'development',
    host: request.headers.get('host'),
    pathAndQuery: `${request.nextUrl.pathname}${request.nextUrl.search}`,
  });
  // A page, not a redirect: the development server rewrites a redirect it
  // thinks points at itself into a relative one, which loops on `localhost`.
  if (alias !== undefined) {
    return new NextResponse(loopbackAliasPage(alias), {
      headers: { 'cache-control': 'no-store', 'content-type': 'text/html' },
    });
  }
  const response = NextResponse.next();
  for (const [name, value] of Object.entries(headers())) {
    response.headers.set(name, value);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
