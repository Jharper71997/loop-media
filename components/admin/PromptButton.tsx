'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

type ButtonProps = React.ComponentProps<typeof Button>

// A trigger button that opens a prompt dialog with a single text input before
// running an async action. Replaces the native browser prompt: Cancel does
// nothing, Submit passes the typed string (empty allowed) to `onSubmit`. Pass
// the usual Button props straight through to the trigger.
export function PromptButton({
  message,
  label,
  placeholder,
  submitLabel = 'Submit',
  cancelLabel = 'Cancel',
  submitVariant = 'default',
  onSubmit,
  children,
  ...buttonProps
}: Omit<ButtonProps, 'onSubmit'> & {
  message: string
  label?: string
  placeholder?: string
  submitLabel?: string
  cancelLabel?: string
  submitVariant?: ButtonProps['variant']
  onSubmit: (value: string) => void | Promise<void>
}) {
  const [open, setOpen] = React.useState(false)
  const [value, setValue] = React.useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const v = value
    setOpen(false)
    setValue('')
    void onSubmit(v)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setValue('')
      }}
    >
      <DialogTrigger render={<Button {...buttonProps} />}>{children}</DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{message}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            {label && <Label className="text-xs text-muted-foreground">{label}</Label>}
            <Input
              autoFocus
              value={value}
              placeholder={placeholder}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              {cancelLabel}
            </DialogClose>
            <Button type="submit" variant={submitVariant}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
