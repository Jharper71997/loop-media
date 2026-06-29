import type { MetadataRoute } from "next";

// Web app manifest -> served at /manifest.webmanifest (Next auto-links it in <head>).
// Makes the site installable as a PWA and packageable as an Android TWA (Play Store).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Loop Network",
    short_name: "Loop Network",
    description:
      "Advertise where your customers already are — local screens across town.",
    start_url: "/",
    id: "/",
    display: "standalone",
    background_color: "#0a0a0b",
    theme_color: "#0a0a0b",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-192-maskable.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
