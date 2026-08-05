import type { MetadataRoute } from 'next'
import { absoluteUrl } from '@/lib/site'

// Replaces the nothing that was here before: the site shipped with no robots
// directive and no machine-readable pointer to the sitemap.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Signed-in surfaces and machine endpoints. None of these are useful in
        // a search result and several are per-user, so keep them out of the
        // index rather than spending crawl budget on them.
        //
        // NOT a security control — these paths are protected by auth in
        // middleware.ts. This is purely about what belongs in search.
        disallow: [
          '/admin/',
          '/advertiser/',
          '/host/',
          '/dashboard/',
          '/api/',
          '/auth/',
          '/tv', // the player itself: a full-screen ad loop, meaningless as a result
          '/play/', // per-screen trivia join pages, keyed to a short code
          '/report/', // per-advertiser monthly reports
          '/r/', // QR redirect shortlinks
          '/login',
          '/forgot-password',
          '/update-password',
        ],
        // Deliberately NOT blocked: /signup and /signup/host. They read as auth
        // plumbing but they are the two conversion landing pages, they carry real
        // copy, and the previous sitemap listed both at high priority.
      },
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
    host: absoluteUrl('/'),
  }
}
