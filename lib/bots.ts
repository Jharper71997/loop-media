// Cheap user-agent crawler/bot detection for QR-scan attribution. A QR on a
// physical screen is scanned by a phone camera, so almost all legitimate traffic
// is a mobile browser. Link-preview fetchers (iMessage, Slack, WhatsApp), search
// crawlers, and headless tools inflate "scans" without a real person behind them —
// we flag those so counted metrics (and the honest "a real person scanned this"
// copy) stay true.
//
// Intentionally conservative: a miss (a bot counted as human) is a small overcount;
// a false positive (a real phone flagged as a bot) silently drops a real scan, which
// is worse. So the list targets unambiguous bot/preview signatures only.

const BOT_UA =
  /(bot|crawl|spider|slurp|bingpreview|facebookexternalhit|facebot|embedly|quora link preview|whatsapp|telegrambot|discordbot|slackbot|slack-imgproxy|twitterbot|linkedinbot|pinterest|redditbot|applebot|googlebot|google-inspectiontool|petalbot|yandex|baiduspider|semrush|ahrefs|mj12bot|dotbot|headlesschrome|phantomjs|puppeteer|playwright|python-requests|axios|curl|wget|okhttp|go-http-client|java\/|libwww-perl|scrapy|preview)/i

export function isBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true // no UA at all = not a real phone camera scan
  return BOT_UA.test(userAgent)
}
