import { redirect } from 'next/navigation'

// Packages now live alongside tier pricing on one page. Keep this route so old
// links/bookmarks land in the right place instead of 404ing.
export default function PackagesPage() {
  redirect('/admin/pricing')
}
