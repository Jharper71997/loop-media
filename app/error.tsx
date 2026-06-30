'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'

// Branded recovery surface for any unhandled render/data error in the app tree.
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="space-y-2">
        <p className="font-heading text-5xl font-bold text-gold-metallic">Hmm.</p>
        <h1 className="font-heading text-xl font-semibold">Something went sideways</h1>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          That page hit a snag on our end. Try again, or head back to the start.
        </p>
      </div>
      <div className="flex items-center gap-4">
        <Button size="lg" onClick={reset}>
          Try again
        </Button>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          Go home
        </Link>
      </div>
    </div>
  )
}
