'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/auth'
import { sendEmail } from '@/lib/email'
import { appUrl } from '@/lib/stripe'
import type { CreativeRequestStatus } from '@/lib/db.types'

// Admin actions for the creative-help queue. Advertisers ask us to build their
// ad (creative_requests); admins work them open -> in_progress -> done and can
// leave a note that emails the advertiser. Writes go through the RLS client
// (creq_admin_write policy); the advertiser lookup for the notification email
// uses the service-role client so we can read their profile.

export async function setCreativeStatus(id: string, status: CreativeRequestStatus) {
  const profile = await requireAdmin()
  const supabase = await createClient()
  const { error } = await supabase
    .from('creative_requests')
    .update({ status, handled_by: profile.id, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/creative')
  return { error: null }
}

export async function saveCreativeNote(id: string, note: string, notify: boolean) {
  const profile = await requireAdmin()
  const supabase = await createClient()
  const { error } = await supabase
    .from('creative_requests')
    .update({ admin_note: note.trim() || null, handled_by: profile.id, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { error: error.message }

  let emailed = false
  if (notify && note.trim()) {
    const admin = createAdminClient()
    const { data: req } = await admin
      .from('creative_requests')
      .select('advertiser_id, brief')
      .eq('id', id)
      .single()
    if (req) {
      const { data: adv } = await admin
        .from('profiles')
        .select('email, full_name')
        .eq('id', req.advertiser_id)
        .single()
      if (adv?.email) {
        const res = await sendEmail({
          to: adv.email,
          subject: 'An update on your Loop Network ad',
          html: noteEmailHtml(adv.full_name, note.trim(), appUrl()),
        })
        emailed = res.ok
      }
    }
  }

  revalidatePath('/admin/creative')
  return { error: null, emailed }
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function noteEmailHtml(name: string | null, note: string, url: string): string {
  const hello = name ? `Hi ${esc(name.split(' ')[0])},` : 'Hi,'
  const body = esc(note).replace(/\n/g, '<br>')
  return `<!doctype html><html><body style="margin:0;background:#0a0a0b;font-family:Arial,Helvetica,sans-serif;color:#e8e8ea">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px">
    <div style="font-size:13px;letter-spacing:2px;color:#d4a333;font-weight:bold">LOOP NETWORK</div>
    <p style="margin:24px 0 8px;font-size:15px">${hello}</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5">Here is an update from our team on the ad we are building for you.</p>
    <div style="border-left:3px solid #d4a333;padding:12px 16px;background:#141416;font-size:15px;line-height:1.5">${body}</div>
    <p style="margin:20px 0 0;font-size:14px"><a href="${url}/advertiser" style="color:#d4a333">View your campaigns</a></p>
    <p style="margin:24px 0 0;font-size:12px;color:#8a8a8e">Loop Network</p>
  </div>
  </body></html>`
}
