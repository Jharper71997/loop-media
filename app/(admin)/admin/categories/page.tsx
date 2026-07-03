import { redirect } from 'next/navigation'

// Categories & caps now live as a section on the pricing page (a single
// "Pricing, packages & categories" tab). Kept as a redirect so old links land.
export default function CategoriesPage() {
  redirect('/admin/pricing')
}
