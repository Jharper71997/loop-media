import Image from 'next/image'

// The full stacked Loop Network logo (emblem + wordmark + tagline) on a
// transparent background — for splash / login / signup, sitting on the dark bg.
export function BrandLockup({ className }: { className?: string }) {
  return (
    <Image
      src="/loop-network-logo.png"
      alt="Loop Network"
      width={420}
      height={420}
      priority
      className={className ?? 'h-36 w-auto'}
    />
  )
}
