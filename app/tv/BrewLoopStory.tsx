// The Jville Brew Loop house ad, told as a 15-second brick-toy story instead of a
// card with a headline on it.
//
// Beat 1  a little brick car drives home, weaving
// Beat 2  the lights come up behind it
// Beat 3  both on the shoulder, driver out with his hands up, officer writing
// Beat 4  the Loop rolls past in the near lane, full of people, and parks on the
//         offer
//
// Why toy bricks: the same story told straight is a grim PSA nobody watches in a
// bar. Minifigures make it funny enough to hold a room and still land the number.
// Deliberately generic brick-toy styling — studs, C-clip hands, blocky vehicles —
// with no brand name, wordmark, or logo of any toy company anywhere in the frame.
//
// Rules the art obeys, and they are the whole reason it looks like this:
//   1. NOTHING depicts drinking. No bottles, no glasses, no bar. We can't market
//      alcohol, and we don't need to — the story is the traffic stop and the bill,
//      which is the part that actually changes a mind.
//   2. Brand palette only: black and gold. Gold is RATIONED — the shuttle, the
//      badge, and the type are the only gold objects, so the Loop is the thing the
//      eye lands on the instant it enters. Everything else is graphite. No reds.
//   3. Every animated property is transform or opacity. A Fire Stick composites
//      those on the GPU. Animating width/color/filter would re-rasterize each
//      frame and stutter on the exact hardware this ships to.
//
// Scene geometry, so the numbers below aren't magic:
//   road surface  y = 860      (near lane — the hero car, then the shuttle)
//   shoulder      y = 722      (where the stop happens, 138px "further away")
//   canvas        1920 x 1080  (matches the fixed TV stage)
//
// The master timeline is 15s and every keyframe is a percentage of it, so the
// whole thing is retimed by changing one duration.

// Brand palette, straight off the badge. `gold` is the brand gold; `goldLit` is the
// lighter tone the badge artwork actually uses, which is what the brick highlights
// are drawn in so the plastic looks moulded rather than flat.
const C = {
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
  boneLit: '#eceef1',
  glass: '#0e1319',
  // The strobe. Blue only, no red: NC Highway Patrol runs blue, it reads as police
  // instantly, and it keeps red out of a black-and-gold frame.
  lamp: '#4d8ef7',
  lampLit: '#8fb8ff',
}

const RIDER_SEATS = [46, 168, 290, 412]
const BADGE = '/brewloop-badge.png'

