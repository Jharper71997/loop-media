import { ImageResponse } from 'next/og'
import { SITE_NAME, SITE_REGION } from '@/lib/site'

// Generated rather than a checked-in PNG: there was no 1200x630 asset in
// public/, and a card built from the same tokens as the site can't drift from a
// rebrand the way a hand-exported image does.
//
// Deliberately no custom font fetch. Loading Sora here means an outbound request
// during image generation, which is the usual way these routes fail in
// production; the system stack renders fine at this size.
export const alt = `${SITE_NAME} — indoor TV advertising in ${SITE_REGION}`
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '80px',
          // The brand's near-black, not the site's light default: an OG card sits
          // on someone else's feed, where the dark panel is what separates it
          // from the white chrome around it.
          background: '#0d0c0a',
          color: '#fdfcfa',
        }}
      >
        <div
          style={{
            fontSize: 26,
            letterSpacing: 8,
            fontWeight: 700,
            color: '#d4a333',
            display: 'flex',
          }}
        >
          LOOP NETWORK
        </div>
        <div
          style={{
            marginTop: 28,
            fontSize: 76,
            fontWeight: 800,
            lineHeight: 1.05,
            letterSpacing: -2,
            display: 'flex',
          }}
        >
          Indoor TV advertising
        </div>
        <div
          style={{
            fontSize: 76,
            fontWeight: 800,
            lineHeight: 1.05,
            letterSpacing: -2,
            color: '#d4a333',
            display: 'flex',
          }}
        >
          in {SITE_REGION}.
        </div>
        <div
          style={{
            marginTop: 34,
            fontSize: 30,
            color: 'rgba(253,252,250,0.66)',
            display: 'flex',
          }}
        >
          Your ad on the screens your customers already watch.
        </div>
      </div>
    ),
    size
  )
}
