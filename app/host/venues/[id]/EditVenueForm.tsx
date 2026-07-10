'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { BusinessHoursPicker, type BusinessHoursValue } from '@/components/app/BusinessHoursPicker'
import { hoursValueFromVenue, hoursValueToFields, type PerDayHours } from '@/lib/openHours'
import { saveHostVenue, saveHostWifi } from '../actions'

const NO_CATEGORY = 'none'

export type EditVenueInitial = {
  id: string
  name: string
  address: string
  city: string
  state: string
  postal_code: string
  category_id: string | null
  venue_type: string
  median_daily_customers: number | null
  contact_phone: string
  business_open: string
  business_close: string
  business_days: number[]
  business_hours: PerDayHours | null
  network_type: 'wifi' | 'ethernet'
  wifi_ssid: string
  network_note: string
}

export function EditVenueForm({
  venue,
  categories,
}: {
  venue: EditVenueInitial
  categories: { id: string; name: string }[]
}) {
  const router = useRouter()

  // Venue details
  const [name, setName] = useState(venue.name)
  const [address, setAddress] = useState(venue.address)
  const [city, setCity] = useState(venue.city)
  const [stateVal, setStateVal] = useState(venue.state)
  const [zip, setZip] = useState(venue.postal_code)
  const [categoryId, setCategoryId] = useState<string | null>(venue.category_id)
  const [venueType, setVenueType] = useState(venue.venue_type)
  const [dailyCustomers, setDailyCustomers] = useState(
    venue.median_daily_customers ? String(venue.median_daily_customers) : ''
  )
  const [phone, setPhone] = useState(venue.contact_phone)
  const [hours, setHours] = useState<BusinessHoursValue>(() => hoursValueFromVenue(venue))
  const [savingVenue, startVenue] = useTransition()

  // Network details (WiFi password is never sent back to the page)
  const [networkType, setNetworkType] = useState<'wifi' | 'ethernet'>(venue.network_type)
  const [ssid, setSsid] = useState(venue.wifi_ssid)
  const [wifiPassword, setWifiPassword] = useState('')
  const [networkNote, setNetworkNote] = useState(venue.network_note)
  const [savingWifi, startWifi] = useTransition()

  const categoryOptions: ComboboxOption[] = [
    { value: NO_CATEGORY, label: 'Other / not sure' },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
  ]

  function onSaveVenue(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return toast.error('Enter your venue name.')
    if (!address.trim()) return toast.error('Enter your street address.')
    if (!city.trim() || !stateVal.trim()) return toast.error('Enter your city and state.')
    if (!zip.trim()) return toast.error('Enter your ZIP code.')
    if (!dailyCustomers.trim() || Number(dailyCustomers) <= 0)
      return toast.error('Enter your typical traffic per day.')
    if (!phone.trim()) return toast.error('Enter a contact phone.')
    if (!hours.days.some((d) => d.isOpen)) return toast.error('Pick at least one day you’re open.')
    startVenue(async () => {
      const res = await saveHostVenue({
        id: venue.id,
        name,
        address,
        city,
        state: stateVal,
        postal_code: zip,
        category_id: categoryId,
        venue_type: venueType,
        median_daily_customers: dailyCustomers ? Number(dailyCustomers) : null,
        contact_phone: phone,
        ...hoursValueToFields(hours),
      })
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success('Saved.')
      router.refresh()
    })
  }

  function onSaveWifi(e: React.FormEvent) {
    e.preventDefault()
    if (networkType === 'wifi' && !ssid.trim()) return toast.error('Enter your WiFi network name.')
    startWifi(async () => {
      const res = await saveHostWifi(venue.id, {
        network_type: networkType,
        wifi_ssid: ssid,
        wifi_password: wifiPassword,
        network_note: networkNote,
      })
      if (res.error) {
        toast.error(res.error)
        return
      }
      setWifiPassword('')
      toast.success('Network details saved.')
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      {/* Venue details */}
      <form onSubmit={onSaveVenue} className="space-y-5">
        <div className="space-y-1.5">
          <Label>Venue name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </div>

        <div className="space-y-1.5">
          <Label>Street address</Label>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} required />
          <p className="text-xs text-muted-foreground">
            Changing your address updates your pin on the advertiser map.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
          <div className="space-y-1.5">
            <Label>City</Label>
            <Input value={city} onChange={(e) => setCity(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label>State</Label>
            <Input
              value={stateVal}
              onChange={(e) => setStateVal(e.target.value.toUpperCase())}
              maxLength={2}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>ZIP</Label>
            <Input value={zip} onChange={(e) => setZip(e.target.value)} required />
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
            <Label>Specific type (optional)</Label>
            <Input
              value={venueType}
              onChange={(e) => setVenueType(e.target.value)}
              placeholder="e.g. Sports bar, CrossFit gym"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Typical traffic per day</Label>
          <Input
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
          <Label>Contact phone</Label>
          <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required />
        </div>

        <div className="space-y-2 rounded-lg border border-border p-4">
          <Label className="text-sm font-medium">When are you open?</Label>
          <BusinessHoursPicker value={hours} onChange={setHours} />
        </div>

        <Button type="submit" size="lg" disabled={savingVenue}>
          {savingVenue ? 'Saving…' : 'Save changes'}
        </Button>
      </form>

      {/* Network details — separate save; password left blank keeps the current one */}
      <form onSubmit={onSaveWifi} className="space-y-3 rounded-lg border border-border p-4">
        <Label className="text-sm font-medium">Network details</Label>
        <p className="text-xs text-muted-foreground">
          How your screen connects to the internet. Stored privately and only used for support.
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
              <Label>WiFi network name (SSID)</Label>
              <Input value={ssid} onChange={(e) => setSsid(e.target.value)} placeholder="MyVenue-WiFi" />
            </div>
            <div className="space-y-1.5">
              <Label>WiFi password</Label>
              <Input
                value={wifiPassword}
                onChange={(e) => setWifiPassword(e.target.value)}
                placeholder="Leave blank to keep current"
              />
            </div>
          </div>
        )}
        <div className="space-y-1.5">
          <Label>Anything we should know? (optional)</Label>
          <Input
            value={networkNote}
            onChange={(e) => setNetworkNote(e.target.value)}
            placeholder="e.g. guest network, where the TV is, login portal"
          />
        </div>
        <Button type="submit" variant="outline" size="sm" disabled={savingWifi}>
          {savingWifi ? 'Saving…' : 'Save network details'}
        </Button>
      </form>
    </div>
  )
}
