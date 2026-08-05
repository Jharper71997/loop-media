// Real photos and clips of Loop screens hanging in real venues.
//
// ──────────────────────────────────────────────────────────────────────────
// HOW TO ADD ONE
//   1. Drop the file in `public/venues/` (e.g. public/venues/archies-bar.jpg).
//      Photos: landscape, at least 1600px wide, JPG or WebP.
//      Clips:  MP4, H.264, silent, under ~8s and ~5MB — they autoplay muted
//              and loop, so anything longer just costs the visitor data.
//   2. Add an entry below with the venue name and a plain caption.
//   3. That's it. The gallery on the home page renders itself from this list
//      and disappears entirely while the list is empty.
// ──────────────────────────────────────────────────────────────────────────
//
// Deliberately a hand-kept manifest and not a DB table: these are a handful of
// marketing photos that change a few times a year, and a table would need a
// migration plus an admin upload screen to serve the same three pictures.
//
// NOTHING GOES IN HERE THAT ISN'T A REAL LOOP SCREEN IN A REAL VENUE. The whole
// point of the section is proof — a stock photo of a TV in a bar would be the
// exact opposite of the thing it's trying to demonstrate.

export type InstallPhoto = {
  /** Path under /public, e.g. '/venues/archies-bar.jpg' */
  src: string
  /** 'video' autoplays muted + looped; anything else renders as a still. */
  kind?: 'image' | 'video'
  /** The venue it was taken at — shown as the caption's lead. */
  venue: string
  /** One short line of context, e.g. 'Above the bar, seen from every stool.' */
  caption: string
  /** Accessible description of what's in the frame. */
  alt: string
}

export const INSTALL_PHOTOS: InstallPhoto[] = []

export const hasInstallPhotos = () => INSTALL_PHOTOS.length > 0
