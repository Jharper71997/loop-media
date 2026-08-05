// The second Jville Brew Loop house ad: the same brick-toy world, but this one sells
// the night instead of the consequence. Runs the whole process end to end and names
// every partner bar.
//
// Beat 1  the shuttle rolls up, three minifigures board, seats fill
// Beat 2  the route runs — every partner bar scrolls past on a lit marquee
// Beat 3  hop off, hang out, hop back on
// Beat 4  the roster of every bar, the price, and the QR
//
// Rules the art obeys, and they are the whole reason it looks like this:
//   1. NOTHING depicts drinking. No bottles, no glasses, no taps. We can't market
//      alcohol, so the party reads through music, marquee bulbs, warm doorways and
//      people with their hands up. That constraint is why this looks like a night
//      out rather than a drink ad.
//   2. Brand palette only: black and gold. Gold is RATIONED to the shuttle, the
//      marquees, the badge and the type. Buildings are graphite. No reds.
//   3. Every animated property is transform or opacity. A Fire Stick composites
//      those on the GPU; animating width/colour/filter would re-rasterize each frame
//      and stutter on the exact hardware this ships to.
//
// THE BAR LIST IS A ROSTER, NOT A ROUTE. lib/bars.js in the-loop says it outright:
// there are 8 partner bars but the weekend route rotates, different subsets run Fri
// vs Sat and week to week. So the finale is headed "partner bars" and carries the
// rotation note, and no frame ever implies these are tonight's stops in this order.
// The 8th partner is still TBD in that data, so only the seven real ones appear.
//
// Scene geometry:
//   road surface  y = 860      (near lane — the shuttle)
//   storefronts   y = 720      (far side of the street)
//   canvas        1920 x 1080  (matches the fixed TV stage)
//
// The master timeline is 15s and every keyframe is a percentage of it.

import { C, BADGE, Brick, Minifig, MinifigHead, BrickShuttle, Stud } from './brickKit'

// Live partner bars, from the-loop's lib/bars.js. The 8th slot there is a TBD
// placeholder, so it is deliberately not on screen.
const PARTNER_BARS = [
  'The Angry Ginger',
  "Shirley V's",
  "Archie's",
  'Hideaway',
  'Twin Ravens',
  'Black Rose Tavern',
  'Unhinged Bar and Grill',
]

const BAR_PITCH = 430 // storefront width 380 + a 50px gap of night between them

