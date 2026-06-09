'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

// Header for a step in the guided build flow: back control, "Step n of N", a
// segmented gold progress bar, and the screen title.
export function StepHeader({
  step,
  total,
  title,
  subtitle,
  backHref,
}: {
  step: number
  total: number
  title: string
  subtitle?: string
  backHref?: string
}) {
  const router = useRouter()
  return (
    <div className="space-y-3 pt-1">
      <div className="flex items-center gap-3">
        {backHref ? (
          <Link
            href={backHref}
            aria-label="Back"
            className="grid size-9 place-items-center rounded-full border border-border text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Back"
            className="grid size-9 place-items-center rounded-full border border-border text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </button>
        )}
        <span className="text-xs font-medium text-muted-foreground">
          Step {step} of {total}
        </span>
      </div>

      <div className="flex gap-1.5">
        {Array.from({ length: total }).map((_, i) => (
          <span
            key={i}
            className={cn(
              'h-1.5 flex-1 rounded-full',
              i < step ? 'bg-primary' : 'bg-muted'
            )}
          />
        ))}
      </div>

      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  )
}
