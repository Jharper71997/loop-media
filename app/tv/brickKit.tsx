// Shared brick-toy kit for the Brew Loop house ads. Both stories build from these
// pieces so they read as one world, and a change to the shuttle or the minifigure
// lands in both at once.
//
// Deliberately generic brick-toy styling — studs, C-clip hands, blocky vehicles —
// with no brand name, wordmark, or logo of any toy company anywhere in the frame.
//
// COUPLING TO WATCH: these components emit animation CLASS NAMES that they do not
// define. Whichever story renders them owns a <style> block that defines the class
// it passes in (wheel spin, head bob). Pass a class that doesn't exist and the part
// simply sits still — it won't error, so check the render, not the types.
//
// Every animated property in this kit is transform or opacity. A Fire Stick
// composites those on the GPU; animating width/colour/filter would re-rasterize
// each frame and stutter on the exact hardware this ships to.

// Brand palette, straight off the badge. `gold` is the brand gold; `goldLit` is the
// lighter tone the badge artwork actually uses, which is what the brick highlights
// are drawn in so the plastic looks moulded rather than flat.
export const C = {
  black: '#0a0a0b',
  gold: '#d4a333',
  goldLit: '#ecc14d',
  goldDim: '#8f6f22',
  // Minifigure skin. Brand gold sits close enough to the classic minifigure yellow
  // that one colour does both jobs — the figures read as brick toys AND on-palette.
  skin: '#dfb04a',
  skinLit: '#f0c766',
  // Graphite range for everything that isn't the Loop.
  ink: '#16171b',
  inkLit: '#22242a',
  graphite: '#33363d',
  graphiteLit: '#44484f',
  bone: '#d9dbe0', // the cruiser's door panel — black-and-white reads as police
  glass: '#0e1319',
  // The strobe. Blue only, no red: NC Highway Patrol runs blue, it reads as police
  // instantly, and it keeps red out of a black-and-gold frame.
  lamp: '#4d8ef7',
  lampLit: '#8fb8ff',
}

export const BADGE = '/brewloop-badge.png'

// A stud: the one detail that makes a rectangle read as a brick. Drawn as a squat
// cylinder (body + lit cap) rather than a flat circle, which is what gives the
// whole scene its moulded-plastic look at TV distance.
export function Stud({
  x, y, w = 26, fill, lit,
}: { x: number; y: number; w?: number; fill: string; lit: string }) {
  return (
    <g>
      <rect x={x} y={y - 9} width={w} height={10} rx={3} fill={fill} />
      <ellipse cx={x + w / 2} cy={y - 9} rx={w / 2} ry={5} fill={lit} />
    </g>
  )
}

// A brick with its top row of studs. `studs` is how many fit across the top; pass
// 0 for a brick something else is stacked on.
export function Brick({
  x, y, w, h, fill, lit, studs = 0, rx = 5,
}: { x: number; y: number; w: number; h: number; fill: string; lit: string; studs?: number; rx?: number }) {
  const gap = studs > 0 ? w / studs : 0
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={rx} fill={fill} />
      {/* Top highlight — bricks are moulded, not flat, and one lighter band across
          the top edge does more for that than any gradient. */}
      <rect x={x} y={y} width={w} height={Math.min(8, h / 3)} rx={rx / 2} fill={lit} opacity=".75" />
      {Array.from({ length: studs }, (_, i) => (
        <Stud key={i} x={x + i * gap + gap / 2 - 13} y={y} fill={fill} lit={lit} />
      ))}
    </g>
  )
}

// Wheel: black tyre, hub that actually turns. Rotating the tyre too would be
// invisible — a black circle looks identical at every angle.
export function BrickWheel({
  cx, cy, r, spin,
}: { cx: number; cy: number; r: number; spin: string }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="#101114" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.inkLit} strokeWidth="6" />
      <g className={`bk-spin-box ${spin}`}>
        <circle cx={cx} cy={cy} r={r * 0.52} fill={C.graphiteLit} />
        <circle cx={cx} cy={cy} r={r * 0.16} fill={C.graphite} />
        {[0, 60, 120].map((deg) => (
          <line
            key={deg}
            x1={cx - r * 0.44 * Math.cos((deg * Math.PI) / 180)}
            y1={cy - r * 0.44 * Math.sin((deg * Math.PI) / 180)}
            x2={cx + r * 0.44 * Math.cos((deg * Math.PI) / 180)}
            y2={cy + r * 0.44 * Math.sin((deg * Math.PI) / 180)}
            stroke={C.graphite}
            strokeWidth="5"
          />
        ))}
      </g>
    </g>
  )
}