export function BrewLoopStory({ qrImage }: { qrImage: string }) {
  return (
    <div className="bl-stage">
      <style>{`
        .bl-stage {
          position: absolute; inset: 0; overflow: hidden;
          background: ${C.black}; color: #fff;
        }
        .bl-svg { position: absolute; inset: 0; width: 100%; height: 100% }

        /* Every rotating part needs its own box as the origin, otherwise SVG
           rotates around the ROOT viewBox origin and the wheel flies off screen. */
        .bl-spin-box { transform-box: fill-box; transform-origin: center }

        /* ---- master timeline (15s) ---------------------------------------- */

        /* The hero car. Enters fast, holds the middle of the frame while the
           weave reads, then decelerates up onto the shoulder and stays put — it is
           still on screen at the end, which is the entire point of the last beat. */
        @keyframes bl-car {
          0%   { transform: translateX(-560px) }
          16%  { transform: translateX(620px) }
          30%  { transform: translateX(900px) }
          40%  { transform: translateX(1160px) }
          52%  { transform: translate(1420px, -138px) }
          100% { transform: translate(1420px, -138px) }
        }
        .bl-car { animation: bl-car 15s cubic-bezier(.25,.6,.3,1) infinite both }

        /* The weave. Small on purpose: a cartoonish swerve reads as a joke, a
           slight drift reads as the thing that actually gets people pulled over. */
        @keyframes bl-swerve {
          0%   { transform: none }
          8%   { transform: translateY(6px) rotate(-1.4deg) }
          18%  { transform: translateY(-5px) rotate(1.1deg) }
          26%  { transform: translateY(8px) rotate(-1.6deg) }
          34%  { transform: translateY(-3px) rotate(.9deg) }
          44%, 100% { transform: none }
        }
        .bl-swerve {
          transform-box: fill-box; transform-origin: 50% 100%;
          animation: bl-swerve 15s ease-in-out infinite both;
        }

        /* The cruiser. Invisible until it has a reason to exist, then it closes
           the gap faster than the hero car is travelling. */
        @keyframes bl-cop {
          0%, 24% { opacity: 0; transform: translateX(-680px) }
          27%     { opacity: 1; transform: translateX(-540px) }
          40%     { opacity: 1; transform: translateX(340px) }
          52%     { opacity: 1; transform: translate(620px, -138px) }
          100%    { opacity: 1; transform: translate(620px, -138px) }
        }
        .bl-cop { animation: bl-cop 15s cubic-bezier(.25,.6,.3,1) infinite both }

        /* Wheels spin, then stop when the cars stop. One long rotation that
           flattens out at 52% costs nothing and sells the deceleration. */
        @keyframes bl-wheel {
          0%   { transform: rotate(0deg) }
          46%  { transform: rotate(2880deg) }
          52%, 100% { transform: rotate(2946deg) }
        }
        .bl-wheel { animation: bl-wheel 15s cubic-bezier(.25,.6,.3,1) infinite both }

        /* Baseplate studs and lane tiles scroll while anything is moving and hold
           while it isn't — the ground is what sells speed here, not the car. */
        @keyframes bl-road {
          0%   { transform: translateX(0) }
          46%  { transform: translateX(-960px) }
          70%  { transform: translateX(-960px) }
          92%, 100% { transform: translateX(-1440px) }
        }
        .bl-road { animation: bl-road 15s cubic-bezier(.25,.6,.3,1) infinite both }

        /* Light bar. steps(1) so it snaps like a real strobe instead of pulsing,
           and the far lamp runs a half-cycle behind the near one. */
        @keyframes bl-blink { 0%, 49% { opacity: 1 } 50%, 100% { opacity: .14 } }
        .bl-blink-a { animation: bl-blink .9s steps(1) infinite }
        .bl-blink-b { animation: bl-blink .9s steps(1) infinite; animation-delay: .45s }

        @keyframes bl-halo {
          0%, 49%   { opacity: .38; transform: scale(1.2) }
          50%, 100% { opacity: 0; transform: scale(.8) }
        }
        .bl-halo-box { transform-box: fill-box; transform-origin: center }
        .bl-halo-a { animation: bl-halo .9s steps(1) infinite }
        .bl-halo-b { animation: bl-halo .9s steps(1) infinite; animation-delay: .45s }

        /* Driver leaves the car and turns up on the shoulder. The head behind the
           windscreen has to go at the same moment or he is in two places at once. */
        @keyframes bl-out { 0%, 53% { opacity: 1 } 56%, 100% { opacity: 0 } }
        .bl-out { animation: bl-out 15s steps(1) infinite both }

        /* Minifigures don't ease. They pop into place, which is funnier and also
           happens to be how the toy actually moves in stop motion. */
        @keyframes bl-standing {
          0%, 54% { opacity: 0; transform: translateY(30px) }
          57%     { opacity: 1; transform: translateY(-10px) }
          60%, 100% { opacity: 1; transform: none }
        }
        .bl-standing { animation: bl-standing 15s steps(1, end) infinite both }

        /* The stop recedes once the Loop arrives — it stays on screen (that
           contrast IS the ad) but it stops competing with the offer. */
        @keyframes bl-recede { 0%, 70% { opacity: 1 } 88%, 100% { opacity: .28 } }
        .bl-recede { animation: bl-recede 15s ease-out infinite both }

        /* The Loop. Comes in on the near lane, overshoots a touch, settles. */
        @keyframes bl-bus {
          0%, 68% { transform: translateX(-880px) }
          86%     { transform: translateX(176px) }
          93%, 100% { transform: translateX(120px) }
        }
        .bl-bus { animation: bl-bus 15s cubic-bezier(.2,.75,.25,1) infinite both }

        @keyframes bl-wheel-late {
          0%, 68% { transform: rotate(0deg) }
          86%     { transform: rotate(1760deg) }
          93%, 100% { transform: rotate(1806deg) }
        }
        .bl-wheel-late { animation: bl-wheel-late 15s cubic-bezier(.2,.75,.25,1) infinite both }

        /* Gold wash on the road as the Loop arrives. Opacity only. */
        @keyframes bl-wash { 0%, 70% { opacity: 0 } 88%, 100% { opacity: 1 } }
        .bl-wash { opacity: 0; animation: bl-wash 15s ease-out infinite both }

        /* Riders. Stepped, not eased — brick figures hop, they don't glide.
           Staggered so they read as separate people, not one object. */
        @keyframes bl-bob { 0%, 49% { transform: translateY(0) } 50%, 100% { transform: translateY(-9px) } }
        .bl-bob { animation: bl-bob 1.1s steps(1) infinite }

        /* Waving arm on the back rider. Rotates about the shoulder. */
        @keyframes bl-wave { 0%, 49% { transform: rotate(0deg) } 50%, 100% { transform: rotate(-26deg) } }
        .bl-wave { transform-box: fill-box; transform-origin: 100% 100%; animation: bl-wave 1.1s steps(1) infinite }

        /* ---- captions ------------------------------------------------------
           Each line owns an explicit window rather than sharing one keyframe on a
           delay. The "both" fill is load-bearing: during a delay an element paints
           its NORMAL style, so without it every line shows at once, stacked.
           (No backticks anywhere in this block — it is all one template literal.) */
        @keyframes bl-cap1 {
          0%, 1%    { opacity: 0; transform: translateY(18px) }
          4%, 26%   { opacity: 1; transform: none }
          29%, 100% { opacity: 0; transform: translateY(-12px) }
        }
        @keyframes bl-cap2 {
          0%, 29%   { opacity: 0; transform: translateY(18px) }
          33%, 50%  { opacity: 1; transform: none }
          53%, 100% { opacity: 0; transform: translateY(-12px) }
        }
        @keyframes bl-cap3 {
          0%, 53%   { opacity: 0; transform: translateY(18px) }
          57%, 70%  { opacity: 1; transform: none }
          73%, 100% { opacity: 0; transform: translateY(-12px) }
        }
        @keyframes bl-cap4 {
          0%, 72%   { opacity: 0; transform: translateY(20px) }
          78%, 100% { opacity: 1; transform: none }
        }
        .bl-cap { position: absolute; opacity: 0 }
        .bl-cap1 { animation: bl-cap1 15s cubic-bezier(.22,1,.36,1) infinite both }
        .bl-cap2 { animation: bl-cap2 15s cubic-bezier(.22,1,.36,1) infinite both }
        .bl-cap3 { animation: bl-cap3 15s cubic-bezier(.22,1,.36,1) infinite both }
        .bl-cap4 { animation: bl-cap4 15s cubic-bezier(.22,1,.36,1) infinite both }

        @keyframes bl-offer {
          0%, 76%   { opacity: 0; transform: translateY(22px) }
          84%, 100% { opacity: 1; transform: none }
        }
        .bl-offer { opacity: 0; animation: bl-offer 15s cubic-bezier(.22,1,.36,1) infinite both }

        @keyframes bl-pulse { 0%, 100% { opacity: .3; transform: scale(1) } 50% { opacity: .65; transform: scale(1.07) } }
        .bl-pulse { animation: bl-pulse 3s ease-in-out infinite }

        /* ---- typography ----------------------------------------------------
           Brand type: gold on black, wide tracking on the mark, heavy weight on the
           payoff. No third colour anywhere. */
        .bl-mark {
          position: absolute; top: 54px; left: 96px;
          display: flex; align-items: center; gap: 24px;
        }
        .bl-mark-badge {
          width: 96px; height: 96px;
          filter: drop-shadow(0 0 26px rgba(212,163,51,.35));
        }
        .bl-mark-text {
          font-size: 30px; font-weight: 600; letter-spacing: .3em;
          text-transform: uppercase; color: rgba(236,193,77,.9);
        }
        .bl-rule {
          position: absolute; top: 172px; left: 96px; width: 232px; height: 3px;
          background: linear-gradient(90deg, ${C.gold}, rgba(212,163,51,0));
        }
        .bl-caps { position: absolute; top: 214px; left: 96px; right: 96px; height: 300px }
        .bl-line { font-size: 76px; font-weight: 700; line-height: 1.1; color: #f4f4f6 }
        .bl-sub  { margin-top: 18px; font-size: 38px; line-height: 1.25; color: rgba(244,244,246,.45) }
        .bl-tag  { font-size: 94px; font-weight: 900; line-height: 1.02; letter-spacing: -.01em; color: #f4f4f6 }
        .bl-tag-gold { color: ${C.goldLit} }

        .bl-offer-box {
          position: absolute; right: 96px; bottom: 84px;
          display: flex; align-items: center; gap: 40px;
        }
        .bl-price { text-align: right }
        .bl-price-num { font-size: 118px; font-weight: 900; line-height: .9; color: ${C.goldLit} }
        .bl-price-sub { margin-top: 14px; font-size: 30px; letter-spacing: .18em; text-transform: uppercase; color: rgba(244,244,246,.55) }
        .bl-qr-wrap { position: relative }
        .bl-qr-glow { position: absolute; inset: 0; border-radius: 28px; background: rgba(212,163,51,.45); filter: blur(26px) }
        .bl-qr {
          position: relative; width: 220px; height: 220px; border-radius: 26px;
          background: #fff; padding: 16px; box-shadow: 0 0 0 5px ${C.gold};
        }
        .bl-qr-cap { margin-top: 16px; text-align: center; font-size: 26px; color: rgba(244,244,246,.7) }

        /* ---- reduced motion -------------------------------------------------
           Not "animation: none" — that would leave four captions stacked and every
           actor at its starting mark, i.e. a car halfway off the left edge. Freeze
           the LAST frame instead: the stop on the shoulder, the Loop parked, the
           offer up. That is the frame worth showing as a still. */
        @media (prefers-reduced-motion: reduce) {
          .bl-blink-a, .bl-blink-b, .bl-halo-a, .bl-halo-b, .bl-bob, .bl-wave,
          .bl-pulse, .bl-wheel, .bl-wheel-late, .bl-swerve { animation: none }
          .bl-halo-a, .bl-halo-b { opacity: .3 }
          .bl-car  { animation: none; transform: translate(1420px, -138px) }
          .bl-cop  { animation: none; opacity: 1; transform: translate(620px, -138px) }
          .bl-road { animation: none; transform: translateX(-1440px) }
          .bl-bus  { animation: none; transform: translateX(120px) }
          .bl-wash { animation: none; opacity: 1 }
          .bl-out  { animation: none; opacity: 0 }
          .bl-standing { animation: none; opacity: 1; transform: none }
          .bl-recede   { animation: none; opacity: .28 }
          .bl-cap1, .bl-cap2, .bl-cap3 { animation: none; opacity: 0 }
          .bl-cap4  { animation: none; opacity: 1; transform: none }
          .bl-offer { animation: none; opacity: 1; transform: none }
        }
      `}</style>

      <svg viewBox="0 0 1920 1080" className="bl-svg" aria-hidden="true">
        <defs>
          <linearGradient id="bl-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0d0d10" />
            <stop offset="100%" stopColor={C.black} />
          </linearGradient>
          <radialGradient id="bl-wash-grad" cx="30%" cy="100%" r="70%">
            <stop offset="0%" stopColor={C.gold} stopOpacity=".18" />
            <stop offset="100%" stopColor={C.gold} stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width="1920" height="1080" fill="url(#bl-sky)" />

        {/* Road baseplate and the shoulder plate it pulls onto. */}
        <rect y="860" width="1920" height="220" fill="#0e0e11" />
        <rect y="856" width="1920" height="5" fill={C.inkLit} />
        <rect x="880" y="716" width="1040" height="6" fill={C.ink} />

        {/* The ground is a brick baseplate: a stud row along the surface plus 1x4
            lane tiles. Both scroll together so the motion stays consistent. */}
        <g className="bl-road">
          {Array.from({ length: 76 }, (_, i) => (
            <Stud key={`s${i}`} x={-1520 + i * 48} y={856} w={30} fill={C.ink} lit={C.inkLit} />
          ))}
          {Array.from({ length: 30 }, (_, i) => (
            <g key={`t${i}`}>
              <rect x={-1520 + i * 122} y="990" width="76" height="14" rx="3" fill={C.graphite} />
              <rect x={-1520 + i * 122} y="990" width="76" height="5" rx="2" fill={C.graphiteLit} />
            </g>
          ))}
        </g>

        {/* Gold wash under the Loop when it lands — the only time the road warms up. */}
        <rect className="bl-wash" y="560" width="1920" height="520" fill="url(#bl-wash-grad)" />

        {/* ---- the traffic stop ------------------------------------------- */}
        <g className="bl-recede">
          {/* Hero car. Outer group carries position, inner group carries the weave. */}
          <g className="bl-car">
            <g transform="translate(0, 742)">
              <g className="bl-swerve">
                <BrickCar body={C.graphite} bodyLit={C.graphiteLit} spin="bl-wheel" driverClass="bl-out" />
              </g>
            </g>
          </g>

          {/* Cruiser: same brick kit in black with a bone door panel and a gold
              star. Black-and-white with a badge reads as police without any red. */}
          <g className="bl-cop">
            <g transform="translate(0, 742)">
              <BrickCar body={C.ink} bodyLit={C.inkLit} spin="bl-wheel" cruiser />
            </g>
          </g>

          {/* Roadside: driver with his hands up, officer writing it down. They
              stand in the gap between the two cars.

              The placement transform MUST sit on an outer element and the animated
              class on an inner one. A CSS transform overrides an SVG transform
              ATTRIBUTE on the same element rather than composing with it, so putting
              both on one <g> drops the figures at the canvas origin — off-screen,
              full size, invisible. Same trap as the car groups above. */}
          <g transform="translate(1150, 722) scale(0.86)">
            <g className="bl-standing">
              <Minifig torso={C.graphite} torsoLit={C.graphiteLit} armsUp mood="oh-no" />
            </g>
          </g>
          <g transform="translate(1290, 722) scale(0.86)">
            <g className="bl-standing">
              <Minifig torso={C.ink} torsoLit={C.inkLit} officer />
            </g>
          </g>
        </g>

        {/* ---- the Loop --------------------------------------------------- */}
        <g className="bl-bus">
          <g transform="translate(0, 636)">
            <BrickShuttle />
          </g>
        </g>
      </svg>

      {/* Brand mark holds the whole 15s, so someone who glances up mid-story still
          knows whose ad this is. Real badge artwork, not a redraw. */}
      <div className="bl-mark">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={BADGE} alt="" className="bl-mark-badge" />
        <span className="bl-mark-text">Jville Brew Loop</span>
      </div>
      <div className="bl-rule" />

      {/* Copy voice: dry, not preachy. The picture already delivers the consequence,
          so the words stay light and let it land — a PSA register fights the bricks
          and nobody in a bar reads a lecture. Giving him a name is what makes it
          repeatable: "don't be Greg" is a thing friends say to each other, which is
          the whole point of an ad that plays where friends are sitting.
          Still never names alcohol; the story implies it and the art never shows it. */}
      <div className="bl-caps">
        <div className="bl-cap bl-cap1">
          <div className="bl-line">Greg was pretty sure he was fine.</div>
          <div className="bl-sub">It&apos;s a ten minute drive. He&apos;s done it a hundred times.</div>
        </div>
        <div className="bl-cap bl-cap2">
          <div className="bl-line">Greg was not fine.</div>
          <div className="bl-sub">It&apos;s now a very long night.</div>
        </div>
        <div className="bl-cap bl-cap3">
          <div className="bl-line">The most expensive ten minutes of Greg&apos;s life.</div>
          <div className="bl-sub">
            Fines, a lawyer, insurance, and a year of asking friends for rides.
          </div>
        </div>
        <div className="bl-cap bl-cap4">
          <div className="bl-tag">
            DON&apos;T BE GREG.
            <br />
            <span className="bl-tag-gold">RIDE THE LOOP.</span>
          </div>
        </div>
      </div>

      <div className="bl-offer bl-offer-box">
        <div className="bl-price">
          <div className="bl-price-num">$20</div>
          <div className="bl-price-sub">All night. Everybody home.</div>
        </div>
        {qrImage && (
          <div>
            <div className="bl-qr-wrap">
              <div className="bl-qr-glow bl-pulse" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrImage} alt="Scan to book" className="bl-qr" />
            </div>
            <div className="bl-qr-cap">Scan to book</div>
          </div>
        )}
      </div>
    </div>
  )
}