export function BrewLoopPartyStory({ qrImage }: { qrImage: string }) {
  return (
    <div className="pty-stage">
      <style>{`
        .pty-stage {
          position: absolute; inset: 0; overflow: hidden;
          background: ${C.black}; color: #fff;
        }
        .pty-svg { position: absolute; inset: 0; width: 100%; height: 100% }

        /* Every rotating part needs its own box as the origin, otherwise SVG rotates
           around the ROOT viewBox origin and the wheel flies off screen. The brick
           kit emits this class name; this block has to define it. */
        .bk-spin-box { transform-box: fill-box; transform-origin: center }

        /* ---- master timeline (15s) -----------------------------------------
           Beats: roll up 0-9%, board 9-19%, run the route 19-67%, roster 67-100%. */

        /* The shuttle pulls up once and then holds the spot for the rest of the ad.
           The street moves past it instead, which is cheaper and reads better than
           driving the bus across the frame four times. */
        @keyframes pty-bus {
          0%   { transform: translateX(-880px) }
          9%   { transform: translateX(120px) }
          100% { transform: translateX(120px) }
        }
        .pty-bus { animation: pty-bus 15s cubic-bezier(.2,.75,.25,1) infinite both }

        /* Wheels turn only while the shuttle is actually moving: in to the stop,
           then again for the route, and still for the roster. */
        @keyframes pty-wheel {
          0%        { transform: rotate(0deg) }
          9%, 19%   { transform: rotate(430deg) }
          67%, 100% { transform: rotate(2600deg) }
        }
        .pty-wheel { animation: pty-wheel 15s cubic-bezier(.3,.5,.4,1) infinite both }

        /* A loaded shuttle sits on its springs. Tiny, and only while rolling. */
        @keyframes pty-jiggle {
          0%, 19%   { transform: translateY(0) }
          24%       { transform: translateY(-3px) }
          30%       { transform: translateY(2px) }
          38%       { transform: translateY(-2px) }
          46%       { transform: translateY(3px) }
          54%       { transform: translateY(-2px) }
          62%       { transform: translateY(1px) }
          67%, 100% { transform: translateY(0) }
        }
        .pty-jiggle { animation: pty-jiggle 15s ease-in-out infinite both }

        /* Boarding. Three figures on the curb go one at a time, and the matching
           seat fills a beat later. Each gets its OWN keyframes rather than sharing
           one on a delay: a delay shifts that element's whole 15s cycle, so it would
           still be showing its end state when the next loop starts. */
        @keyframes pty-board1 { 0%, 10% { opacity: 1 } 12%, 100% { opacity: 0 } }
        @keyframes pty-board2 { 0%, 13% { opacity: 1 } 15%, 100% { opacity: 0 } }
        @keyframes pty-board3 { 0%, 16% { opacity: 1 } 18%, 100% { opacity: 0 } }
        .pty-board1 { animation: pty-board1 15s steps(1) infinite both }
        .pty-board2 { animation: pty-board2 15s steps(1) infinite both }
        .pty-board3 { animation: pty-board3 15s steps(1) infinite both }

        @keyframes pty-seat2 { 0%, 11% { opacity: 0 } 12%, 100% { opacity: 1 } }
        @keyframes pty-seat3 { 0%, 14% { opacity: 0 } 15%, 100% { opacity: 1 } }
        @keyframes pty-seat4 { 0%, 17% { opacity: 0 } 18%, 100% { opacity: 1 } }
        .pty-seat2 { animation: pty-seat2 15s steps(1) infinite both }
        .pty-seat3 { animation: pty-seat3 15s steps(1) infinite both }
        .pty-seat4 { animation: pty-seat4 15s steps(1) infinite both }

        /* The street. Starts off the right edge, and by the end of the run the LAST
           storefront has reached centre frame, so every bar gets a readable pass. */
        @keyframes pty-strip {
          0%, 19% { transform: translateX(1920px) }
          67%     { transform: translateX(-1880px) }
          100%    { transform: translateX(-1880px) }
        }
        .pty-strip { animation: pty-strip 15s linear infinite both }

        /* Then it clears out so the roster owns the frame. */
        @keyframes pty-street-out { 0%, 66% { opacity: 1 } 74%, 100% { opacity: 0 } }
        .pty-street-out { animation: pty-street-out 15s ease-out infinite both }

        /* The pickup storefront. Its marquee reads YOUR CLOSEST STOP rather than a
           name, because "you board at whichever partner bar is nearest your house"
           is the single most misunderstood part of the process and a caption alone
           doesn't fix that. It clears out when the route starts. */
        @keyframes pty-pickup { 0%, 18% { opacity: 1 } 22%, 100% { opacity: 0 } }
        .pty-pickup { animation: pty-pickup 15s ease-out infinite both }

        /* Baseplate studs and lane tiles, moving only while the shuttle is running. */
        @keyframes pty-road {
          0%, 19%   { transform: translateX(0) }
          67%, 100% { transform: translateX(-1920px) }
        }
        .pty-road { animation: pty-road 15s linear infinite both }

        /* ---- short decorative loops ----------------------------------------
           These are NOT on the master timeline, so per-item delays are safe here.
           They only need to look alive, not to hit a mark. */
        @keyframes pty-bob { 0%, 49% { transform: translateY(0) } 50%, 100% { transform: translateY(-9px) } }
        .pty-bob { animation: pty-bob 1.1s steps(1) infinite }

        @keyframes pty-bulb { 0%, 49% { opacity: 1 } 50%, 100% { opacity: .25 } }
        .pty-bulb { animation: pty-bulb 1.6s steps(1) infinite }

        /* Music over the shuttle. Rises, drifts, fades. The only thing standing in
           for the noise of the night, since we can't show a drink. */
        @keyframes pty-note {
          0%   { opacity: 0; transform: translate(0, 0) scale(.7) }
          18%  { opacity: .95; transform: translate(6px, -30px) scale(1) }
          70%  { opacity: .5; transform: translate(-10px, -110px) scale(1) }
          100% { opacity: 0; transform: translate(4px, -170px) scale(.9) }
        }
        .pty-note { animation: pty-note 2.6s ease-out infinite }

        /* The music only exists once the night is underway. */
        @keyframes pty-music { 0%, 17% { opacity: 0 } 22%, 100% { opacity: 1 } }
        .pty-music { opacity: 0; animation: pty-music 15s ease-out infinite both }

        /* ---- captions ------------------------------------------------------
           Each line owns an explicit window rather than sharing one keyframe on a
           delay. The "both" fill is load-bearing: during a delay an element paints
           its NORMAL style, so without it every line shows at once, stacked.
           (No backticks anywhere in this block — it is all one template literal.) */
        @keyframes pty-cap1 {
          0%, 1%    { opacity: 0; transform: translateY(18px) }
          4%, 17%   { opacity: 1; transform: none }
          20%, 100% { opacity: 0; transform: translateY(-12px) }
        }
        @keyframes pty-cap2 {
          0%, 20%   { opacity: 0; transform: translateY(18px) }
          24%, 40%  { opacity: 1; transform: none }
          43%, 100% { opacity: 0; transform: translateY(-12px) }
        }
        @keyframes pty-cap3 {
          0%, 43%   { opacity: 0; transform: translateY(18px) }
          47%, 63%  { opacity: 1; transform: none }
          66%, 100% { opacity: 0; transform: translateY(-12px) }
        }
        @keyframes pty-cap4 {
          0%, 67%   { opacity: 0; transform: translateY(20px) }
          73%, 100% { opacity: 1; transform: none }
        }
        .pty-cap { position: absolute; opacity: 0 }
        .pty-cap1 { animation: pty-cap1 15s cubic-bezier(.22,1,.36,1) infinite both }
        .pty-cap2 { animation: pty-cap2 15s cubic-bezier(.22,1,.36,1) infinite both }
        .pty-cap3 { animation: pty-cap3 15s cubic-bezier(.22,1,.36,1) infinite both }
        .pty-cap4 { animation: pty-cap4 15s cubic-bezier(.22,1,.36,1) infinite both }

        /* The roster. One shared window for all seven names, not a stagger: a
           per-name delay would leave the last names still lit when the loop
           restarts on the pickup scene. */
        @keyframes pty-roster {
          0%, 68%   { opacity: 0; transform: translateY(22px) }
          76%, 100% { opacity: 1; transform: none }
        }
        .pty-roster { opacity: 0; animation: pty-roster 15s cubic-bezier(.22,1,.36,1) infinite both }

        @keyframes pty-offer {
          0%, 76%   { opacity: 0; transform: translateY(22px) }
          84%, 100% { opacity: 1; transform: none }
        }
        .pty-offer { opacity: 0; animation: pty-offer 15s cubic-bezier(.22,1,.36,1) infinite both }

        @keyframes pty-pulse { 0%, 100% { opacity: .3; transform: scale(1) } 50% { opacity: .65; transform: scale(1.07) } }
        .pty-pulse { animation: pty-pulse 3s ease-in-out infinite }

        /* ---- typography ---------------------------------------------------- */
        .pty-mark { position: absolute; top: 54px; left: 96px; display: flex; align-items: center; gap: 24px }
        .pty-mark-badge { width: 96px; height: 96px; filter: drop-shadow(0 0 26px rgba(212,163,51,.35)) }
        .pty-mark-text {
          font-size: 30px; font-weight: 600; letter-spacing: .3em;
          text-transform: uppercase; color: rgba(236,193,77,.9);
        }
        .pty-rule {
          position: absolute; top: 172px; left: 96px; width: 232px; height: 3px;
          background: linear-gradient(90deg, ${C.gold}, rgba(212,163,51,0));
        }
        .pty-caps { position: absolute; top: 214px; left: 96px; width: 1000px; height: 300px }
        .pty-line { font-size: 72px; font-weight: 700; line-height: 1.1; color: #f4f4f6 }
        .pty-sub  { margin-top: 18px; font-size: 36px; line-height: 1.25; color: rgba(244,244,246,.45) }
        .pty-tag  { font-size: 94px; font-weight: 900; line-height: 1.02; letter-spacing: -.01em; color: #f4f4f6 }
        .pty-tag-gold { color: ${C.goldLit} }

        /* Roster sits on the right, above the offer block, right-aligned so the
           ragged bar names read as a list rather than a paragraph. */
        .pty-roster-box { position: absolute; top: 236px; right: 96px; width: 760px; text-align: right }
        .pty-roster-head {
          font-size: 24px; font-weight: 700; letter-spacing: .26em; text-transform: uppercase;
          color: rgba(236,193,77,.85);
        }
        .pty-roster-rule {
          margin: 14px 0 18px auto; width: 190px; height: 2px;
          background: linear-gradient(270deg, ${C.gold}, rgba(212,163,51,0));
        }
        .pty-bar { font-size: 42px; font-weight: 700; line-height: 1.3; color: ${C.goldLit} }
        .pty-roster-note { margin-top: 18px; font-size: 24px; color: rgba(244,244,246,.42) }

        .pty-offer-box {
          position: absolute; right: 96px; bottom: 100px;
          display: flex; align-items: center; gap: 40px;
        }
        .pty-price { text-align: right }
        .pty-price-num { font-size: 112px; font-weight: 900; line-height: .9; color: ${C.goldLit} }
        .pty-price-sub {
          margin-top: 14px; font-size: 28px; letter-spacing: .16em;
          text-transform: uppercase; color: rgba(244,244,246,.55);
        }
        .pty-qr-wrap { position: relative }
        .pty-qr-glow { position: absolute; inset: 0; border-radius: 28px; background: rgba(212,163,51,.45); filter: blur(26px) }
        .pty-qr {
          position: relative; width: 200px; height: 200px; border-radius: 24px;
          background: #fff; padding: 14px; box-shadow: 0 0 0 5px ${C.gold};
        }
        .pty-qr-cap { margin-top: 14px; text-align: center; font-size: 24px; color: rgba(244,244,246,.7) }

        /* ---- reduced motion -------------------------------------------------
           Not "animation: none" — that would stack all four captions and leave the
           shuttle off the left edge. Freeze the LAST frame instead: shuttle parked,
           street gone, roster and offer up. That is the frame worth showing still. */
        @media (prefers-reduced-motion: reduce) {
          .pty-bob, .pty-bulb, .pty-note, .pty-pulse, .pty-wheel, .pty-jiggle { animation: none }
          .pty-bus   { animation: none; transform: translateX(120px) }
          .pty-strip { animation: none; transform: translateX(-1880px) }
          .pty-street-out, .pty-pickup { animation: none; opacity: 0 }
          .pty-road  { animation: none; transform: translateX(-1920px) }
          .pty-music { animation: none; opacity: 0 }
          .pty-board1, .pty-board2, .pty-board3 { animation: none; opacity: 0 }
          .pty-seat2, .pty-seat3, .pty-seat4 { animation: none; opacity: 1 }
          .pty-cap1, .pty-cap2, .pty-cap3 { animation: none; opacity: 0 }
          .pty-cap4 { animation: none; opacity: 1; transform: none }
          .pty-roster, .pty-offer { animation: none; opacity: 1; transform: none }
        }
      `}</style>

      <svg viewBox="0 0 1920 1080" className="pty-svg" aria-hidden="true">
        <defs>
          <linearGradient id="pty-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0d0d10" />
            <stop offset="100%" stopColor={C.black} />
          </linearGradient>
          <radialGradient id="pty-doorglow" cx="50%" cy="100%" r="70%">
            <stop offset="0%" stopColor={C.gold} stopOpacity=".3" />
            <stop offset="100%" stopColor={C.gold} stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width="1920" height="1080" fill="url(#pty-sky)" />

        {/* Road baseplate. */}
        <rect y="860" width="1920" height="220" fill="#0e0e11" />
        <rect y="856" width="1920" height="5" fill={C.inkLit} />

        <g className="pty-road">
          {Array.from({ length: 124 }, (_, i) => (
            <Stud key={`s${i}`} x={-1980 + i * 48} y={856} w={30} fill={C.ink} lit={C.inkLit} />
          ))}
          {Array.from({ length: 50 }, (_, i) => (
            <g key={`t${i}`}>
              <rect x={-1980 + i * 122} y="990" width="76" height="14" rx="3" fill={C.graphite} />
              <rect x={-1980 + i * 122} y="990" width="76" height="5" rx="2" fill={C.graphiteLit} />
            </g>
          ))}
        </g>

        {/* The street: every partner bar on a lit marquee, scrolling past. */}
        <g className="pty-street-out">
          <g className="pty-strip">
            {PARTNER_BARS.map((name, i) => (
              <g key={name} transform={`translate(${i * BAR_PITCH}, 720)`}>
                <BrickBar name={name} seed={i} />
              </g>
            ))}
          </g>
        </g>

        {/* The pickup: a partner bar with the rule on its marquee. Drawn before the
            figures so they stand in front of it. */}
        <g className="pty-pickup" transform="translate(760, 720)">
          <BrickBar name="YOUR CLOSEST STOP" seed={2} />
        </g>

        {/* Three friends on the curb, boarding one at a time. */}
        <g className="pty-board1" transform="translate(880, 860) scale(0.8)">
          <Minifig torso={C.graphite} torsoLit={C.graphiteLit} mood="party" />
        </g>
        <g className="pty-board2" transform="translate(1000, 860) scale(0.8)">
          <Minifig torso={C.ink} torsoLit={C.inkLit} armsUp mood="party" />
        </g>
        <g className="pty-board3" transform="translate(1120, 860) scale(0.8)">
          <Minifig torso={C.graphite} torsoLit={C.graphiteLit} mood="party" />
        </g>

        {/* The Loop. Outer group carries position, inner carries the spring. */}
        <g className="pty-bus">
          <g transform="translate(0, 636)">
            <g className="pty-jiggle">
              <BrickShuttle
                spin="pty-wheel"
                bob="pty-bob"
                seatReveal={['', 'pty-seat2', 'pty-seat3', 'pty-seat4']}
              />
              {/* Music over the roof. Short decorative loop, so staggering with
                  delays is fine here. */}
              <g className="pty-music">
                {[80, 210, 340, 470, 560].map((x, i) => (
                  <g key={x} className="pty-note" style={{ animationDelay: `${i * 420}ms` }}>
                    <Note x={x} y={-40} />
                  </g>
                ))}
              </g>
            </g>
          </g>
        </g>
      </svg>

      <div className="pty-mark">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={BADGE} alt="" className="pty-mark-badge" />
        <span className="pty-mark-text">Jville Brew Loop</span>
      </div>
      <div className="pty-rule" />

      {/* The process, one step per beat, in the order a rider actually lives it. */}
      <div className="pty-caps">
        <div className="pty-cap pty-cap1">
          <div className="pty-line">Start at the closest stop.</div>
          <div className="pty-sub">Book a seat, then board at whichever bar on that night's route is closest to you.</div>
        </div>
        <div className="pty-cap pty-cap2">
          <div className="pty-line">Then we run the route.</div>
          <div className="pty-sub">Five stops a night, about an hour and fifteen each.</div>
        </div>
        <div className="pty-cap pty-cap3">
          <div className="pty-line">Hop off. Hang out. Hop back on.</div>
          <div className="pty-sub">We text you ten minutes before we roll again.</div>
        </div>
        <div className="pty-cap pty-cap4">
          <div className="pty-tag">
            ONE NIGHT.
            <br />
            <span className="pty-tag-gold">EVERY BAR.</span>
          </div>
        </div>
      </div>

      {/* Roster, not a route: the weekend route rotates, so the note is doing real
          work rather than hedging. */}
      <div className="pty-roster pty-roster-box">
        <div className="pty-roster-head">Partner bars</div>
        <div className="pty-roster-rule" />
        {PARTNER_BARS.map((name) => (
          <div key={name} className="pty-bar">
            {name}
          </div>
        ))}
        <div className="pty-roster-note">Five of these every night. The route rotates.</div>
      </div>

      <div className="pty-offer pty-offer-box">
        <div className="pty-price">
          <div className="pty-price-num">$20</div>
          <div className="pty-price-sub">7:30 PM to 1:30 AM</div>
        </div>
        {qrImage && (
          <div>
            <div className="pty-qr-wrap">
              <div className="pty-qr-glow pty-pulse" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrImage} alt="Scan to book" className="pty-qr" />
            </div>
            <div className="pty-qr-cap">Scan to book</div>
          </div>
        )}
      </div>
    </div>
  )
}