// A minifigure head with its stud and face, drawn from the top-left of the head so
// it can be dropped into a bus window or a doorway on its own.
export function MinifigHead({
  x, y, w = 42, h = 46, mood = 'happy',
}: { x: number; y: number; w?: number; h?: number; mood?: 'happy' | 'party' }) {
  const cx = x + w / 2
  const eye = y + h * 0.39
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={9} fill={C.skin} />
      <rect x={x} y={y} width={w} height={8} rx={4} fill={C.skinLit} opacity=".85" />
      <Stud x={cx - 10} y={y} w={20} fill={C.skin} lit={C.skinLit} />
      <circle cx={cx - 9} cy={eye} r="4" fill="#141418" />
      <circle cx={cx + 9} cy={eye} r="4" fill="#141418" />
      {mood === 'party' ? (
        // Open grin. Two dots and a mouth is the whole emotional range of the
        // format, which is exactly why it works.
        <ellipse cx={cx} cy={eye + 14} rx="8" ry="6" fill="#141418" />
      ) : (
        <path
          d={`M${cx - 9} ${eye + 12} Q${cx} ${eye + 20} ${cx + 9} ${eye + 12}`}
          stroke="#141418"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
      )}
    </g>
  )
}

// Minifigure, feet on the origin so it drops straight onto a ground line.
// `armsUp` is both the universal caught-red-handed pose and the universal
// hands-in-the-air one, which is why the same figure works in both ads;
// `officer` gets the cap, the gold shield, and the clipboard.
export function Minifig({
  torso, torsoLit, armsUp, officer, mood,
}: {
  torso: string
  torsoLit: string
  armsUp?: boolean
  officer?: boolean
  mood?: 'oh-no' | 'party'
}) {
  return (
    <g>
      {/* Legs: hip block plus two bricks, with the gap between them left open —
          that gap is most of what makes the silhouette read as a minifigure. */}
      <rect x="-30" y="-72" width="60" height="18" rx="4" fill={C.ink} />
      <rect x="-28" y="-56" width="25" height="56" rx="4" fill={C.ink} />
      <rect x="3" y="-56" width="25" height="56" rx="4" fill={C.ink} />
      <rect x="-28" y="-56" width="25" height="7" rx="3" fill={C.inkLit} opacity=".8" />
      <rect x="3" y="-56" width="25" height="7" rx="3" fill={C.inkLit} opacity=".8" />

      {/* Torso: narrow at the shoulders, wide at the waist. */}
      <path d="M-25 -142 L25 -142 L33 -70 L-33 -70 Z" fill={torso} />
      <path d="M-25 -142 L25 -142 L26 -134 L-26 -134 Z" fill={torsoLit} opacity=".85" />

      {/* Arms. Thick round-capped strokes read as moulded plastic; the hand is the
          C-clip, drawn as an open ring. */}
      {armsUp ? (
        <g stroke={torso} strokeWidth="17" strokeLinecap="round" fill="none">
          <path d="M-24 -134 L-52 -172" />
          <path d="M24 -134 L52 -172" />
          <circle cx="-58" cy="-180" r="10" stroke={C.skin} strokeWidth="7" />
          <circle cx="58" cy="-180" r="10" stroke={C.skin} strokeWidth="7" />
        </g>
      ) : (
        <g stroke={torso} strokeWidth="17" strokeLinecap="round" fill="none">
          <path d="M-24 -134 L-44 -100" />
          <path d="M24 -134 L44 -104" />
          <circle cx="-48" cy="-94" r="10" stroke={C.skin} strokeWidth="7" />
          <circle cx="48" cy="-98" r="10" stroke={C.skin} strokeWidth="7" />
        </g>
      )}

      {/* Clipboard: the officer is writing, which is the whole punchline of that
          beat. It sits in the left hand. */}
      {officer && (
        <g>
          <rect x="-72" y="-118" width="46" height="56" rx="4" fill={C.bone} />
          <rect x="-72" y="-118" width="46" height="10" rx="4" fill={C.graphiteLit} />
          <rect x="-64" y="-100" width="30" height="5" rx="2" fill={C.graphite} />
          <rect x="-64" y="-88" width="30" height="5" rx="2" fill={C.graphite} />
          <rect x="-64" y="-76" width="20" height="5" rx="2" fill={C.graphite} />
          <path d="M-14 -128 L0 -132 L14 -128 L14 -114 L0 -104 L-14 -114 Z" fill={C.gold} />
        </g>
      )}

      <rect x="-10" y="-152" width="20" height="12" rx="3" fill={C.skin} />
      <MinifigHead x={-23} y={-198} w={46} h={50} mood={mood === 'party' ? 'party' : 'happy'} />
      {mood === 'oh-no' && (
        // Open mouth, eyebrows up. He knows.
        <>
          <ellipse cx="0" cy="-160" rx="9" ry="7" fill="#141418" />
          <path d="M-15 -188 L-4 -191" stroke="#141418" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M15 -188 L4 -191" stroke="#141418" strokeWidth="3.5" strokeLinecap="round" />
        </>
      )}

      {officer && (
        <>
          <path d="M-27 -196 L27 -196 L27 -204 L-27 -204 Z" fill={C.ink} />
          <path d="M-22 -204 L22 -204 L18 -222 L-18 -222 Z" fill={C.ink} />
          <path d="M-20 -212 L20 -212" stroke={C.gold} strokeWidth="5" />
        </>
      )}
    </g>
  )
}