// A stud: the one detail that makes a rectangle read as a brick. Drawn as a squat
// cylinder (body + lit cap) rather than a flat circle, which is what gives the
// whole scene its moulded-plastic look at TV distance.
function Stud({ x, y, w = 26, fill, lit }: { x: number; y: number; w?: number; fill: string; lit: string }) {
  return (
    <g>
      <rect x={x} y={y - 9} width={w} height={10} rx={3} fill={fill} />
      <ellipse cx={x + w / 2} cy={y - 9} rx={w / 2} ry={5} fill={lit} />
    </g>
  )
}

// A brick with its top row of studs. `studs` is how many fit across the top; pass
// 0 for a brick something else is stacked on.
function Brick({
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
function BrickWheel({ cx, cy, r, spin }: { cx: number; cy: number; r: number; spin: string }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="#101114" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.inkLit} strokeWidth="6" />
      <g className={`bl-spin-box ${spin}`}>
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

// Brick-built car, side view, wheels resting on y=118 so the caller can drop it on
// a ground line with one translate. The cruiser is the SAME kit with a bone door
// panel and a light bar, which is what sells them as two objects from one box.
function BrickCar({
  body, bodyLit, spin, cruiser, driverClass,
}: { body: string; bodyLit: string; spin: string; cruiser?: boolean; driverClass?: string }) {
  return (
    <g>
      {/* Chassis plate, then the body course, then the cabin on top. */}
      <Brick x={0} y={44} w={430} h={44} fill={body} lit={bodyLit} />
      <Brick x={12} y={30} w={406} h={20} fill={C.ink} lit={C.inkLit} />
      <Brick x={108} y={-52} w={214} h={84} fill={body} lit={bodyLit} studs={cruiser ? 0 : 3} />
      {/* Windscreen slab and side glass. */}
      <path d="M118 -44 L168 -44 L168 18 L118 18 Z" fill={C.glass} />
      <path d="M182 -44 L312 -44 L312 18 L182 18 Z" fill={C.glass} />
      <g className={driverClass}>
        <rect x="206" y="-30" width="42" height="34" rx="7" fill={C.skin} />
        <circle cx="218" cy="-16" r="3.5" fill="#141418" />
        <circle cx="236" cy="-16" r="3.5" fill="#141418" />
      </g>
      {/* Exposed studs on the boot and bonnet. */}
      <Stud x={26} y={44} fill={body} lit={bodyLit} />
      <Stud x={62} y={44} fill={body} lit={bodyLit} />
      <Stud x={340} y={44} fill={body} lit={bodyLit} />
      <Stud x={376} y={44} fill={body} lit={bodyLit} />
      {/* Round headlight tile. */}
      <circle cx="416" cy="62" r="11" fill="#f2e6c6" />

      {cruiser && (
        <>
          {/* Halos bloom off the lamps. Kept tight (r=34, low alpha): at r=72 they
              covered the whole cabin, so the cruiser read as a blue blob instead of
              a car with its lights on. */}
          <g className="bl-halo-box">
            <circle className="bl-halo-a" cx="178" cy="-76" r="34" fill={C.lamp} />
            <circle className="bl-halo-b" cx="252" cy="-76" r="34" fill={C.lampLit} />
          </g>
          <Brick x={140} y={-70} w={150} h={18} fill={C.inkLit} lit={C.graphite} rx={4} />
          <rect x="146" y="-84" width="64" height="16" rx="5" fill={C.lamp} className="bl-blink-a" />
          <rect x="220" y="-84" width="64" height="16" rx="5" fill={C.lampLit} className="bl-blink-b" />
          {/* Bone door panel with a gold star. Text this small is mush at TV
              distance, so the badge does the talking. */}
          <rect x="24" y="46" width="86" height="40" rx="6" fill={C.bone} />
          <path
            d="M67 50 L72 64 L87 64 L75 73 L79 87 L67 78 L55 87 L59 73 L47 64 L62 64 Z"
            fill={C.gold}
          />
        </>
      )}

      <BrickWheel cx={104} cy={88} r={30} spin={spin} />
      <BrickWheel cx={334} cy={88} r={30} spin={spin} />
    </g>
  )
}

// Minifigure, feet on the origin so it drops straight onto a ground line.
// `armsUp` is the universal caught-red-handed pose and needs no caption;
// `officer` gets the cap, the gold badge, and the clipboard.
function Minifig({
  torso, torsoLit, armsUp, officer, mood,
}: { torso: string; torsoLit: string; armsUp?: boolean; officer?: boolean; mood?: 'oh-no' }) {
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

      {/* Clipboard: the officer is writing, which is the whole punchline of the
          beat. It sits in the left hand. */}
      {officer && (
        <g>
          <rect x="-72" y="-118" width="46" height="56" rx="4" fill={C.bone} />
          <rect x="-72" y="-118" width="46" height="10" rx="4" fill={C.graphiteLit} />
          <rect x="-64" y="-100" width="30" height="5" rx="2" fill={C.graphite} />
          <rect x="-64" y="-88" width="30" height="5" rx="2" fill={C.graphite} />
          <rect x="-64" y="-76" width="20" height="5" rx="2" fill={C.graphite} />
        </g>
      )}

      {/* Gold shield on the uniform. */}
      {officer && (
        <path d="M-14 -128 L0 -132 L14 -128 L14 -114 L0 -104 L-14 -114 Z" fill={C.gold} />
      )}

      {/* Neck, head, and the stud on top of it. */}
      <rect x="-10" y="-152" width="20" height="12" rx="3" fill={C.skin} />
      <rect x="-23" y="-198" width="46" height="50" rx="10" fill={C.skin} />
      <rect x="-23" y="-198" width="46" height="9" rx="4" fill={C.skinLit} opacity=".85" />
      <Stud x={-13} y={-198} fill={C.skin} lit={C.skinLit} />

      {/* Face. Two dots and a mouth is the entire emotional range of the format,
          which is exactly why it's funny. */}
      <circle cx="-9" cy="-178" r="4.5" fill="#141418" />
      <circle cx="9" cy="-178" r="4.5" fill="#141418" />
      {mood === 'oh-no' ? (
        // Open mouth, eyebrows up. He knows.
        <>
          <ellipse cx="0" cy="-160" rx="9" ry="7" fill="#141418" />
          <path d="M-15 -188 L-4 -191" stroke="#141418" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M15 -188 L4 -191" stroke="#141418" strokeWidth="3.5" strokeLinecap="round" />
        </>
      ) : (
        <path d="M-9 -163 Q0 -156 9 -163" stroke="#141418" strokeWidth="3.5" fill="none" strokeLinecap="round" />
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

// The Loop itself: the only gold object in the frame, built from the same brick kit
// as the cars so it belongs in the same world, and wearing the real badge artwork
// as livery rather than a redrawn logo. Wheels rest on y=224.
function BrickShuttle() {
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
          {/* A rider: head, stud, face. Nothing below the window line, because
              nothing below the window line is visible on a real bus either. */}
          <g className="bl-bob" style={{ animationDelay: `${i * 180}ms` }}>
            <rect x={x + 30} y="52" width="42" height="46" rx="9" fill={C.skin} />
            <rect x={x + 30} y="52" width="42" height="8" rx="4" fill={C.skinLit} opacity=".85" />
            <Stud x={x + 41} y={52} w={20} fill={C.skin} lit={C.skinLit} />
            <circle cx={x + 42} cy="70" r="4" fill="#141418" />
            <circle cx={x + 60} cy="70" r="4" fill="#141418" />
            <path
              d={`M${x + 42} 82 Q${x + 51} 90 ${x + 60} 82`}
              stroke="#141418"
              strokeWidth="3"
              fill="none"
              strokeLinecap="round"
            />
          </g>
        </g>
      ))}

      {/* Door, then the badge as livery on the flank — the real artwork, dropped on
          the gold panel the way it sits on a real shuttle wrap. */}
      <rect x="556" y="26" width="60" height="118" rx="8" fill={C.glass} />
      <rect x="584" y="26" width="5" height="118" fill="#0a1017" />
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

      <BrickWheel cx={148} cy={186} r={38} spin="bl-wheel-late" />
      <BrickWheel cx={506} cy={186} r={38} spin="bl-wheel-late" />
    </g>
  )
}
