import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

// The one back-link affordance for out-of-flow pages (arrow + label). Replaces
// the several ad-hoc inline variants so "back" looks the same everywhere. The
// guided buy flow keeps StepHeader's circular back button — that's a distinct,
// deliberate affordance.
export function BackLink({
  href,
  label = 'Back',
  className,
}: {
  href: string
  label?: string
  className?: string
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground',
        className
      )}
    >
      <ArrowLeft className="size-4" /> {label}
    </Link>
  )
}
