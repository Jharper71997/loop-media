'use client'

import * as React from 'react'
import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox'
import { Check, ChevronsUpDown } from 'lucide-react'

import { cn } from '@/lib/utils'

export type ComboboxOption = { value: string; label: string }

// Searchable single-select. Pass options (auto-filtered as you type) + a
// controlled value/onValueChange. Mirrors the Select API so it's a drop-in for
// long lists where scrolling is painful (e.g. the 47 venue categories).
export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'No matches.',
  className,
}: {
  options: ComboboxOption[]
  value: string | null
  onValueChange: (value: string | null) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  className?: string
}) {
  const selected = options.find((o) => o.value === value) ?? null

  return (
    <ComboboxPrimitive.Root
      items={options}
      value={selected}
      onValueChange={(v) => onValueChange((v as ComboboxOption | null)?.value ?? null)}
    >
      <ComboboxPrimitive.Trigger
        className={cn(
          'flex h-11 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
          className
        )}
      >
        <ComboboxPrimitive.Value placeholder={placeholder} />
        <ComboboxPrimitive.Icon className="shrink-0">
          <ChevronsUpDown className="size-4 opacity-50" />
        </ComboboxPrimitive.Icon>
      </ComboboxPrimitive.Trigger>

      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner sideOffset={4} className="z-50 w-[var(--anchor-width)]">
          <ComboboxPrimitive.Popup className="max-h-72 w-full overflow-hidden rounded-xl bg-popover text-popover-foreground ring-1 ring-foreground/10 shadow-md outline-none">
            <div className="border-b p-1">
              <ComboboxPrimitive.Input
                placeholder={searchPlaceholder}
                className="h-9 w-full rounded-md bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <ComboboxPrimitive.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
              {emptyText}
            </ComboboxPrimitive.Empty>
            <ComboboxPrimitive.List className="max-h-56 overflow-y-auto p-1">
              {(option: ComboboxOption) => (
                <ComboboxPrimitive.Item
                  key={option.value}
                  value={option}
                  className="flex cursor-default items-center justify-between gap-2 rounded-md px-2 py-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                >
                  <span className="truncate">{option.label}</span>
                  <ComboboxPrimitive.ItemIndicator>
                    <Check className="size-4 text-primary" />
                  </ComboboxPrimitive.ItemIndicator>
                </ComboboxPrimitive.Item>
              )}
            </ComboboxPrimitive.List>
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  )
}
