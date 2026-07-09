import { Sparkles } from 'lucide-react'
import { exitDemo } from '@/app/demo/actions'

// Shown across the host/advertiser apps when the signed-in account is a throwaway
// demo account. Makes it unmistakable this is a walkthrough, with a one-click way
// out (ends the demo session and returns to login).
export function DemoBanner() {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-primary/30 bg-primary/10 px-4 py-2 text-xs text-primary">
      <span className="flex items-center gap-1.5">
        <Sparkles className="size-3.5" />
        Live demo — nothing here is real and no card is ever charged.
      </span>
      <form action={exitDemo}>
        <button type="submit" className="font-medium hover:underline">
          Exit demo
        </button>
      </form>
    </div>
  )
}
