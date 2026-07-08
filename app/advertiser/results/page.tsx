import { ResultsView } from '@/components/app/ResultsView'

// Portfolio-wide performance across all of this advertiser's active campaigns.
// The view is shared with the host results surface — see ResultsView.
export default async function ResultsPage() {
  return <ResultsView browseHref="/advertiser/browse" />
}
