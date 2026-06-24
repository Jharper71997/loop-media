import { redirect } from 'next/navigation'

// The host "Advertise" tab lands here; send them straight into the buy flow.
export default function HostAdvertiseIndex() {
  redirect('/host/advertise/browse')
}
