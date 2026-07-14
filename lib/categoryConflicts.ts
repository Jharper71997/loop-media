// Category conflict groups — competitors a host venue should never run on its
// screens, BEYOND the exact-same-category host protection.
//
// Base rule (enforced elsewhere via exact match): a venue never runs an ad from
// its own line of business — a barbershop blocks other barbers.
//
// Some businesses compete ACROSS category lines, though. A bar and a steakhouse
// both fight for the same "going out tonight" dollar, so a food/drink host should
// not run a competing food/drink business on its TVs. A group captures that: two
// categories conflict when they share a group (or are the exact same category).
//
// Extend by adding a group below (e.g. an 'auto' group so tire shops / oil-change
// / auto-repair conflict). Both the placement engine (lib/placement.ts) and the
// browse map/cards (app/advertiser/browse) read `categoriesConflict`.

// Group slug -> the category IDs that mutually compete within it. IDs are stable
// (categories table primary keys); names in comments for readability.
const CONFLICT_GROUPS: Record<string, readonly string[]> = {
  // "Food & Drink": bars/nightlife + every restaurant type + cafes/dessert +
  // quick-serve. Locked with Jacob 2026-07-14 ("all food & drink" scope).
  'food-drink': [
    '2bf428b6-6c9c-4562-bfe3-a737dce8cf81', // Bar / Nightlife
    '52be63fa-edd9-44ed-80e1-86fdb68dac65', // Sports Bar
    '21eb616f-daef-43cf-bce5-230e68cdda36', // Brewery
    'd7bf61ce-cc74-4e7a-b935-fd4e876b0802', // Winery / Tasting Room
    '5cade4e0-1544-4d71-826a-8bca9b24ad08', // Hookah Lounge
    '17244deb-282e-45af-a4a0-75075694853c', // Casino
    '15c377ce-bfe8-4aa2-a202-b923ebba3b89', // Pool Hall / Billiards
    'b21ef9b0-0c36-47ef-8912-4f289d0cb9ef', // Restaurant
    '3d45469d-f2b8-4acd-9a8b-6f09302822f8', // Italian Restaurant
    '507e9774-43f9-4192-94f4-d7f0c2f8f968', // Mexican Restaurant
    '7f43574d-ad29-4650-b8de-35a14fb74972', // Seafood Restaurant
    'ac80d350-e36f-4869-b804-73174d30b1ea', // Steakhouse
    '618da7dc-29e2-425b-8ea7-c5c4de30fb8a', // Sushi / Japanese
    'ee40dda1-a13a-4168-afe5-ce66f92c8cc2', // Pizzeria
    '0e8a4d21-17d2-4732-bf46-a483c44b960f', // BBQ / Smokehouse
    '0cecdb75-f97c-433d-a302-1f4c0ab5db66', // Diner
    '87130d75-02ef-4769-8750-267dca5684f7', // Deli / Sandwich Shop
    '120ebcbf-df94-4ea8-bb53-14be4a4a96c0', // Fast Food / Quick Serve
    'caae1419-d349-4874-b4d6-f39645803d54', // Food Truck
    'ca82771d-56a5-4256-be85-610b0ba2b76b', // Catering
    'e5313649-cddf-4930-8875-7e43a02a9892', // Cafe / Bakery
    '54ac7fda-d5e7-4aa2-b393-434a0559d597', // Coffee Shop
    '0eadb5ba-baee-41f0-8552-ea7a3968f147', // Donut Shop
    '6a9bcf9b-93ca-4e8b-b615-c389526cb9ee', // Ice Cream / Dessert
    'f0217cd6-36ce-414c-aa9b-d30f788ae681', // Juice / Smoothie Bar
  ],
}

// categoryId -> group slug, for O(1) lookup.
const GROUP_BY_CATEGORY = new Map<string, string>()
for (const [group, ids] of Object.entries(CONFLICT_GROUPS))
  for (const id of ids) GROUP_BY_CATEGORY.set(id, group)

// The conflict group a category belongs to, or null if it competes only with its
// own exact category.
export function conflictGroupOf(categoryId?: string | null): string | null {
  if (!categoryId) return null
  return GROUP_BY_CATEGORY.get(categoryId) ?? null
}

// True when an advertiser in category `a` must NOT run on a venue in category `b`:
// the exact same category, or two categories sharing a conflict group. Returns
// false when either side has no category (unrestricted).
export function categoriesConflict(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const ga = GROUP_BY_CATEGORY.get(a)
  return ga != null && ga === GROUP_BY_CATEGORY.get(b)
}

// True only for a CROSS-category conflict (different categories in the same group),
// so the UI can distinguish "same business" from "competing business".
export function isCrossCategoryConflict(a?: string | null, b?: string | null): boolean {
  return categoriesConflict(a, b) && a !== b
}
