import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Sora } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { THEME_COOKIE, resolveTheme } from "@/lib/theme";
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
  title: "Loop Network",
  description: "Advertise where your customers already are — local screens across town.",
  applicationName: "Loop Network",
  appleWebApp: { capable: true, title: "Loop Network", statusBarStyle: "black-translucent" },
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0d0c0a",
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
