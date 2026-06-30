import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Branded 404 — replaces Next's default white not-found page.
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="space-y-2">
        <p className="font-heading text-6xl font-bold text-gold-metallic">404</p>
        <h1 className="font-heading text-xl font-semibold">We lost that one</h1>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          The page you&apos;re looking for moved or never existed.
        </p>
      </div>
      <Link href="/" className={cn(buttonVariants({ size: 'lg' }))}>
        Back to Loop Network
      </Link>
    </div>
  )
}
