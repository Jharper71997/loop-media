'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { deleteTerritory, setTerritoryStatus } from './actions'

// Archive is the everyday action and delete is the rare one, so delete is the
// quiet icon button on the end. Delete is only offered when nothing points at the
// market; otherwise the button explains itself instead of failing on the click.
export function TerritoryRowActions({
  id,
  name,
  status,
  blockers,
}: {
  id: string
  name: string
  status: 'active' | 'inactive'
  // What is standing in the way of a delete, in words. Empty = nothing is.
  blockers: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  const run = (fn: () => Promise<{ error: string | null }>, ok: string) =>
    start(async () => {
      const res = await fn()
      if (res.error) toast.error(res.error)
      else {
        toast.success(ok)
        router.refresh()
      }
    })

  return (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          run(
            () => setTerritoryStatus(id, status === 'active' ? 'inactive' : 'active'),
            status === 'active'
              ? `${name} archived. It keeps its data and stops being offered to anyone new.`
              : `${name} is live again.`
          )
        }
      >
        {status === 'active' ? (
          <>
            <Archive className="size-4" />
            <span className="ml-2">Archive</span>
          </>
        ) : (
          <>
            <ArchiveRestore className="size-4" />
            <span className="ml-2">Restore</span>
          </>
        )}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-muted-foreground"
        disabled={pending || !!blockers}
        title={blockers ? `Still has ${blockers}. Archive it instead.` : `Delete ${name}`}
        onClick={() => {
          if (!window.confirm(`Delete ${name}? This cannot be undone.`)) return
          run(() => deleteTerritory(id), `${name} deleted.`)
        }}
      >
        <Trash2 className="size-4" />
        <span className="sr-only">Delete {name}</span>
      </Button>
    </div>
  )
}
