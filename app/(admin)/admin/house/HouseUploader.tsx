'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { CREATIVE_ACCEPT } from '@/lib/adCreative'
import { setHouseCreative, type HouseKind } from './actions'
import { uploadHouseCreative } from './upload'

// Add a NEW creative for a house slide and put it on the screens. The previous
// active one is retired (kept in the list, not deleted) by the server action. To
// change the artwork on an entry that already exists without adding another row,
// use Replace file on that row instead.
export function HouseUploader({
  kind,
  label,
  territoryId,
  userId,
}: {
  kind: HouseKind
  label: string
  territoryId: string | null
  userId: string
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, start] = useTransition()
  const [busy, setBusy] = useState(false)

  async function upload(file: File) {
    setBusy(true)
    try {
      const { url, creativeType } = await uploadHouseCreative(file, userId, kind)
      start(async () => {
        const res = await setHouseCreative({
          kind,
          territoryId,
          creativeType,
          creativeUrl: url,
        })
        if (res.error) toast.error(res.error)
        else {
          toast.success(`${label} replaced. Screens pick it up within about a minute.`)
          router.refresh()
        }
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        ref={inputRef}
        type="file"
        accept={CREATIVE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) upload(f)
        }}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={busy || pending}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="mr-2 size-4" />
        {busy || pending ? 'Uploading…' : 'Upload replacement'}
      </Button>
    </div>
  )
}
