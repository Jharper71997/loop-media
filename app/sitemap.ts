import type { MetadataRoute } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { absoluteUrl } from '@/lib/site'

// Replaces the hand-maintained public/sitemap.xml, whose lastmod dates went
// stale the moment anyone shipped without remembering to edit it (the home page
// still claimed 2026-07-08 after a deploy that rewrote it).
//
// Rebuilt on request rather than cached: /playing and /directory change whenever
// an ad or a venue goes live, and a sitemap is cheap to generate.
export const revalidate = 3600

// Public routes worth a search result, and how often each actually changes.
// `changeFrequency` and `priority` are hints Google mostly ignores; `lastModified`
// is the field it reads, so the value has to be honest or it teaches the crawler
// to distrust the file.
const STATIC_ROUTES: {
  path: string
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency']
  priority: number
}[] = [
  { path: '/', changeFrequency: 'daily', priority: 1 },
  { path: '/directory', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/playing', changeFrequency: 'daily', priority: 0.9 },
  { path: '/preview', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/signup', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/signup/host', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/demo/advertiser', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/demo/host', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/changelog', changeFrequency: 'weekly', priority: 0.5 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.3 },
]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()

  // The freshest active venue stands in for "when did the network last change",
  // which is what actually dates the home page and the directory.
  let venuesChangedAt = now
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('venues')
      .select('updated_at')
      .eq('status', 'active')
      .eq('is_demo', false)
      .order('updated_at', { ascending: false })
      .limit(1)
    const latest = data?.[0]?.updated_at
    if (latest) venuesChangedAt = new Date(latest)
  } catch {
    // A sitemap that still lists every URL beats a 500. Falling back to `now` is
    // the honest answer when we can't read the real date.
  }

  return STATIC_ROUTES.map(({ path, changeFrequency, priority }) => ({
    url: absoluteUrl(path),
    lastModified: path === '/' || path === '/directory' ? venuesChangedAt : now,
    changeFrequency,
    priority,
  }))
}
