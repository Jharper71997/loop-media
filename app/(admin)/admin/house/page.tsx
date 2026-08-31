import { requireAdmin, adminCanTerritory } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/admin/PageHeader'
import { SectionTabs, SHIP_TABS } from '@/components/admin/SectionTabs'
import { Badge } from '@/components/ui/badge'
import { formatDateTime } from '@/lib/format'
import {
  houseRowFor,
  resolveHouse,
  type HouseKind,
  type HouseRow,
  type HouseSetting,
} from '@/lib/houseSlides'
import { HouseUploader } from './HouseUploader'
import { HouseRowActions } from './HouseRowActions'
import { HouseScopeControl } from './HouseScopeControl'

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

type Row = HouseRow & {
  active: boolean
  created_at: string
  territory: { name: string } | null
}

// What a screen in a scope actually plays, in three words.
function playsLabel(r: HouseRow | null): string {
  if (r?.mode === 'off') return 'Not playing'
  if (r?.mode === 'creative') return 'Custom upload'
  return 'Built-in design'
}

export default async function HouseSlidesPage() {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId
  const activeName = territory.territories.find((x) => x.id === t)?.name ?? null
  const supabase = await createClient()

  // The whole table, once: it is a handful of rows and two sections need
  // different slices of it — the live settings (active rows, every market) and
  // the upload history (this scope, including retired uploads).
  const { data } = await supabase
    .from('house_creatives')
    .select(
      'id, kind, mode, creative_type, creative_url, active, created_at, territory_id, territory:territories(name)'
    )
    .order('created_at', { ascending: false })
  const rows = (data ?? []) as unknown as Row[]
  const live = rows.filter((r) => r.active)

  // The network-wide default first, then every market. A market with nothing set
  // follows the row above it, which is what almost every market should do.
  const scopes: { id: string | null; name: string }[] = [
    { id: null, name: 'All markets' },
    ...territory.territories.map((x) => ({ id: x.id, name: x.name })),
  ]

  return (
    <>
      <PageHeader
        title="House slides"
        description={
          t
            ? `What the built-in house slides do on ${activeName ?? 'this market'} screens.`
            : 'Replace a house slide, or stop it playing in a market. Uploads and switches both reach the screens within a minute.'
        }
      />
      <SectionTabs tabs={SHIP_TABS} />

      <div className="space-y-4 p-3 md:p-4">
        {SLIDES.map((slide) => {
          const uploads = rows.filter(
            (r) =>
              r.kind === slide.kind &&
              r.mode === 'creative' &&
              (!t || r.territory_id === null || r.territory_id === t)
          )
          // What a screen in the current scope plays. Same resolution the TV
          // manifest runs: the market's own row, then the network-wide one.
          const here = resolveHouse(live, slide.kind, t)
          const playingUpload = here?.mode === 'creative' ? here : null
          // Markets that have taken this slide out of their loop entirely.
          const offIn = scopes
            .filter((s) => s.id && houseRowFor(live, slide.kind, s.id)?.mode === 'off')
            .map((s) => s.name)
          const offEverywhere = houseRowFor(live, slide.kind, null)?.mode === 'off'

          return (
            <div key={slide.kind} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium">{slide.label}</h3>
                    <Badge
                      variant={
                        here?.mode === 'off'
                          ? 'destructive'
                          : playingUpload
                            ? 'secondary'
                            : 'outline'
                      }
                    >
                      {playsLabel(here)}
                    </Badge>
                    {here && !here.territory_id && !t && (
                      <Badge variant="outline">All markets</Badge>
                    )}
                    {here?.territory_id && (
                      <Badge variant="outline">
                        {rows.find((r) => r.id === here.id)?.territory?.name ?? 'This market'}
                      </Badge>
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
                  {playingUpload?.creative_url ? (
                    playingUpload.creative_type === 'video' ? (
                      <video
                        src={playingUpload.creative_url}
                        className="aspect-video w-full object-contain"
                        muted
                        loop
                        autoPlay
                        playsInline
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={playingUpload.creative_url}
                        alt=""
                        className="aspect-video w-full object-contain"
                      />
                    )
                  ) : (
                    <div className="flex aspect-video w-full items-center justify-center px-3 text-center text-xs text-muted-foreground">
                      {here?.mode === 'off'
                        ? `This slide is not in the loop ${t ? 'here' : 'anywhere'}`
                        : `The built-in ${slide.label.toLowerCase()} is playing`}
                    </div>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {playingUpload ? (
                    <>
                      Uploaded {formatDateTime(playingUpload.created_at)}.
                      <br />
                      The creative plays on its own — nothing is drawn over it.
                    </>
                  ) : here?.mode === 'off' ? (
                    'Screens run one fewer slide, so paid ads come round faster. Switch it back on below.'
                  ) : (
                    'Upload an image or video to replace it. Remove the upload later and this comes back.'
                  )}
                </p>
              </div>

              {/* Where it plays — the answer to "which markets is this NOT on". */}
              <div className="mt-4 border-t border-border pt-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Where it plays
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    {offEverywhere
                      ? 'Off everywhere.'
                      : offIn.length
                        ? `Off in ${offIn.join(', ')}.`
                        : 'Playing on every screen.'}
                  </p>
                </div>
                <div className="mt-2 divide-y divide-border">
                  {scopes.map((s) => {
                    const own = houseRowFor(live, slide.kind, s.id)
                    const value: HouseSetting | 'creative' = own ? own.mode : 'default'
                    const effective = resolveHouse(live, slide.kind, s.id)
                    return (
                      <div
                        key={s.id ?? 'network'}
                        className="flex flex-wrap items-center justify-between gap-2 py-2"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm">{s.name}</span>
                            {s.id === null && (
                              <Badge variant="outline">Default for every market</Badge>
                            )}
                            {value === 'creative' && (
                              <Badge variant="secondary">Custom upload</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {s.id && value === 'default'
                              ? `Follows the network: ${playsLabel(effective).toLowerCase()}`
                              : playsLabel(effective)}
                          </p>
                        </div>
                        <HouseScopeControl
                          kind={slide.kind}
                          territoryId={s.id}
                          value={value}
                          disabled={!adminCanTerritory(profile, s.id)}
                          label={s.id ? s.name : 'every market'}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Every upload for this slide, so an old one can be brought back */}
              {uploads.length > 0 && (
                <div className="mt-4 space-y-2 border-t border-border pt-3">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Uploads
                  </h4>
                  {uploads.map((r) => (
                    <div
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-2 text-sm"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Badge variant="outline">{r.creative_type}</Badge>
                        {r.id === here?.id ? (
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
