import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const runtime = 'nodejs'

// AI fit-check for an uploaded ad image. Returns a plain-English verdict on
// whether the creative will look good full-screen on a 16:9 TV. No-ops cleanly
// when ANTHROPIC_API_KEY isn't configured, so the instant client-side check is
// always the floor and this is an enhancement on top.
type MediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
const ALLOWED: MediaType[] = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ skipped: true })
  }

  let body: { base64?: string; mediaType?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }
  const base64 = body.base64
  if (!base64) return NextResponse.json({ error: 'No image.' }, { status: 400 })
  const mediaType = (ALLOWED.includes(body.mediaType as MediaType)
    ? body.mediaType
    : 'image/jpeg') as MediaType

  const client = new Anthropic()
  try {
    const msg = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 400,
      system:
        'You review advertising images that play FULL-SCREEN on 16:9 TVs in bars and venues. ' +
        'Judge whether the image will look good edge-to-edge: (1) does it fill a 16:9 frame, ' +
        'or will it show large black bars / look stretched; (2) is any important text or logo ' +
        'cut off near the edges; (3) is the text large and high-contrast enough to read from ' +
        'across a room. Reply with ONLY a JSON object, no prose, shaped exactly: ' +
        '{"fits": boolean, "issues": string[], "suggestion": string}. fits=true means it looks ' +
        'good full-screen. issues are short plain-English problems (empty array if none). ' +
        'suggestion is one short fix tip (empty string if none).',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: 'Review this ad image for a 16:9 TV.' },
          ],
        },
      ],
    })

    const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim()
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end < 0) return NextResponse.json({ error: 'No verdict.' }, { status: 502 })
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      fits?: boolean
      issues?: string[]
      suggestion?: string
    }
    return NextResponse.json({
      fits: !!parsed.fits,
      issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 4) : [],
      suggestion: typeof parsed.suggestion === 'string' ? parsed.suggestion : '',
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Check failed.' },
      { status: 500 }
    )
  }
}
