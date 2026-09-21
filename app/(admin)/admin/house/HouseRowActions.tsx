'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pause, Play, RefreshCw, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DeleteButton } from '@/components/admin/DeleteButton'
import { CREATIVE_ACCEPT } from '@/lib/adCreative'
import {
  clearHouseCreative,
  toggleHouseCreative,
  renameHouseCreative,
  replaceHouseCreativeFile,
  type HouseKind,
} from './actions'
import { uploadHouseCreative } from './upload'

// Everything you can do to ONE uploaded house creative: name it, swap its artwork,
// put it on the screens or pause it, or delete it outright.
//
// Only the delete confirms. Every other action here is reversible within a minute
// (screens re-poll on ~30s), and removing an upload restores the built-in designed
// slide rather than leaving a gap — but delete also takes the file out of storage,
// which re-uploading is the only way back from, so that one asks.
export function HouseRowActions({
  id,
  active,
  label,
  kind,
  userId,
}: {
  id: string
  active: boolean
  label: string | null
  kind: HouseKind
  userId: string
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, start] = useTransition()
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState(label ?? '')

  const run = (fn: () => Promise<{ error: string | null }>, ok: string) =>
    start(async () => {
      const res = await fn()
      if (res.error) toast.error(res.error)
      else {
        toast.success(ok)
        router.refresh()
      }
    })

  async function replaceFile(file: File) {
    setBusy(true)
    try {
      const { url, creativeType } = await uploadHouseCreative(file, userId, kind)
      run(
        () => replaceHouseCreativeFile({ id, creativeType, creativeUrl: url }),
        active ? 'Swapped — on the screens within a minute.' : 'Artwork swapped.'
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const nameDirty = name.trim() !== (label ?? '')

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Input
        aria-label="Name this upload"
        placeholder="Name it"
        className="h-8 w-40"
        maxLength={80}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && nameDirty) run(() => renameHouseCreative(id, name), 'Renamed.')
        }}
      />
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Save name"
        disabled={pending || !nameDirty}
        onClick={() => run(() => renameHouseCreative(id, name), 'Renamed.')}
      >
        <Save className="size-4" />
      </Button>

      <input
        ref={inputRef}
        type="file"
        accept={CREATIVE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) replaceFile(f)
        }}
      />
      <Button
        size="sm"
        variant="ghost"
        disabled={pending || busy}
        aria-label="Replace this artwork"
        onClick={() => inputRef.current?.click()}
      >
        <RefreshCw className="size-4" />
        <span className="ml-2">{busy ? 'Uploading…' : 'Replace file'}</span>
      </Button>

      <Button
        size="sm"
        variant="ghost"
        disabled={pending || busy}
        onClick={() =>
          run(
            () => toggleHouseCreative(id, !active),
            active ? 'Paused — the built-in slide is back.' : 'Live on the screens.'
          )
        }
      >
        {active ? <Pause className="size-4" /> : <Play className="size-4" />}
        <span className="ml-2">{active ? 'Pause' : 'Use this'}</span>
      </Button>

      <DeleteButton
        id={id}
        action={clearHouseCreative}
        confirmText="Delete this upload and its file for good? The built-in slide comes back. You'd have to re-upload the artwork to undo this."
      />
    </div>
  )
}
