// Structured data, emitted as a JSON-LD script tag.
//
// Rendered with dangerouslySetInnerHTML because that is the only way to get raw
// JSON inside a <script> — React would otherwise escape it into a string and
// every crawler would skip the block. The input is our own server-built object,
// never user text.
//
// `<` is escaped so a value containing "</script>" can't close the tag early.
// Nothing we feed this today contains markup, but venue names are operator-typed
// and this is the one place where that would become an injection.
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, '\\u003c'),
      }}
    />
  )
}
