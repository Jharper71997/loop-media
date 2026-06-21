import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Sora } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

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
};

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} ${sora.variable} antialiased`}
    >
      <body className="flex min-h-dvh flex-col bg-background text-foreground">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
