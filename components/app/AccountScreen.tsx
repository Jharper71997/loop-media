import Link from 'next/link'
import { LogOut, Mail } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AccountSecurity } from '@/components/app/AccountSecurity'
import { AccountBilling } from '@/components/app/AccountBilling'
import { BackLink } from '@/components/app/BackLink'
import { cn } from '@/lib/utils'

// Shared Account tab for the advertiser + host apps.
export function AccountScreen({
  email,
  role,
  links,
  billing,
}: {
  email: string
  role: 'advertiser' | 'host' | 'admin'
  links?: { href: string; label: string }[]
  // When present, renders the billing card (manage payment + membership). Omitted
  // for surfaces with no billing (e.g. admin).
  billing?: {
    returnPath: string
    membershipBasePath: '/advertiser' | '/host/advertise'
    hasCustomer: boolean
    pastDue: boolean
    isMember: boolean
    showMembership?: boolean
  }
}) {
  const roleLabel = role === 'host' ? 'Venue host' : role === 'admin' ? 'Admin' : 'Advertiser'
  return (
    <div className="space-y-5 pt-2">
      <h1 className="font-heading text-2xl font-bold tracking-tight">Account</h1>

      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-full bg-primary/15 text-primary">
              <Mail className="size-5" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{email}</div>
              <div className="text-xs text-muted-foreground">{roleLabel}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <AccountSecurity email={email} />

      {billing && (
        <AccountBilling
          returnPath={billing.returnPath}
          membershipBasePath={billing.membershipBasePath}
          hasCustomer={billing.hasCustomer}
          pastDue={billing.pastDue}
          isMember={billing.isMember}
          showMembership={billing.showMembership}
        />
      )}

      {links?.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'w-full')}
        >
          {l.label}
        </Link>
      ))}

      <form action="/auth/signout" method="post">
        <Button type="submit" variant="outline" size="lg" className="w-full">
          <LogOut className="size-4" /> Sign out
        </Button>
      </form>

      <BackLink href="/" label="Back to home" className="justify-center text-xs" />
    </div>
  )
}
