'use client'

import { PlayCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useHostTour } from './HostTour'

// Lets a host replay the first-run walkthrough from their Account tab. Lives under
// the host layout, so it shares the HostTourProvider mounted there.
export function ReplayHostTourButton() {
  const { start } = useHostTour()
  return (
    <Button variant="outline" size="lg" className="w-full" onClick={start}>
      <PlayCircle className="size-4" /> Replay the walkthrough
    </Button>
  )
}
