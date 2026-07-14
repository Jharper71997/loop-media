import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Users, Clock, Eye } from 'lucide-react'

// Audience-demographics teaser (Quividi data moat). The cameras aren't live yet,
// so this is a COMING-SOON preview: it shows the KINDS of metrics Loop will
// measure — age, gender, dwell, attention — behind a blurred/muted treatment and
// a "Coming soon" badge, so it reads as a capability preview, never as real
// measured numbers. Visible to every advertiser (the teaser); no purchase pushed
// for a feature that isn't shipped.
//
// The illustrative figures below are fixed placeholders, identical for everyone —
// deliberately NOT per-advertiser, so nothing here can be mistaken for their data.

const AGES: { label: string; pct: number }[] = [
  { label: '18–24', pct: 22 },
  { label: '25–34', pct: 34 },
  { label: '35–44', pct: 21 },
  { label: '45–54', pct: 14 },
  { label: '55+', pct: 9 },
]

export function AudienceInsights() {
  const maxAge = Math.max(...AGES.map((a) => a.pct))
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">Audience demographics</p>
            <p className="text-xs text-muted-foreground">
              Who&apos;s actually watching — measured anonymously on the screen
            </p>
          </div>
          <Badge variant="secondary" className="shrink-0">
            Coming soon
          </Badge>
        </div>

        {/* Capability preview — blurred + inert so it reads as "what's coming",
            not as data the advertiser can act on. */}
        <div
          aria-hidden
          className="mt-4 grid gap-4 select-none opacity-70 blur-[2px] sm:grid-cols-2"
        >
          {/* Age mix */}
          <div className="rounded-xl border border-border p-4">
            <p className="mb-3 flex items-center gap-1.5 text-xs font-medium">
              <Users className="size-3.5 text-primary" /> Age mix
            </p>
            <div className="space-y-2">
              {AGES.map((a) => (
                <div key={a.label} className="flex items-center gap-2">
                  <span className="w-12 shrink-0 text-[0.7rem] text-muted-foreground tabular-nums">
                    {a.label}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{ width: `${(a.pct / maxAge) * 100}%` }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-right text-[0.7rem] text-muted-foreground tabular-nums">
                    {a.pct}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Gender + engagement stats */}
          <div className="space-y-4">
            <div className="rounded-xl border border-border p-4">
              <p className="mb-3 text-xs font-medium">Gender</p>
              <div className="flex h-3 overflow-hidden rounded-full">
                <div className="bg-primary/70" style={{ width: '54%' }} />
                <div className="bg-primary/30" style={{ width: '46%' }} />
              </div>
              <div className="mt-2 flex justify-between text-[0.7rem] text-muted-foreground">
                <span>Male 54%</span>
                <span>Female 46%</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl border border-border p-4">
                <p className="flex items-center gap-1.5 text-xs font-medium">
                  <Clock className="size-3.5 text-primary" /> Dwell
                </p>
                <p className="mt-1 font-heading text-xl font-bold tabular-nums">12s</p>
              </div>
              <div className="rounded-xl border border-border p-4">
                <p className="flex items-center gap-1.5 text-xs font-medium">
                  <Eye className="size-3.5 text-primary" /> Attention
                </p>
                <p className="mt-1 font-heading text-xl font-bold tabular-nums">48%</p>
              </div>
            </div>
          </div>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          Loop screens will soon measure age, gender, dwell time, and attention right on the screen,
          fully anonymous (no faces stored), so you see exactly who your ad reached. Rolling out with
          Loop Insights.
        </p>
      </CardContent>
    </Card>
  )
}