// An eighth note, drawn rather than typed: the ♪ glyph isn't guaranteed on a Fire
// Stick's font stack, and a missing glyph renders as a tofu box in the middle of the
// ad. Two shapes are cheaper than that risk.
function Note({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`} fill={C.goldLit}>
      <ellipse cx="0" cy="0" rx="11" ry="8" transform="rotate(-20 0 0)" />
      <rect x="8" y="-34" width="5" height="34" rx="2" />
      <path d="M13 -34 q14 4 14 14 q-4 -8 -14 -8 z" />
    </g>
  )
}

// A partner bar, built from the same bricks as everything else. Baseline at y=0 so
// the caller drops it on the street with one translate. The marquee is the point:
// it is what actually names the bar, so it gets the gold, the bulbs and the size.
function BrickBar({ name, seed }: { name: string; seed: number }) {
  // Names run from 8 to 22 characters. Shrink the long ones rather than letting them
  // overflow the marquee or wrap onto the brickwork.
  const size = name.length > 18 ? 26 : name.length > 14 ? 30 : 34
  return (
    <g>
      {/* Warm light spilling out of the doorway. Sells "open and busy" for free. */}
      <rect x="80" y="-200" width="220" height="200" fill="url(#pty-doorglow)" />

      {/* Facade, then the roof course on top of it. */}
      <Brick x={0} y={-300} w={380} h={300} fill={C.graphite} lit={C.graphiteLit} rx={6} />
      <Brick x={-12} y={-326} w={404} h={28} fill={C.ink} lit={C.inkLit} studs={8} rx={6} />

      {/* Marquee. */}
      <rect x={26} y={-278} width={328} height={70} rx={8} fill={C.black} />
      <rect x={26} y={-278} width={328} height={70} rx={8} fill="none" stroke={C.gold} strokeWidth="4" />
      <text
        x={190}
        y={-232}
        fill={C.goldLit}
        fontSize={size}
        fontWeight="700"
        textAnchor="middle"
        letterSpacing="1"
      >
        {name}
      </text>
      {/* Bulbs along the top edge. Offset by seed so neighbouring signs don't
          twinkle in lockstep, which would read as one object. */}
      {Array.from({ length: 7 }, (_, i) => (
        <circle
          key={i}
          className="pty-bulb"
          cx={54 + i * 46}
          cy={-288}
          r="6"
          fill={C.goldLit}
          style={{ animationDelay: `${((i + seed) % 4) * 400}ms` }}
        />
      ))}

      {/* Windows with people in them, and a doorway. */}
      <rect x={36} y={-190} width={104} height={76} rx={8} fill={C.glass} />
      <rect x={240} y={-190} width={104} height={76} rx={8} fill={C.glass} />
      <g className="pty-bob" style={{ animationDelay: `${(seed % 3) * 260}ms` }}>
        <MinifigHead x={67} y={-160} w={38} h={42} mood="party" />
      </g>
      <g className="pty-bob" style={{ animationDelay: `${((seed + 1) % 3) * 260}ms` }}>
        <MinifigHead x={271} y={-160} w={38} h={42} mood="party" />
      </g>
      <rect x={158} y={-104} width={64} height={104} rx={6} fill={C.glass} />
      <rect x={158} y={-104} width={64} height={104} rx={6} fill="none" stroke={C.goldDim} strokeWidth="3" />
    </g>
  )
}
