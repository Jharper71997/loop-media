import Link from 'next/link'
import {
  DollarSign,
  Store,
  Activity,
  Map,
  Users,
  BarChart3,
  Tags,
  MessageSquare,
  Mail,
  Settings,
  UserCircle,
  Gamepad2,
  Globe,
  Images,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { PageHeader } from '@/components/admin/PageHeader'
import { SectionTabs, MORE_TABS } from '@/components/admin/SectionTabs'
import { HudBody } from '@/components/admin/hud'

// More — every page that is not one of the three daily jobs.
//
// The sidebar used to list thirteen destinations flat, which is how you end up
// scanning a wall of links to find the one screen you want. Watch, Sell and Ship
// took the pages you open every day; these are the rest, and they are real work
// — just not work that happens on a schedule. Grouped by what you came here
// wanting to change, because that is how you remember where something lives.

type Entry = { href: string; label: string; detail: string; icon: LucideIcon }
type Group = { label: string; note: string; items: Entry[] }

const GROUPS: Group[] = [
  {
    label: 'Money',
    note: 'What came in, what is going to, and what everything costs.',
    items: [
      {
        href: '/admin/money',
        label: 'Billing',
        detail: 'Every account, what they pay, and who is overdue or about to lapse.',
        icon: DollarSign,
      },
      {
        href: '/admin/pricing',
        label: 'Pricing & packages',
        detail: 'The rate card, the volume ladder, and the categories you sell into.',
        icon: Tags,
      },
      {
        href: '/admin/reports',
        label: 'Advertiser reports',
        detail: 'Plays, scans and reach per advertiser — what you send them monthly.',
        icon: BarChart3,
      },
    ],
  },
  {
    label: 'The network',
    note: 'The rooms, the hardware, and whether it is behaving.',
    items: [
      {
        href: '/admin/venues',
        label: 'Venues & screens',
        detail: 'Every location, its host, its hours, and the screens in it.',
        icon: Store,
      },
      {
        href: '/admin/uptime',
        label: 'Uptime',
        detail: 'Thirty days of check-ins per screen against the hours it should be on.',
        icon: Activity,
      },
      { href: '/admin/map', label: 'Map', detail: 'Where the screens actually are.', icon: Map },
    ],
  },
  {
    label: 'People',
    note: 'Who is on the network and who is being worked.',
    items: [
      {
        href: '/admin/advertisers',
        label: 'Advertisers',
        detail: 'Everyone paying or comped, and what each one is running.',
        icon: Users,
      },
      {
        href: '/admin/pipeline',
        label: 'Pipeline',
        detail: 'Prospects mid-conversation, by stage, for both advertisers and venues.',
        icon: BarChart3,
      },
    ],
  },
  {
    label: 'On the screens',
    note: 'The content between the ads.',
    items: [
      {
        href: '/admin/house',
        label: 'House slides',
        detail: 'What plays in the unsold spots — your own promos.',
        icon: Images,
      },
      {
        href: '/admin/trivia',
        label: 'Trivia',
        detail: 'The question bank and which venues run it.',
        icon: Gamepad2,
      },
    ],
  },
  {
    label: 'Setup',
    note: 'The numbers and copy you change twice a year.',
    items: [
      {
        href: '/admin/settings',
        label: 'Business settings',
        detail: 'The goal, the rates, and every number the rest of the app reads.',
        icon: Settings,
      },
      {
        href: '/admin/messages',
        label: 'Templates',
        detail: 'The wording of what goes out to hosts and advertisers.',
        icon: MessageSquare,
      },
      {
        href: '/admin/email',
        label: 'Emails',
        detail: 'Which automated emails send, and to whom.',
        icon: Mail,
      },
      {
        href: '/admin/territories',
        label: 'Markets',
        detail: 'The cities the network runs in. Add one, archive one, delete a stray one.',
        icon: Globe,
      },
      {
        href: '/admin/account',
        label: 'Account',
        detail: 'Your own login and territory access.',
        icon: UserCircle,
      },
    ],
  },
]

export default async function MorePage() {
  await requireAdmin()

  return (
    <>
      <PageHeader title="More" description="Everything that is not a daily job" />
      <SectionTabs tabs={MORE_TABS} />
      <HudBody>
        {GROUPS.map((g) => (
          <section key={g.label} className="space-y-2">
            <div className="flex items-baseline gap-2">
              <h2 className="text-[13px] font-medium">{g.label}</h2>
              <p className="min-w-0 truncate text-[11px] text-muted-foreground">{g.note}</p>
            </div>
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <ul className="divide-y divide-border">
                {g.items.map((i) => (
                  <li key={i.href}>
                    <Link
                      href={i.href}
                      className="flex items-center gap-3 px-3 py-3 hover:bg-muted/50 md:py-2.5"
                    >
                      <i.icon className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{i.label}</div>
                        <p className="line-clamp-2 text-xs text-muted-foreground md:truncate">
                          {i.detail}
                        </p>
                      </div>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ))}
      </HudBody>
    </>
  )
}
