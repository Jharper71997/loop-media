import { AlertTriangle } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { PageHeader } from '@/components/admin/PageHeader'
import { HudBody, Panel } from '@/components/admin/hud'
import { SectionTabs, MORE_TABS } from '@/components/admin/SectionTabs'
import { EditableValue } from '@/components/admin/EditableValue'
import { getSettings, getSettingsMeta } from '@/lib/settings.server'
import { SETTINGS, SETTING_KEYS, SETTING_GROUPS, type SettingKey } from '@/lib/settings'

// Every business number in one place.
//
// This page has no hand-written list of settings — it is generated from the
// registry in lib/settings.ts, so adding a setting there makes it appear here
// with its label, help text and bounds already wired. The same numbers are also
// editable inline wherever they are displayed; this page exists for the ones you
// want to find without knowing which screen shows them.

export default async function SettingsPage() {
  await requireAdmin()
  const [values, meta] = await Promise.all([getSettings(), getSettingsMeta()])

  const byGroup = SETTING_GROUPS.map((group) => ({
    group,
    keys: SETTING_KEYS.filter((k) => SETTINGS[k].group === group),
  })).filter((g) => g.keys.length > 0)

  const changed = SETTING_KEYS.filter((k) => meta.overridden.has(k)).length

  return (
    <>
      <PageHeader
        title="Settings"
        description={
          meta.ready
            ? changed === 0
              ? 'Every value is at its default'
              : `${changed} value${changed === 1 ? '' : 's'} changed from default`
            : 'Read-only until the settings table is created'
        }
      />
      <SectionTabs tabs={MORE_TABS} />

      <HudBody>
        {!meta.ready && (
          <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
            <AlertTriangle className="mt-px size-4 shrink-0 text-warning" />
            <div className="space-y-1">
              <p className="font-medium">
                The settings table does not exist yet, so saving will fail.
              </p>
              <p className="text-muted-foreground">
                Everything below is running on its built-in default, which is the same number that
                was hardcoded before — nothing is broken. To make these editable, paste{' '}
                <code className="rounded bg-muted px-1 py-0.5 font-mono">
                  supabase/migrations/0067_app_settings.sql
                </code>{' '}
                into the Supabase SQL editor and reload this page.
              </p>
            </div>
          </div>
        )}

        {/* Columns, not a grid: the groups are wildly different heights (Goals
            has three settings, Reporting has one), and a grid would leave a hole
            under every short one. Columns pack them tight, which is the whole
            point of the layout. */}
        <div className="gap-3 lg:columns-2 xl:columns-3">
          {byGroup.map(({ group, keys }) => (
            <Panel key={group} title={group} bodyClassName="p-0" className="mb-3 break-inside-avoid">
              <ul className="divide-y divide-border">
                {keys.map((key) => (
                  <SettingRow
                    key={key}
                    settingKey={key}
                    value={values[key]}
                    overridden={meta.overridden.has(key)}
                  />
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      </HudBody>
    </>
  )
}

function SettingRow({
  settingKey,
  value,
  overridden,
}: {
  settingKey: SettingKey
  value: number | string
  overridden: boolean
}) {
  const def = SETTINGS[settingKey]
  return (
    <li className="px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium">
            {def.label}
            {overridden && (
              <span
                className="ml-1.5 align-middle text-[10px] font-normal text-primary"
                title="Changed from the built-in default"
              >
                edited
              </span>
            )}
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{def.help}</p>
        </div>
        <EditableValue
          settingKey={settingKey}
          value={value}
          className="shrink-0 font-mono text-sm font-semibold tabular-nums"
        />
      </div>
    </li>
  )
}
