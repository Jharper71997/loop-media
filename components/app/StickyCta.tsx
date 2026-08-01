'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Fixed bottom action bar for the guided flow. Owns the bottom of the screen
// (the tab bar is hidden in-flow). Optional left-side price summary.
//
// `note` is a full-width line above the row. It exists because the volume-
// discount nudge used to sit above the venue list and scrolled out of sight
// immediately — anything we actually want an advertiser to act on has to live
// in the bar that never moves.
export function StickyCta({
  label,
  onClick,
  href,
  disabled,
  priceTop,
  priceMain,
  note,
}: {
  label: string
  onClick?: () => void
  href?: string
  disabled?: boolean
  priceTop?: string
  priceMain?: string
  note?: ReactNode
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
      {note && (
        <div className="mx-auto w-full max-w-md px-4 pt-2">
          <p className="rounded-md bg-primary/15 px-3 py-1.5 text-center text-xs font-semibold text-primary">
            {note}
          </p>
        </div>
      )}
      <div className="mx-auto flex w-full max-w-md items-center gap-3 px-4 py-3">
        {priceMain && (
          <div className="leading-tight">
            {priceTop && <div className="text-[11px] text-muted-foreground">{priceTop}</div>}
            <div className="font-heading text-lg font-bold tabular-nums">{priceMain}</div>
          </div>
        )}
        {href && !disabled ? (
          <Link href={href} className={cn(buttonVariants({ size: 'lg' }), 'h-12 flex-1 text-base')}>
            {label}
          </Link>
        ) : (
          <Button
            type="button"
            size="lg"
            disabled={disabled}
            onClick={onClick}
            className="h-12 flex-1 text-base"
          >
            {label}
          </Button>
        )}
      </div>
    </div>
  )
}
