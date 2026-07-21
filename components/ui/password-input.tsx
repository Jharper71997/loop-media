'use client'

import * as React from 'react'
import { Eye, EyeOff } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

// Password field with a show/hide toggle. Drop-in for <Input type="password" />:
// takes the same props, and adds an eye button that flips the field between
// masked and plain text. The button is kept out of the tab order so tabbing
// still goes straight from the field to the submit button.
function PasswordInput({ className, ...props }: React.ComponentProps<typeof Input>) {
  const [show, setShow] = React.useState(false)
  return (
    <div className="relative">
      <Input {...props} type={show ? 'text' : 'password'} className={cn('pr-9', className)} />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Hide password' : 'Show password'}
        aria-pressed={show}
        className="absolute inset-y-0 right-0 grid w-9 place-items-center text-muted-foreground transition-colors hover:text-foreground"
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}

export { PasswordInput }
