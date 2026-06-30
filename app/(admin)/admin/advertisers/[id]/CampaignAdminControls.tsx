'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X, Pause, Play, RotateCw, Ban } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { InlineNumber } from '@/components/admin/InlineNumber'
import { ConfirmButton } from '@/components/admin/ConfirmButton'
import { PromptButton } from '@/components/admin/PromptButton'
import {
  approveAd,
  rejectAd,
  pauseCampaign,
  resumeCampaign,
  cancelCampaign,
  setCampaignGoal,
  setCampaignScreenCap,
  rerunPlacement,
} from './actions'

type Props = {
  campaignId: string
  status: string
  adId: string | null
  adStatus: string | null
  goal: number
  screenCapOverride: number | null
}

export function CampaignAdminControls({
  campaignId,
  status,
  adId,
  adStatus,
  goal,
  screenCapOverride,
}: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()

  const run = (fn: () => Promise<{ error: string | null }>, okMsg: string) =>
    start(async () => {
      const res = await fn()
      if (res.error) toast.error(res.error)
      else {
        toast.success(okMsg)
        router.refresh()
      }
    })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {adId && adStatus === 'pending' && (
          <>
            <Button size="sm" disabled={pending} onClick={() => run(() => approveAd(adId), 'Ad approved')}>
              <Check className="size-4" /> Approve ad
            </Button>
            <PromptButton
              size="sm"
              variant="destructive"
              disabled={pending}
              message="Reason for rejection (shown to the advertiser):"
              label="Reason"
              placeholder="Shown to the advertiser"
              submitLabel="Reject ad"
              submitVariant="destructive"
              onSubmit={(reason) => run(() => rejectAd(adId, reason), 'Ad rejected')}
            >
              <X className="size-4" /> Reject ad
            </PromptButton>
          </>
        )}

        {status !== 'canceled' &&
          (status === 'paused' ? (
            <Button size="sm" disabled={pending} onClick={() => run(() => resumeCampaign(campaignId), 'Campaign resumed')}>
              <Play className="size-4" /> Resume
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => pauseCampaign(campaignId), 'Campaign paused')}
            >
              <Pause className="size-4" /> Pause
            </Button>
          ))}

        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await rerunPlacement(campaignId)
              if (res.error) toast.error(res.error)
              else {
                toast.success(`Placed on ${res.screens ?? 0} screen(s) (+${res.created ?? 0} new)`)
                router.refresh()
              }
            })
          }
        >
          <RotateCw className="size-4" /> Re-run placement
        </Button>

        {status !== 'canceled' && (
          <ConfirmButton
            size="sm"
            variant="destructive"
            disabled={pending}
            message="Cancel this campaign? Its ad will stop running."
            confirmLabel="Cancel campaign"
            confirmVariant="destructive"
            cancelLabel="Keep campaign"
            onConfirm={() => run(() => cancelCampaign(campaignId), 'Campaign canceled')}
          >
            <Ban className="size-4" /> Cancel
          </ConfirmButton>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">Impression goal</span>
          <InlineNumber
            initial={goal || null}
            allowEmpty
            min={0}
            placeholder="0"
            action={(v) => setCampaignGoal(campaignId, v)}
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">Max screens</span>
          <InlineNumber
            initial={screenCapOverride}
            allowEmpty
            min={1}
            placeholder="no limit"
            action={(v) => setCampaignScreenCap(campaignId, v)}
          />
        </label>
      </div>
    </div>
  )
}
