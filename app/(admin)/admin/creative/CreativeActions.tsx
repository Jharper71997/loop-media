'use client'

import { useState, useTransition } from 'react'
import { Play, Check, RotateCcw, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { setCreativeStatus, saveCreativeNote } from './actions'
import type { CreativeRequestStatus } from '@/lib/db.types'

export function CreativeActions({
  id,
  status,
  note,
}: {
  id: string
  status: CreativeRequestStatus
  note: string | null
}) {
  const [pending, start] = useTransition()
  const [draft, setDraft] = useState(note ?? '')

  function move(next: CreativeRequestStatus, label: string) {
    start(async () => {
      const res = await setCreativeStatus(id, next)
      if (res.error) toast.error(res.error)
      else toast.success(label)
    })
  }

  function saveNote(notify: boolean) {
    start(async () => {
      const res = await saveCreativeNote(id, draft, notify)
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(notify ? (res.emailed ? 'Note saved and emailed' : 'Note saved (email not sent)') : 'Note saved')
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {status !== 'in_progress' && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => move('in_progress', 'Marked in progress')}>
            <Play className="size-4" /> Start
          </Button>
        )}
        {status !== 'done' && (
          <Button size="sm" disabled={pending} onClick={() => move('done', 'Marked done')}>
            <Check className="size-4" /> Mark done
          </Button>
        )}
        {status === 'done' && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => move('in_progress', 'Reopened')}>
            <RotateCcw className="size-4" /> Reopen
          </Button>
        )}
      </div>

      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Note to the advertiser (optional). Emailing it lets them know you are on it or that the ad is ready."
        rows={3}
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => saveNote(false)}>
          Save note
        </Button>
        <Button size="sm" variant="outline" disabled={pending || !draft.trim()} onClick={() => saveNote(true)}>
          <Send className="size-4" /> Save and email
        </Button>
      </div>
    </div>
  )
}
