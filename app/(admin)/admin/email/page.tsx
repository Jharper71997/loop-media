import { requireAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/admin/PageHeader'
import { EMAIL_CATALOG } from '@/lib/emailSettings'
import { EmailSettingCard } from './EmailSettingCard'

// Admin editor for the app's automated emails: turn each on/off and edit the
// copy. Backed by the email_settings table (migration 0055); blank fields fall
// back to the code defaults. The send paths read the same table, so changes here
// take effect on the next send with no deploy.
export default async function EmailPage() {
  await requireAdmin()
  const supabase = await createClient()

  const { data } = await supabase
    .from('email_settings')
    .select('key, enabled, subject, heading, body')
  const byKey = new Map((data ?? []).map((r) => [r.key as string, r]))

  return (
    <>
      <PageHeader
        title="Automated emails"
        description="Turn each automated email on or off and edit its wording. Blank fields use the default copy. The branded layout, buttons, greeting, and any data (names, amounts, links) are filled in automatically. Changes apply on the next send — no deploy."
      />

      <div className="max-w-3xl space-y-5 p-6">
        {EMAIL_CATALOG.map((entry) => {
          const row = byKey.get(entry.key) as
            | { enabled: boolean; subject: string | null; heading: string | null; body: string | null }
            | undefined
          return (
            <EmailSettingCard
              key={entry.key}
              entry={entry}
              current={{
                enabled: row?.enabled ?? true,
                subject: row?.subject ?? null,
                heading: row?.heading ?? null,
                body: row?.body ?? null,
              }}
            />
          )
        })}
      </div>
    </>
  )
}
