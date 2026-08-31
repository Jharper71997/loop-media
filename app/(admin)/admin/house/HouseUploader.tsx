'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Upload } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { CREATIVE_ACCEPT, validateCreativeFile } from '@/lib/adCreative'
import type { HouseKind } from '@/lib/houseSlides'
import { setHouseCreative } from './actions'

// Upload a replacement for one of the built-in house slides. Same bucket and the
// same validation a paid ad creative goes through, so the size/type rules a screen
// can actually play are enforced in one place.
//
// The file goes to storage from the browser (under the admin's own uid folder, which
// the `creatives` RLS requires) and only the resulting URL is handed to the server
// action — the same split the advertiser upload flow uses.
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
    const err = validateCreativeFile(file)
    if (err) return toast.error(err)

    setBusy(true)
    try {
      const supabase = createClient()
      const ext = file.name.split('.').pop()?.toLowerCase() || 'bin'
      // Uid folder is required by the storage policy; the timestamp keeps a re-upload
      // from colliding with a cached copy of the previous file at the same URL.
      const path = `${userId}/house-${kind}-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('creatives')
        .upload(path, file, { contentType: file.type, upsert: true })
      if (upErr) throw new Error(upErr.message)

      const url = supabase.storage.from('creatives').getPublicUrl(path).data.publicUrl
      const creativeType = file.type.startsWith('video/') ? 'video' : 'image'

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
