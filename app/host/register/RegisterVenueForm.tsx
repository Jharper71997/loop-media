'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { BusinessHoursPicker, type BusinessHoursValue } from '@/components/app/BusinessHoursPicker'
import { requestVenue } from './actions'

const NO_CATEGORY = 'none'

export function RegisterVenueForm({
  categories,
}: {
  categories: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [stateVal, setStateVal] = useState('')
  const [zip, setZip] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [venueType, setVenueType] = useState('')
  const [phone, setPhone] = useState('')
  const [networkType, setNetworkType] = useState<'wifi' | 'ethernet'>('wifi')
  const [ssid, setSsid] = useState('')
  const [wifiPassword, setWifiPassword] = useState('')
  const [networkNote, setNetworkNote] = useState('')
  const [hours, setHours] = useState<BusinessHoursValue>({
    open: '10:00',
    close: '22:00',
    days: [0, 1, 2, 3, 4, 5, 6],
  })
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
        contact_phone: phone || null,
        business_open: hours.open,
        business_close: hours.close,
        business_days: hours.days,
        network_type: networkType,
        wifi_ssid: ssid || null,
        wifi_password: wifiPassword || null,
        network_note: networkNote || null,
      })
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success('Location submitted. Once approved, pair your screen with the code on your dashboard.')
      router.push('/host')
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="space-y-1.5">
        <Label>Venue name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </div>

      <div className="space-y-1.5">
        <Label>Street address</Label>
        <Input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="614 Ensign Pl"
          required
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
        <div className="space-y-1.5">
          <Label>City</Label>
          <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Hebron" />
        </div>
        <div className="space-y-1.5">
          <Label>State</Label>
          <Input
            value={stateVal}
            onChange={(e) => setStateVal(e.target.value.toUpperCase())}
            placeholder="IN"
            maxLength={2}
          />
        </div>
        <div className="space-y-1.5">
          <Label>ZIP</Label>
          <Input value={zip} onChange={(e) => setZip(e.target.value)} placeholder="46341" required />
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
        <Label>Contact phone (optional)</Label>
        <Input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="So we can reach you about setup"
        />
      </div>

      <div className="space-y-2 rounded-lg border border-border p-4">
        <Label className="text-sm font-medium">When are you open?</Label>
        <BusinessHoursPicker value={hours} onChange={setHours} />
      </div>

      <div className="space-y-3 rounded-lg border border-border p-4">
        <Label className="text-sm font-medium">Network details (optional)</Label>
        <p className="text-xs text-muted-foreground">
          Optional. If you&apos;d like a hand getting your screen online, share how it connects and
          we&apos;ll help. Anything you enter is stored privately and only used for support.
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
                placeholder="Network password"
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
      </div>

      <p className="text-xs text-muted-foreground">
        Once your location is approved, we&apos;ll reach out to schedule a quick setup — we bring a
        Loop Network Fire Stick with the app already loaded and get it running on your TV. Nothing
        for you to download, plug into a computer, or configure.
      </p>

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Submitting…' : 'Submit venue'}
      </Button>
    </form>
  )
}
