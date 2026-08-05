import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/admin/PageHeader'
import { SectionTabs, CONTENT_TABS } from '@/components/admin/SectionTabs'
import { Badge } from '@/components/ui/badge'
import { formatDateTime } from '@/lib/format'
import { HouseUploader } from './HouseUploader'
import { HouseRowActions } from './HouseRowActions'
import type { HouseKind } from './actions'

export const dynamic = 'force-dynamic'

// The two slides the network plays on every screen for itself, rather than for a
// paying advertiser.
const SLIDES: { kind: HouseKind; label: string; blurb: string }[] = [
  {
    kind: 'brewloop',
    label: 'Brew Loop ad',
    blurb: 'The Jville Brew Loop cross-promo. Scanning it opens the booking site.',
  },
  {
    kind: 'advertise',
    label: '“Advertise on this screen” card',
    blurb: 'The house sales pitch. Scanning it opens the Loop Network site.',
  },
]

type Row = {
  id: string
  kind: HouseKind
  creative_type: 'image' | 'video'
  creative_url: string
  active: boolean
  created_at: string
  territory_id: string | null
  territory: { name: string } | null
}

export default async function HouseSlidesPage() {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId
  const activeName = territory.territories.find((x) => x.id === t)?.name ?? null
  const supabase = await createClient()

  // Same convention as the rest of admin: "All markets" lists every override with a
  // market label; picking a market scopes the view. Uploading always targets the
  // active scope — with no market picked that's the network-wide default, which is
  // the common case here since both slides normally run everywhere.
  let q = supabase
    .from('house_creatives')
    .select(
      'id, kind, creative_type, creative_url, active, created_at, territory_id, territory:territories(name)'
    )
    .order('created_at', { ascending: false })
  if (t) q = q.or(`territory_id.is.null,territory_id.eq.${t}`)
  const { data } = await q
  const rows = (data ?? []) as unknown as Row[]

  return (
    <>
      <PageHeader
        title="House slides"
        description={
          t
            ? `Replace the built-in house slides for ${activeName ?? 'this market'}, or leave them on the network default.`
            : 'Replace the built-in house slides across every screen. Pick a market to override just that market.'
        }
      />
      <SectionTabs tabs={CONTENT_TABS} />

      <div className="space-y-5 p-5 md:p-6">
        {SLIDES.map((slide) => {
          const forSlide = rows.filter((r) => r.kind === slide.kind)
          // What a screen in the current scope actually plays: a market-scoped
          // override beats the network-wide one, and with neither the built-in
          // design plays. Mirrors the pick in app/api/tv/loop.
          const live =
            forSlide.find((r) => r.active && t && r.territory_id === t) ??
            forSlide.find((r) => r.active && !r.territory_id) ??
            null

          return (
            <div key={slide.kind} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium">{slide.label}</h3>
                    <Badge variant={live ? 'secondary' : 'outline'}>
                      {live ? 'Custom upload' : 'Built-in design'}
                    </Badge>
                    {live && !live.territory_id && !t && (
                      <Badge variant="outline">All markets</Badge>
                    )}
                    {live?.territory?.name && (
                      <Badge variant="outline">{live.territory.name}</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{slide.blurb}</p>
                </div>
                <HouseUploader
                  kind={slide.kind}
                  label={slide.label}
                  territoryId={t}
                  userId={profile.id}
                />
              </div>

              {/* What's on the screens right now */}
              <div className="mt-4 flex flex-wrap items-center gap-4">
                <div className="w-64 shrink-0 overflow-hidden rounded-lg border border-border bg-black">
                  {live ? (
                    live.creative_type === 'video' ? (
                      <video
                        src={live.creative_url}
                        className="aspect-video w-full object-contain"
                        muted
                        loop
                        autoPlay
                        playsInline
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={live.creative_url}
                        alt=""
                        className="aspect-video w-full object-contain"
                      />
                    )
                  ) : (
                    <div className="flex aspect-video w-full items-center justify-center px-3 text-center text-xs text-muted-foreground">
                      The built-in {slide.label.toLowerCase()} is playing
                    </div>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {live ? (
                    <>
                      Uploaded {formatDateTime(live.created_at)}.
                      <br />
                      The creative plays on its own — nothing is drawn over it.
                    </>
                  ) : (
                    'Upload an image or video to replace it. Remove the upload later and this comes back.'
                  )}
                </p>
              </div>

              {/* Every upload for this slide, so an old one can be brought back */}
              {forSlide.length > 0 && (
                <div className="mt-4 space-y-2 border-t border-border pt-3">
                  {forSlide.map((r) => (
                    <div
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-2 text-sm"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Badge variant="outline">{r.creative_type}</Badge>
                        {r.id === live?.id ? (
                          <Badge variant="secondary">On screens</Badge>
                        ) : (
                          !r.active && <Badge variant="outline">Paused</Badge>
                        )}
                        <span className="truncate text-muted-foreground">
                          {formatDateTime(r.created_at)}
                        </span>
                        {!t && r.territory?.name && (
                          <Badge variant="outline">{r.territory.name}</Badge>
                        )}
                        {!t && !r.territory_id && <Badge variant="outline">All markets</Badge>}
                      </div>
                      <HouseRowActions id={r.id} active={r.active} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        <p className="text-xs text-muted-foreground">
          Screens re-read their loop about every 30 seconds, so a change shows up on the TVs
          within a minute. Nothing here needs a deploy.
        </p>
      </div>
    </>
  )
}
