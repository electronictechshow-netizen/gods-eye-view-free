/**
 * Natural-region names answered from the bundled Natural Earth pack — "the Alps",
 * "the Sahara", "Gulf of Mexico" — with no key and no request.
 *
 * Why this exists: a keyless geocoder ranks by text match, so "the Alps" finds a
 * hamlet in Queensland and "the Andes" a street in Nairobi, where Google returns
 * the range. The camera code is built around Google's answer (a `natural_feature`
 * with a huge viewport, framed as a swath), and the outline code needs an anchor
 * INSIDE the range before it will accept the real polygon, so a wrong-continent
 * hit breaks both "take me to the Alps" and "outline the Alps". The pack knows the
 * real polygons, offline.
 *
 * Only what nobody searches for as a city, state or country is answered: ranges,
 * deserts, plateaus, plains, basins, valleys, deltas, gorges and the sea areas.
 * Islands, peninsulas, coasts and "geoareas" (Alaska, Florida, India, Cuba) are
 * handed on — the network geocoders place those correctly and their
 * administrative framing is the right one. Like the other offline geocoders this
 * answers only what it is certain of; everything else goes on untouched.
 *
 * The pack is injected (`lookup`) rather than imported, so this package keeps
 * reading no application state.
 */

/** Natural Earth feature classes that are places in nature, never a city or state. */
const NATURAL_CLASSES = new Set([
  'range/mtn',
  'desert',
  'plateau',
  'plain',
  'basin',
  'valley',
  'delta',
  'sea',
  'gulf',
  'bay',
  'strait',
  'channel',
  'sound',
  'fjord',
  'ocean',
  'lagoon',
  'inlet',
]);

/**
 * Names the classes above would answer that people ask for as an administrative
 * place ("Punjab" is a desert polygon in the pack and a province in everyone's
 * head). Folded the same way as a query.
 */
const ADMINISTRATIVE_NAMES = new Set(['punjab']);

/** A region name is a few words; anything longer is an address or a sentence. */
const MAX_QUERY_WORDS = 5;

/** How long a search waits for the pack to load before the network geocoders go ahead. */
const LOOKUP_BUDGET_MS = 5000;

/** The pack abbreviates; a spoken answer should not. */
const ABBREVIATIONS = [
  [/\bMts\b\.?/g, 'Mountains'],
  [/\bPlat\b\.?/g, 'Plateau'],
  [/\bPen\b\.?/g, 'Peninsula'],
];

function fold(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the /, '');
}

function readableName(name) {
  let label = String(name || '').trim();
  for (const [pattern, replacement] of ABBREVIATIONS)
    label = label.replace(pattern, replacement);
  return label.replace(/\s+/g, ' ').trim();
}

/** [[lon, lat], …] → its bounding box. */
function ringBounds(ring) {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLon, minLat, maxLon, maxLat };
}

/** Even-odd ray cast, ring = [[lon, lat], …] open or closed. */
function ringContains(ring, lat, lon) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    )
      inside = !inside;
  }
  return inside;
}

/** Area-weighted centroid in plain lon/lat — adequate at the scale of a range. */
function ringCentroid(ring) {
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [x0, y0] = ring[j];
    const [x1, y1] = ring[i];
    const cross = x0 * y1 - x1 * y0;
    twiceArea += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(twiceArea) < 1e-9) {
    const sum = ring.reduce(
      (acc, [lon, lat]) => ({ lon: acc.lon + lon, lat: acc.lat + lat }),
      { lon: 0, lat: 0 },
    );
    return { lon: sum.lon / ring.length, lat: sum.lat / ring.length };
  }
  return { lon: cx / (3 * twiceArea), lat: cy / (3 * twiceArea) };
}

/** Distance (degrees, east-west scaled by latitude) from a point to the ring's edge. */
function edgeDistance(ring, lat, lon) {
  const scale = Math.cos((lat * Math.PI) / 180);
  const px = lon * scale;
  let nearest = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const ax = ring[j][0] * scale;
    const ay = ring[j][1];
    const dx = ring[i][0] * scale - ax;
    const dy = ring[i][1] - ay;
    const length = dx * dx + dy * dy;
    const along = length
      ? Math.max(0, Math.min(1, ((px - ax) * dx + (lat - ay) * dy) / length))
      : 0;
    const gapX = ax + along * dx - px;
    const gapY = ay + along * dy - lat;
    nearest = Math.min(nearest, gapX * gapX + gapY * gapY);
  }
  return Math.sqrt(nearest);
}

/**
 * A point that is really INSIDE the ring, and well inside it.
 *
 * The centroid of an arc-shaped range (the Alps, the Carpathians, the Andes) can
 * fall outside it, and the outline code accepts a polygon only when it contains
 * the anchor, so the centroid alone would answer the camera and fail the outline.
 * The centroid is kept when it is inside and not hugging the edge; otherwise the
 * deepest point of a coarse grid is used, which sits in the body of the range
 * rather than on its coast. Null for a sliver thinner than the grid, which the
 * caller hands on.
 */
