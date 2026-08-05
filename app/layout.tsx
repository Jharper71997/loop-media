import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Sora } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { THEME_COOKIE, resolveTheme } from "@/lib/theme";
import {
  SITE_URL,
  SITE_NAME,
  SITE_CITY,
  SITE_REGION,
  SITE_DESCRIPTION,
} from "@/lib/site";
import { GoogleAnalytics } from "@/components/analytics/GoogleAnalytics";
import { NavClickTracker } from "@/components/analytics/NavClickTracker";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Display face for headings + the wordmark (geometric, premium).
const sora = Sora({
  variable: "--font-display",
  weight: ["600", "700", "800"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // metadataBase is what makes every relative URL below (and every canonical or
  // OG image a child page declares) resolve to an absolute production URL.
  // Without it Next emits relative OG tags, which crawlers and link unfurlers
  // both drop — it is the reason the site had no working link previews.
  metadataBase: new URL(SITE_URL),
  title: {
    // Children set only their own title; the brand and market get appended here
    // so no page has to remember them and none can drift.
    default: `${SITE_NAME} — Indoor TV Advertising in ${SITE_REGION}`,
    template: `%s — ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  // "Loop Media" (Nasdaq: LPTV) owns the generic "Loop" + TV advertising terms.
  // Competing for those is a losing fight, so the keyword surface here is local
  // and specific: the market, the venue types, and the buying intent.
  keywords: [
    `TV advertising ${SITE_REGION}`,
    `advertise in bars ${SITE_CITY} NC`,
    `digital signage advertising ${SITE_REGION}`,
    'indoor TV advertising',
    'local business advertising Onslow County',
    'gym and bar screen advertising',
  ],
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    locale: 'en_US',
    url: SITE_URL,
    title: `${SITE_NAME} — Indoor TV Advertising in ${SITE_REGION}`,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} — Indoor TV Advertising in ${SITE_REGION}`,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: "black-translucent" },
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  // Matches the light --background (the default theme); the phone browser chrome
  // should blend into the page, not band it with the old near-black.
  themeColor: "#fdfcfa",
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Resolve the theme server-side from the cookie so the correct theme class is
  // present on the very first paint — no client script, no flash of wrong theme.
  const theme = resolveTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html
      lang="en"
      className={`${theme} ${geistSans.variable} ${geistMono.variable} ${sora.variable} antialiased`}
    >
      <body className="flex min-h-dvh flex-col bg-background text-foreground">
        {children}
        <Toaster />
        <GoogleAnalytics />
        <NavClickTracker />
      </body>
    </html>
  );
}
