'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { toggleTriviaQuestion } from './actions'

export function TriviaToggle({ id, active }: { id: string; active: boolean }) {
  const [pending, start] = useTransition()
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await toggleTriviaQuestion(id, !active)
          if (res.error) toast.error(res.error)
        })
      }
    >
      {active ? 'Pause' : 'Resume'}
    </Button>
  )
}
