import type { Metadata } from "next";
import { ScrollDepth } from "@/components/analytics/ScrollDepth";

export const metadata: Metadata = {
  title: "What's New | Loop Network",
  description: "Recent updates and improvements to the Loop Network platform.",
};

// ──────────────────────────────────────────────────────────────────────────
// HOW TO ADD A RELEASE NOTE
//
// 1. Find (or add) the month group at the TOP of RELEASES below. Months are in
//    reverse chronological order — newest month first.
// 2. Add a new object to that month's `entries`, ALSO newest-first:
//        { date: "2026-07-14", category: "New", headline: "...", detail: "..." }
//    - date:     ISO "YYYY-MM-DD". Powers <time> + the on-screen "Jul 14".
//    - category: "New" | "Improved" | "Fixed". Controls the colored tag.
//    - headline: 3–7 words, sentence case, no trailing period.
//    - detail:   2–3 plain sentences. What changed and why it matters to the
//                person using it (host or advertiser) — not internal wording.
// 3. That's it. No other file to touch. Keep it customer-facing: no PR numbers,
//    migration IDs, or security-audit detail.
// ──────────────────────────────────────────────────────────────────────────

type Category = "New" | "Improved" | "Fixed";

interface Entry {
  date: string; // ISO "YYYY-MM-DD"
  category: Category;
  headline: string;
  detail: string;
}

interface MonthGroup {
  month: string; // Display label, e.g. "July 2026"
  entries: Entry[]; // Newest first within the month
}

// Newest month first, newest entry first within each month.
const RELEASES: MonthGroup[] = [
  {
    month: "July 2026",
    entries: [
      {
        date: "2026-07-09",
        category: "Improved",
        headline: "Your venue on the map",
        detail:
          "Your business logo now shows on your pin and popup when advertisers browse the map, so your spot stands out. You can also update your venue name, hours, address, and logo yourself anytime from your dashboard.",
      },
      {
        date: "2026-07-08",
        category: "New",
        headline: "Put your own promo on your screen",
        detail:
          "Hosts can now feature their own business on their own TV, free. Add a promo with a title, image, and a scan link and it goes live in about a minute — find it under Promote on your dashboard.",
      },
      {
        date: "2026-07-08",
        category: "New",
        headline: "Take a guided demo before signing up",
        detail:
          "You can now walk through the full host and advertiser experience in a hands-on demo. Nothing is charged and no real account is created, so it's a safe way to see exactly how it works first.",
      },
      {
        date: "2026-07-08",
        category: "Improved",
        headline: "A better ad image editor",
        detail:
          "When you upload an ad you can now crop, zoom, rotate, and position your QR code on a true-to-screen preview. What you frame is exactly what plays on the TV.",
      },
    ],
  },
  {
    month: "June 2026",
    entries: [
      {
        date: "2026-06-20",
        category: "New",
        headline: "Phone trivia on your screens",
        detail:
          "Customers can scan a code and play live trivia on the TV, with a weekly leaderboard. It's an easy way to keep people watching the screen — and your ads — a little longer.",
      },
    ],
  },
];

const CATEGORY_STYLES: Record<Category, string> = {
  New: "border-primary/30 bg-primary/10 text-primary",
  Improved: "border-success/30 bg-success/10 text-success",
  Fixed: "border-warning/30 bg-warning/10 text-warning",
};

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Deterministic ISO → "Jul 8" (no Date object, so no timezone surprises).
function formatDay(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${MONTHS_SHORT[Number(month) - 1]} ${Number(day)}`;
}

function CategoryTag({ category }: { category: Category }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${CATEGORY_STYLES[category]}`}
    >
      {category}
    </span>
  );
}

export default function ChangelogPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <ScrollDepth page="changelog" />
      <header>
        <h1 className="font-heading text-3xl font-bold text-foreground">What&apos;s New</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Updates and improvements to the Loop Network platform, newest first.
          Check back here to see what we&apos;ve shipped for advertisers and venue hosts.
        </p>
      </header>

      {RELEASES.map((group) => (
        <section key={group.month} className="mt-12">
          <h2 className="font-heading text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            {group.month}
          </h2>

          <div className="mt-6 space-y-6">
            {group.entries.map((entry) => (
              <article
                key={entry.date + entry.headline}
                className="border-t border-border pt-6"
              >
                <div className="flex items-center gap-3">
                  <CategoryTag category={entry.category} />
                  <time
                    dateTime={entry.date}
                    className="font-mono text-xs text-muted-foreground"
                  >
                    {formatDay(entry.date)}
                  </time>
                </div>
                <h3 className="mt-2 font-heading text-lg font-semibold text-foreground">
                  {entry.headline}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {entry.detail}
                </p>
              </article>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
