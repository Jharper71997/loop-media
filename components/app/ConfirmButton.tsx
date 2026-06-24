'use client'

import { useState, useTransition, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type Variant = 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link'
type Size = 'default' | 'xs' | 'sm' | 'lg' | 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg'

// A trigger button that asks for confirmation in an in-app dialog before running
// a destructive server action — the consistent replacement for window.confirm()
// across host + advertiser. The action returns the app-standard { error } shape;
// on error we toast it and keep the dialog open, on success we toast + close.
export function ConfirmButton({
  onConfirm,
  title,
  description,
  confirmText = 'Delete',
  cancelText = 'Cancel',
  confirmVariant = 'destructive',
  successToast,
  children,
  variant = 'ghost',
  size = 'sm',
  className,
  disabled,
  'aria-label': ariaLabel,
}: {
  onConfirm: () => Promise<{ error: string | null } | void>
  title: string
  description?: ReactNode
  confirmText?: string
  cancelText?: string
  confirmVariant?: Variant
  successToast?: string
  children: ReactNode
  variant?: Variant
  size?: Size
  className?: string
  disabled?: boolean
  'aria-label'?: string
}) {
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()

  function confirm() {
    start(async () => {
      const res = await onConfirm()
      if (res && res.error) {
        toast.error(res.error)
        return
      }
      if (successToast) toast.success(successToast)
      setOpen(false)
    })
  }

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => setOpen(true)}
      >
        {children}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" disabled={pending} onClick={() => setOpen(false)}>
              {cancelText}
            </Button>
            <Button variant={confirmVariant} size="sm" disabled={pending} onClick={confirm}>
              {pending ? 'Working…' : confirmText}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
