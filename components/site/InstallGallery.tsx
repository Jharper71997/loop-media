import { INSTALL_PHOTOS } from '@/lib/installPhotos'
import { cn } from '@/lib/utils'

// "Here's what it actually looks like in the room." Renders nothing until real
// install photos exist (see lib/installPhotos.ts) — an empty grid of placeholder
// boxes would undercut the one thing this section is for.
export function InstallGallery({ className }: { className?: string }) {
  if (INSTALL_PHOTOS.length === 0) return null

  return (
    <section className={cn('border-t border-border bg-wash', className)}>
      <div className="mx-auto w-full max-w-6xl px-6 py-16">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            The screens
          </p>
          <h2 className="mt-2 text-balance font-heading text-2xl font-bold tracking-tight sm:text-3xl">
            Real TVs, in real rooms around town.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-pretty text-sm text-muted-foreground">
            Not a mockup. These are Loop screens hanging in local businesses, running the ads on
            this page.
          </p>
        </div>

        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {INSTALL_PHOTOS.map((p) => (
            <figure key={p.src} className="space-y-2.5">
              <div className="aspect-[4/3] overflow-hidden rounded-2xl bg-muted ring-1 ring-border">
                {p.kind === 'video' ? (
                  // Silent b-roll: no speech, so no caption track.
                  <video
                    src={p.src}
                    autoPlay
                    muted
                    loop
                    playsInline
                    preload="metadata"
                    aria-label={p.alt}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.src}
                    alt={p.alt}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
              <figcaption className="space-y-0.5">
                <p className="text-sm font-semibold">{p.venue}</p>
                <p className="text-sm text-muted-foreground">{p.caption}</p>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  )
}
