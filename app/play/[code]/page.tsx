import { PlayClient } from './PlayClient'

// Public phone page for the on-screen trivia game. No login: the TV shows a QR
// to /play/<venue code>; players enter a name and answer along on their phone.
export default async function PlayPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return <PlayClient code={code.toUpperCase()} />
}
