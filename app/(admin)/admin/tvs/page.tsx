import { redirect } from 'next/navigation'

// Venues and screens now live on one page. Keep this route so old bookmarks and
// links don't 404 — the per-screen detail at /admin/tvs/[id] is unaffected.
export default function TvsPage() {
  redirect('/admin/venues')
}
