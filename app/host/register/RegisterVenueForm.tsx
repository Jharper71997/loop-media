'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { BusinessHoursPicker, type BusinessHoursValue } from '@/components/app/BusinessHoursPicker'
import { defaultHoursValue, hoursValueToFields } from '@/lib/openHours'
import {
  AGREEMENT_INTRO,
  AGREEMENT_SECTIONS,
  AGREEMENT_TITLE,
  AGREEMENT_VERSION,
} from '@/lib/agreement'
import { DEMO_HOST } from '@/lib/demoData'
import { requestVenue } from './actions'

const NO_CATEGORY = 'none'

export function RegisterVenueForm({
  categories,
  demo = false,
}: {
  categories: { id: string; name: string }[]
  // Demo walkthrough: prefill a believable sample venue so a prospect (or Jacob)
  // can submit in one click and land on a live dashboard.
  demo?: boolean
}) {
  const router = useRouter()
  const [name, setName] = useState(demo ? DEMO_HOST.venueName : '')
  const [address, setAddress] = useState(demo ? DEMO_HOST.address : '')
  const [city, setCity] = useState(demo ? DEMO_HOST.city : '')
  const [stateVal, setStateVal] = useState(demo ? DEMO_HOST.state : '')
  const [zip, setZip] = useState(demo ? DEMO_HOST.zip : '')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [venueType, setVenueType] = useState(demo ? DEMO_HOST.venueType : '')
  const [dailyCustomers, setDailyCustomers] = useState(demo ? String(DEMO_HOST.dailyCustomers) : '')
  const [phone, setPhone] = useState(demo ? DEMO_HOST.phone : '')
  const [signerName, setSignerName] = useState(demo ? DEMO_HOST.fullName : '')
  const [agreed, setAgreed] = useState(demo)
  const [networkType, setNetworkType] = useState<'wifi' | 'ethernet'>('wifi')
  const [ssid, setSsid] = useState(demo ? DEMO_HOST.ssid : '')
  const [wifiPassword, setWifiPassword] = useState(demo ? DEMO_HOST.wifiPassword : '')
  const [networkNote, setNetworkNote] = useState('')
  const [hours, setHours] = useState<BusinessHoursValue>(defaultHoursValue())
  const [pending, start] = useTransition()

  const categoryOptions: ComboboxOption[] = [
    { value: NO_CATEGORY, label: 'Other / not sure' },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
  ]

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return toast.error('Enter your venue name.')
    if (!address.trim()) return toast.error('Enter your street address.')
    if (!city.trim() || !stateVal.trim()) return toast.error('Enter your city and state.')
    if (!zip.trim()) return toast.error('Enter your ZIP code.')
    if (!dailyCustomers.trim() || Number(dailyCustomers) <= 0)
      return toast.error('Enter your typical traffic per day.')
    if (!phone.trim()) return toast.error('Enter a contact phone.')
    if (networkType === 'wifi' && !ssid.trim())
      return toast.error('Enter your WiFi network name.')
    if (networkType === 'wifi' && !wifiPassword.trim())
      return toast.error('Enter your WiFi password.')
    if (!hours.days.some((d) => d.isOpen))
      return toast.error('Pick at least one day you’re open.')
    if (!agreed) return toast.error('Please accept the Advertising Service Agreement.')
    if (!signerName.trim()) return toast.error('Type your name to sign the agreement.')
    start(async () => {
      const res = await requestVenue({
        name,
        address,
        city,
        state: stateVal,
        postal_code: zip,
        category_id: categoryId,
        venue_type: venueType || null,
        foot_traffic_estimate: 0,
        median_daily_customers: dailyCustomers ? Number(dailyCustomers) : null,
        contact_phone: phone || null,
        agreement_signer_name: signerName,
        agreement_version: AGREEMENT_VERSION,
        ...hoursValueToFields(hours),
        network_type: networkType,
        wifi_ssid: ssid || null,
        wifi_password: wifiPassword || null,
        network_note: networkNote || null,
      })
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(
        demo
          ? "You're live. Here's your dashboard."
          : "Location submitted. Once it's approved, we'll reach out to schedule your Fire Stick setup."
      )
      router.push('/host')
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="reg-name">Venue name</Label>
        <Input id="reg-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="reg-address">Street address</Label>
        <Input id="reg-address" value={address} onChange={(e) => setAddress(e.target.value)} required />
      </div>

      <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor="reg-city">City</Label>
          <Input id="reg-city" value={city} onChange={(e) => setCity(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reg-state">State</Label>
          <Input
            id="reg-state"
            value={stateVal}
            onChange={(e) => setStateVal(e.target.value.toUpperCase())}
            maxLength={2}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reg-zip">ZIP</Label>
          <Input id="reg-zip" value={zip} onChange={(e) => setZip(e.target.value)} required />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Venue category</Label>
          <Combobox
            options={categoryOptions}
            value={categoryId ?? NO_CATEGORY}
            onValueChange={(v) => setCategoryId(v && v !== NO_CATEGORY ? v : null)}
            placeholder="Select type"
            searchPlaceholder="Search categories…"
            emptyText="No matching category."
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="reg-venue-type">Specific type (optional)</Label>
          <Input
            id="reg-venue-type"
            value={venueType}
            onChange={(e) => setVenueType(e.target.value)}
            placeholder="e.g. Sports bar, CrossFit gym"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="reg-daily">Typical traffic per day</Label>
        <Input
          id="reg-daily"
          type="number"
          inputMode="numeric"
          min={1}
          value={dailyCustomers}
          onChange={(e) => setDailyCustomers(e.target.value)}
          placeholder="e.g. 150"
          required
        />
        <p className="text-xs text-muted-foreground">
          Your usual foot traffic on an average day. We use this to estimate reach for advertisers.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="reg-phone">Contact phone</Label>
        <Input
          id="reg-phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="So we can reach you about setup"
          required
        />
      </div>

      <div className="space-y-2 rounded-lg border border-border p-4">
        <Label className="text-sm font-medium">When are you open?</Label>
        <BusinessHoursPicker value={hours} onChange={setHours} />
      </div>

      <div className="space-y-3 rounded-lg border border-border p-4">
        <Label className="text-sm font-medium">Network details</Label>
        <p className="text-xs text-muted-foreground">
          How your screen connects to the internet, so we can get it online. Stored privately and
          only used for support.
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={networkType === 'wifi' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setNetworkType('wifi')}
          >
            WiFi
          </Button>
          <Button
            type="button"
            variant={networkType === 'ethernet' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setNetworkType('ethernet')}
          >
            Wired (Ethernet)
          </Button>
        </div>
        {networkType === 'wifi' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="reg-ssid">WiFi network name (SSID)</Label>
              <Input
                id="reg-ssid"
                value={ssid}
                onChange={(e) => setSsid(e.target.value)}
                placeholder="MyVenue-WiFi"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reg-wifi-pass">WiFi password</Label>
              <Input
                id="reg-wifi-pass"
                value={wifiPassword}
                onChange={(e) => setWifiPassword(e.target.value)}
                placeholder="Network password"
                required
              />
            </div>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="reg-note">Anything we should know? (optional)</Label>
          <Input
            id="reg-note"
            value={networkNote}
            onChange={(e) => setNetworkNote(e.target.value)}
            placeholder="e.g. guest network, where the TV is, login portal"
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Once your location is approved, we&apos;ll reach out to schedule a quick setup — we bring a
        Loop Network Fire Stick with the app already loaded and get it running on your TV. Nothing
        for you to download, plug into a computer, or configure.
      </p>

      <div className="space-y-3 rounded-lg border border-border p-4">
        <div className="flex items-baseline justify-between gap-2">
          <Label className="text-sm font-medium">{AGREEMENT_TITLE}</Label>
          <span className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">
            v{AGREEMENT_VERSION}
          </span>
        </div>
        <div className="max-h-56 space-y-3 overflow-y-auto rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
          <p>{AGREEMENT_INTRO}</p>
          {AGREEMENT_SECTIONS.map((s) => (
            <div key={s.n} className="space-y-1">
              <p className="font-medium text-foreground">
                {s.n}. {s.title}
              </p>
              {s.body.split('\n\n').map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reg-signer">Signature (type your full name)</Label>
          <Input
            id="reg-signer"
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
            placeholder="Your full name"
            autoComplete="name"
          />
        </div>
        <label className="flex items-start gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 rounded border-border accent-primary"
          />
          <span>
            I have read and agree to the Loop Network Advertising Service Agreement on behalf of this
            business, and I am authorized to accept it.
          </span>
        </label>
      </div>

      <Button type="submit" size="lg" disabled={pending || !agreed || !signerName.trim()}>
        {pending ? 'Submitting…' : 'Submit venue'}
      </Button>
    </form>
  )
}