const RIDER_SEATS = [46, 168, 290, 412]

// The Loop itself: the only gold object in either frame, built from the same brick
// kit as everything else so it belongs in the same world, and wearing the real badge
// artwork as livery rather than a redrawn logo. Wheels rest on y=224.
//
// `riders` controls how many seats are filled and `seatReveal` optionally gives each
// seat its own reveal class, so the party ad can fill them one at a time as people
// board. `bob` is the class each head animates with.
export function BrickShuttle({
  spin, bob, riders = RIDER_SEATS.length, doorOpen, seatReveal,
}: {
  spin: string
  bob: string
  riders?: number
  doorOpen?: boolean
  seatReveal?: string[]
}) {
  return (
    <g>
      {/* Roof course, body, then the window band cut into it. */}
      <Brick x={20} y={-22} w={600} h={26} fill={C.gold} lit={C.goldLit} studs={7} rx={6} />
      <Brick x={0} y={0} w={640} h={166} fill={C.gold} lit={C.goldLit} rx={12} />
      <rect x="0" y="118" width="640" height="6" fill={C.goldDim} opacity=".6" />

      {RIDER_SEATS.map((x, i) => (
        <g key={x}>
          <rect x={x} y="22" width="102" height="76" rx="8" fill={C.glass} />
          <rect x={x} y="22" width="102" height="7" rx="4" fill="#18202a" />
          {/* Nothing below the window line, because nothing below the window line is
              visible on a real bus either. */}
          {i < riders && (
            // Two nested groups on purpose: the outer one carries an optional
            // per-seat reveal (so the party ad can fill seats as people board) and
            // the inner one carries the bob. One element can't run both without the
            // shorthands clobbering each other.
            <g className={seatReveal?.[i] ?? ''}>
              <g className={bob} style={{ animationDelay: `${i * 180}ms` }}>
                <MinifigHead x={x + 30} y={52} mood="party" />
              </g>
            </g>
          )}
        </g>
      ))}

      {/* Door. Slides open at a stop so boarding reads without a caption. */}
      <rect x="556" y="26" width="60" height="118" rx="8" fill={C.glass} />
      {!doorOpen && <rect x="584" y="26" width="5" height="118" fill="#0a1017" />}
      {doorOpen && <rect x="556" y="26" width="8" height="118" rx="4" fill={C.goldDim} />}

      {/* Livery plate. Width is sized to the longest line ("BREW LOOP" at 15px with
          2.5 tracking is ~100px from x=84), so the wordmark can't spill onto the gold
          the way it did at 118. */}
      <rect x="20" y="108" width="200" height="52" rx="8" fill={C.black} opacity=".9" />
      <image href={BADGE} x="26" y="110" width="48" height="48" />
      <text x="84" y="130" fill={C.goldLit} fontSize="15" fontWeight="700" letterSpacing="2.5">
        JVILLE
      </text>
      <text x="84" y="150" fill={C.goldLit} fontSize="15" fontWeight="700" letterSpacing="2.5">
        BREW LOOP
      </text>

      <BrickWheel cx={148} cy={186} r={38} spin={spin} />
      <BrickWheel cx={506} cy={186} r={38} spin={spin} />
    </g>
  )
}
