import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/admin/PageHeader'
import { SectionTabs, SHIP_TABS } from '@/components/admin/SectionTabs'
import { Badge } from '@/components/ui/badge'
import { formatDateTime } from '@/lib/format'
import { HouseUploader } from './HouseUploader'
import { HouseRowActions } from './HouseRowActions'
import { HouseEnabledControl } from './HouseEnabledControl'
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
  // Admin-given name (migration 0077). Null on anything uploaded before naming
  // existed, which falls back to the upload date.
  label: string | null
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
      'id, kind, creative_type, creative_url, label, active, created_at, territory_id, territory:territories(name)'
    )
    .order('created_at', { ascending: false })
  if (t) q = q.or(`territory_id.is.null,territory_id.eq.${t}`)
  const { data } = await q
  const rows = (data ?? []) as unknown as Row[]

  // Whether each slide plays at all, for this scope (migration 0075). Same scope
  // resolution as the creative above and as the TV manifest: a market row beats the
  // network-wide one, and no row at all means it plays.
  let sq = supabase.from('house_slide_settings').select('kind, enabled, territory_id')
  if (t) sq = sq.or(`territory_id.is.null,territory_id.eq.${t}`)
  else sq = sq.is('territory_id', null)
  const { data: settingsData } = await sq
  const settings = (settingsData ?? []) as {
    kind: HouseKind
    enabled: boolean
    territory_id: string | null
  }[]

  return (
    <>
      <PageHeader
        title="House slides"
        description={
          t
            ? `Replace or switch off the house slides for ${activeName ?? 'this market'}, or leave them on the network default.`
            : 'Replace the house slides across every screen, or take one off the screens entirely. Pick a market to override just that market.'
        }
      />
      <SectionTabs tabs={SHIP_TABS} />

      <div className="space-y-4 p-3 md:p-4">
        {SLIDES.map((slide) => {
          const forSlide = rows.filter((r) => r.kind === slide.kind)
          // What a screen in the current scope actually plays: a market-scoped
          // override beats the network-wide one, and with neither the built-in
          // design plays. Mirrors the pick in app/api/tv/loop.
          const live =
            forSlide.find((r) => r.active && t && r.territory_id === t) ??
            forSlide.find((r) => r.active && !r.territory_id) ??
            null

          // On/off for this scope, resolved the same way: this market's own row if
          // it has one, else the network-wide row, else on.
          const ownSetting = settings.find(
            (s) => s.kind === slide.kind && (t ? s.territory_id === t : !s.territory_id)
          )
          const globalSetting = settings.find((s) => s.kind === slide.kind && !s.territory_id)
          const playing = (ownSetting ?? globalSetting)?.enabled ?? true

          return (
            <div key={slide.kind} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium">{slide.label}</h3>
                    {!playing && (
                      <Badge variant="destructive">
                        {t ? `Off in ${activeName ?? 'this market'}` : 'Off on every screen'}
                      </Badge>
                    )}
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
                  {!playing && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Not playing{t ? ` in ${activeName ?? 'this market'}` : ' anywhere'}. The upload
                      below is kept — putting it back on restores it.
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <HouseEnabledControl
                    kind={slide.kind}
                    label={slide.label}
                    territoryId={t}
                    territoryName={t ? (activeName ?? 'this market') : null}
                    enabled={playing}
                    hasOwnSetting={!!ownSetting}
                  />
                  <HouseUploader
                    kind={slide.kind}
                    label={slide.label}
                    territoryId={t}
                    userId={profile.id}
                  />
                </div>
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
              {/* Every upload for this slide. A thumbnail and a name, because four
                  rows reading the same upload date is how the wrong ad ends up on
                  ten screens. */}
              {forSlide.length > 0 && (
                <div className="mt-4 divide-y divide-border border-t border-border">
                  {forSlide.map((r) => (
                    <div
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="h-10 w-16 shrink-0 overflow-hidden rounded border border-border bg-black">
                          {r.creative_type === 'video' ? (
                            <video src={r.creative_url} className="h-full w-full object-contain" muted />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={r.creative_url}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              className="h-full w-full object-contain"
                            />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate font-medium">
                              {r.label || formatDateTime(r.created_at)}
                            </span>
                            <Badge variant="outline">{r.creative_type}</Badge>
                            {r.id === live?.id ? (
                              <Badge variant="secondary">On screens</Badge>
                            ) : (
                              !r.active && <Badge variant="outline">Paused</Badge>
                            )}
                            {!t && r.territory?.name && (
                              <Badge variant="outline">{r.territory.name}</Badge>
                            )}
                            {!t && !r.territory_id && <Badge variant="outline">All markets</Badge>}
                          </div>
                          <p className="truncate text-xs text-muted-foreground">
                            Uploaded {formatDateTime(r.created_at)}
                          </p>
                        </div>
                      </div>
                      <HouseRowActions
                        id={r.id}
                        active={r.active}
                        label={r.label}
                        kind={slide.kind}
                        userId={profile.id}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        <p className="text-xs text-muted-foreground">
          Screens re-read their loop about every 30 seconds, so a change shows up on the TVs within
          a minute. Nothing here needs a deploy. To keep a slide off just one TV, use the Take off
          button on that screen&apos;s page instead.
        </p>
      </div>
    </>
  )
}