function anchorInside(ring, box) {
  const centre = ringCentroid(ring);
  const steps = 40;
  let deepest = null;
  let deepestDepth = 0;
  for (let i = 1; i < steps; i += 1) {
    for (let j = 1; j < steps; j += 1) {
      const lon = box.minLon + ((box.maxLon - box.minLon) * i) / steps;
      const lat = box.minLat + ((box.maxLat - box.minLat) * j) / steps;
      if (!ringContains(ring, lat, lon)) continue;
      const depth = edgeDistance(ring, lat, lon);
      if (depth > deepestDepth) {
        deepest = { lat, lon };
        deepestDepth = depth;
      }
    }
  }
  if (
    ringContains(ring, centre.lat, centre.lon) &&
    edgeDistance(ring, centre.lat, centre.lon) >= deepestDepth / 2
  )
    return centre;
  return deepest;
}

/**
 * The framing box for a ring. Normally its bounding box; but the swath the camera
 * flies looks at the CENTRE of that box, and for a range that curves away from
 * its box (the Andes) the centre is in the ocean beside it. When the centre is
 * not inside the ring, the same-sized box is re-centred on the anchor instead.
 * Null for a ring spanning more than half the globe: that is a ring across the
 * dateline, not a region, and the framing code reads such a box wrong.
 */
function framingBox(ring, box, anchor) {
  if (box.maxLon - box.minLon > 180) return null;
  const centreLat = (box.minLat + box.maxLat) / 2;
  const centreLon = (box.minLon + box.maxLon) / 2;
  let framed = box;
  if (!ringContains(ring, centreLat, centreLon)) {
    const halfLat = (box.maxLat - box.minLat) / 2;
    const halfLon = (box.maxLon - box.minLon) / 2;
    const shifted = {
      minLon: anchor.lon - halfLon,
      maxLon: anchor.lon + halfLon,
      minLat: Math.max(-90, anchor.lat - halfLat),
      maxLat: Math.min(90, anchor.lat + halfLat),
    };
    if (shifted.minLon >= -180 && shifted.maxLon <= 180) framed = shifted;
  }
  return {
    southwest: { lat: framed.minLat, lng: framed.minLon },
    northeast: { lat: framed.maxLat, lng: framed.maxLon },
  };
}

/** The pack's region → the geocode place shape the camera and outline code read. */
function regionToPlace(region) {
  if (!region || !Array.isArray(region.polygons)) return null;
  if (!NATURAL_CLASSES.has(String(region.featurecla || '').toLowerCase()))
    return null;
  if (ADMINISTRATIVE_NAMES.has(fold(region.name))) return null;

  // The largest ring carries the name (Andes has eleven); its box is the framing
  // box, and the anchor is inside the same ring the outline lookup will test.
  let main = null;
  let mainBox = null;
  let mainArea = -1;
  for (const ring of region.polygons) {
    if (!Array.isArray(ring) || ring.length < 3) continue;
    const box = ringBounds(ring);
    const area = (box.maxLon - box.minLon) * (box.maxLat - box.minLat);
    if (area > mainArea) {
      main = ring;
      mainBox = box;
      mainArea = area;
    }
  }
  if (!main || !(mainArea > 0)) return null;
  const anchor = anchorInside(main, mainBox);
  if (!anchor) return null;

  const viewport = framingBox(main, mainBox, anchor);
  const label = readableName(region.name);
  return {
    lat: anchor.lat,
    lng: anchor.lon,
    name: label,
    label,
    types: ['natural_feature'],
    // A bundled name has no ambiguity left for a nearby-places rescue to resolve.
    exact: true,
    viewport,
  };
}

/** `promise`, or a rejection once `ms` have passed — whichever comes first. */
function within(promise, ms) {
  let timer;
  const budget = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('region pack still loading')),
      ms,
    );
  });
  return Promise.race([promise, budget]).finally(() => clearTimeout(timer));
}

/**
 * Answer natural-region names from `lookup(query)` (the Natural Earth pack's
 * `findNaturalRegion`) ahead of the network geocoders.
 *
 * The pack loads on first use — about two and a half megabytes, which the dev
 * server has to transform — and a search must not wait on that behind the whole
 * chain's deadline. A lookup that has not answered within `budgetMs`, or that
 * throws, is "did not answer", not "no such place": the network geocoders go
 * ahead, the miss is not remembered, and the pack keeps loading so the next
 * search finds it ready.
 */
export function createNaturalRegionGeocoder({
  lookup = null,
  budgetMs = LOOKUP_BUDGET_MS,
} = {}) {
  return {
    async geocode(query, { signal } = {}) {
      signal?.throwIfAborted();
      const text = String(query ?? '').trim();
      if (
        !text ||
        typeof lookup !== 'function' ||
        /\d/.test(text) ||
        text.split(/\s+/).length > MAX_QUERY_WORDS
      )
        return { place: null, answered: true };
      let region;
      try {
        region = await within(lookup(text), budgetMs);
      } catch {
        signal?.throwIfAborted();
        return { place: null, answered: false };
      }
      signal?.throwIfAborted();
      return { place: regionToPlace(region), answered: true };
    },
  };
}
