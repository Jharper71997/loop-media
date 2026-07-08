import { ResultsView } from '@/components/app/ResultsView'

// A host's advertising results — the same portfolio performance view advertisers
// get, scoped to the campaigns the host runs with their free screens. Empty-state
// CTA points at the host buy flow.
export default async function HostResultsPage() {
  return <ResultsView browseHref="/host/advertise/browse" />
}
