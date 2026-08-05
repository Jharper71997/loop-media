import { redirect } from 'next/navigation'

// Revenue became Money, which reports how this network actually collects —
// checks and comps included, not just this app's Stripe Checkout. The route
// stays so old bookmarks and links keep working.
export default function RevenueRedirect() {
  redirect('/admin/money')
}
