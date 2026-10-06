# God's Eye View — Free Edition: what changed, what was tested

An **unofficial community edition** of [God's Eye View](https://github.com/bilawalsidhu/gods-eye-view) by Bilawal Sidhu (MIT). It is not affiliated with or endorsed by the original author. This page is the honest record: what this edition changes, how it was checked, what is different from the original, and what is still limited.

- **Based on:** the original's version **0.2.1** (2 October 2026) **plus its `main` branch up to 5 October 2026** — every feature the original has published, including the weather layers, Recent Imagery, wildfire perimeters, local ADS-B receivers, the Cyber HUD, the MCP server and the Norway road cameras.
- **Built and checked:** 6 October 2026, on Windows 11, Node 24.19, npm 11, Chrome 152.
- **The idea:** the original needs a few *paid* keys for its best features. Here every one of them is replaced by a **free** one, and the app needs **seven free keys at most — all optional**.

---

## 1. The seven keys

These are the only keys. The key file (`.env`, opened in Notepad by `ADD-API-KEYS.bat`) and the in-app **POWER UP** panel list exactly these seven, in this order, each with its sign-up link next to it. None is required to start.

| # | Key | Unlocks | Free? |
|---|---|---|---|
| 1 | Cesium ion token | Photorealistic 3D cities + world terrain + Google/Bing place search | Free Community plan, personal / non-commercial use |
| 2 | Gemini API key | Voice control | Free tier, no card |
| 3 | Groq API key | AI summary line in the HUD | Free tier, no card |
| 4 | AISStream key | Live ships | Free |
| 5 | NASA FIRMS key | Live wildfires | Free |
| 6 | TomTom key | Live traffic colors | Free, no card |
| 7 | OpenSky API client | More flight-polling credits | Free |

There is also one **optional, off-by-default** spot in the key file's *advanced* section for a Google Maps Platform key. It needs a Google billing account with a card, Google charges beyond its free monthly allowance, nothing depends on it, and it is not in the panel.

---

## 2. Original vs. this edition — capability by capability

Every capability the original gets from a paid service has a free route here. "Verified" says how it was checked; "Difference" says what you may notice.

| Capability | The original used (paid) | This edition uses (free) | Verified | Difference you may notice |
|---|---|---|---|---|
| **Voice agent** — 30 actions (camera, layers, sensor looks, tracking, cockpit, drawing, analyst questions, radio, satellite passes, Cyber Sonar, …) plus the 25 data tools the original offers voice (weather, wind, cyclones, fire perimeters, tracks, cameras, places, routes, briefings) | A paid realtime voice service | **Gemini Live** over a same-origin WebSocket (key stays on your computer) | The original's own recorded-voice acceptance test, in click and hold-Space modes, on the final code; in an earlier pass also 10 spoken commands in both modes and the original's phrase-routing table | Different voice and wording; occasionally a different but valid choice of action; free-tier limits; free-tier privacy terms; no spend meter (nothing to meter) |
| **AI HUD summary** — five-word readout | A paid summary service | **Groq** (open-weight model) | Live call returns a five-word summary | Wording differs; plain built-in summary when no key |
| **Photorealistic 3D planet** | Google Map Tiles with a direct Google key | **Cesium ion**, which serves the same Google Photorealistic 3D Tiles | Live on the final code: 668 tiles content-ready at street level, 0 errors, Google credit shown | Personal / non-commercial plan with monthly caps; the tiles must be added once to *My Assets* |
| **Place search** ("fly to …", "outline …") | Google geocoding with a Google key | **Google geocoding through your Cesium ion token** (key #1 — no extra key; CesiumJS's own `IonGeocoderService`), then **Wikipedia**, then **Bing** through ion, then **Photon / Nominatim** (OpenStreetMap), plus bundled **Natural Earth** for ranges, deserts and seas | A 199-place benchmark with independent coordinates (below): **199 of 199 (100%)** with a Cesium token, **199 of 199 (100%)** with no key at all | An ion answer is used only when its label names what was asked; ion results carry no place types, so framing is read from the label and the size of the box |
| **Nearby places, named-place lookup** | Google Places | **Wikipedia** (which notable building is in view) + **Photon** (OpenStreetMap: streets and local places), no key | Live probes, unit tests | Long-tail shops are thinner than Google's |
| **Street-level fallback for cameras** | Google Street View | **KartaView** street-level photos (no key) | Unit tests + earlier live probe | Sparser coverage |
| **Address / place geocoding** | Google | **Nominatim** (no key) | Live probe | Public service, polite rate limits |
| **Outlines and "flights over Texas"** | — (free in the original too) | The original's own bundled country/state/county boundaries first; then OpenStreetMap's **Nominatim** for city outlines and named buildings and parks ("outline the Pentagon"), which the original reads from Overpass servers that are off by default | Live: flights over Texas / Norway / California / France counted in 0.2 s or less; Texas outline drawn in 1.6 s; the Pentagon (63 points), Central Park (38) and the Colosseum (27) outlined in 1–2 s | Outlines of unnamed buildings need an Overpass server you run |

Everything else — flights, military flights, ships, satellites and their pass predictions, earthquakes, fires and wildfire perimeters, traffic (OpenFreeMap + TomTom roads), public cameras (now including Norway), ALPR cameras, mapped installations, radio, transit, bike share, directions, launches, wind, observed weather, cyclones, Recent Imagery, local ADS-B receivers and the MCP server — is the original's own code and sources; the few places this edition touches are listed in section 3 and in the file list at the end.

---

## 3. Bugs found in the free-key layer — and fixed

Testing found real bugs. All are fixed and covered by tests. Almost all were in the free-key replacement layer; the two exceptions are noted below (the cross-site exposure also existed in the original at 0.1.1 — the original fixed its own in 0.2.1 — and the public-map-server resilience is shared with the original's design).

**Voice**
- First press of hold-Space showed "VOICE UNAVAILABLE" (the wrong transport started before the key was checked).
- Releasing Space never ended the turn, so Gemini kept waiting.
- The first words after pressing the mic were lost (audio was sent before the session was ready).
- A sentence with two commands made Gemini answer twice or run actions again (results were answered one by one; they are now answered together).
- "Zoom out and turn on the radio" picked a station but never started it or handed over the speaker — found by re-running the original's own acceptance test, fixed, and pinned with regression tests.
- "Turn on the radio" inside a longer sentence was occasionally understood as "show the radio markers"; the rule is now repeated where Gemini loses it.
- The no-key message pointed to a key this edition does not use; it now says where to get the free Gemini key.

**Security**
- Any website open in your browser could use the local server — including the voice relay with your Gemini key. Cross-site requests are now refused (HTTP and WebSocket).

**Data and setup**
- Road traffic, outlines and installations could hang when OpenStreetMap's public "Overpass" servers were slow or blocked. The September build worked around it with mirrors and time limits; this build follows the original's 0.2.0 design instead, which uses no public Overpass server at all by default (see section 5).
- Two bundled map-data files failed to load in the dev server.
- The AISStream, TomTom and OpenSky "get a key" links were wrong or outdated.
- Messages about the missing 3D key pointed to a paid route; they now point to the free Cesium path.
- Place names resolved to a same-named place on the wrong continent, because the keyless place search ranks by text: "the Alps" went to a hamlet in Queensland, "the Andes" to a street in Nairobi, "the Sahara" to a motorway, "the Colosseum" to a reservoir in Goa, "Chernobyl" to a town in South Africa, "Petra" to a village in England, "Big Ben" to Queensland, "the Hollywood sign" to Ireland — and "outline the Alps" failed. In a sweep of 49 well-known places, 13 landed wrong. Two fixes: mountain ranges, deserts, plateaus, plains, basins, deltas and sea areas now resolve from the bundled Natural Earth regions (offline, anchored inside the real outline), and other well-known places are looked up on Wikipedia first (only when an article carries exactly that name; OpenStreetMap still supplies the framing). Countries, states, cities and islands, and anything Wikipedia is unsure of, still go to the place search.

**This pass (6 October 2026: the original's latest version, accuracy, speed, macOS/Linux)**
- **Brought up to the original's latest:** its 0.2.0 and 0.2.1 releases and the 20 commits on its main branch after them (715 files changed in all) are merged in, with the seven free keys and the Gemini / Groq replacements kept. The original's new voice tools reach Gemini too: 55 declarations (30 actions + 25 data tools), checked live with the recorded-voice test.
- **Place search asks Google through the Cesium ion token you already have** (key #1), as Google's 3D tiles expect; an answer that does not name what was asked, or a namesake town ("Lake Geneva, WI" for Lake Geneva), is passed on to Wikipedia and the rest of the chain. A box across the 180th meridian (Alaska) is centred correctly.
- **Wikipedia lookups** follow redirects ("Pyramids of Giza" → the Giza pyramid complex), ask acronyms by their exact title ("LAX" is the airport, "Lax" a disambiguation page), answer countries and states with OpenStreetMap's own outline box (Photon put "Japan" in Missouri), never frame a river by the nearest café, confirm a lake by its OpenStreetMap water outline (the Dead Sea had been sent to a road named after it), and allow six seconds per request.
- **City outlines and named buildings without Overpass:** a Nominatim route (one shared one-request-per-second queue, answers kept for a day) supplies city boundaries and the outlines of named buildings and parks; Mapped Installations fall back to the keyless map tiles when a configured Overpass fails.
- **Rendering quality calibrated to the machine** (see *Smooth on slow computers* in the guide), and the lighter levels now also draw fewer road-traffic cars — 60% and 25% of the original's budget; the original's level is unchanged. Measured on the final code at street level with live traffic: CPU time per frame 17.7 ms at the original's settings → 10.8 ms at the lightest level (median of three runs), and 10.1 → 5.8 ms with traffic off. Before the merge, on a software renderer, the median frame time fell from 442 ms to 296 ms.
- **macOS / Linux launchers** (`START-HERE-MAC.command`, `START-HERE-MAC-LINUX.sh`, `ADD-API-KEYS-MAC.command`, `ADD-API-KEYS.sh`) with the executable bit set inside the zip.
- The voice and summary endpoints are now rate-limited by default (30 per minute per client, `GEV_RATELIMIT_VOICE_PER_MIN=0` turns it off), as the original's cost endpoints are.
- **A crash fixed before release:** in a busy scene (London with CCTV on), lowering the rendering quality mid-session could stop rendering with "primitive.isDestroyed is not a function". The cause was this edition's quality governor walking into marker collections; it now walks only primitive collections and can never stop rendering, and a test reproduces the case.
- **The test suite passes in the unzipped package, not only in a git checkout:** one of the original's newer tests searched the code with `git grep`, which fails outside a checkout; it now reads the files directly when git is not there, and still catches the mistake it guards against.

**Earlier pass (removing the paid services completely)**
- The paid voice and summary services are gone from the code, the key file, the POWER UP panel, the docs and the launcher scripts — no key slot, no setting, no endpoint, no price table, no cost meter. The voice code now runs on one transport only.
- The HUD route was renamed (`/api/hud-summary`) and the voice rate-limit setting is `GEV_RATELIMIT_VOICE_PER_MIN`.

---

## 4. Verification report

Everything below was run on **6 October 2026** on Windows 11 with Node 24.19, npm 11 and Chrome 152 (driven with Puppeteer), on a PC with an NVIDIA RTX 2060. The live checks used the builder's own free keys, kept in a throw-away copy outside the package — **no key ships in this folder**, and the package is scanned for key values and key-shaped strings when it is built.

**Automated checks — on the project folder, then again on the unzipped package**

| Check | Result |
|---|---|
| Unit and integration tests (`npm test`) | **5,752 tests, 5,742 pass, 0 fail**, 10 skipped (the original's own tests that only apply on macOS/Linux or other Node versions) |
| Source-boundary and import-direction checks | pass |
| Code-format check | pass |
| Production build (`vite build`) | pass |
| `npm run doctor` | pass |
| Fresh unzip → `npm ci` → doctor → tests → build | **Pass**: no key file inside; `npm ci`, doctor, 5,752 tests (5,742 pass, 0 fail, 10 skipped) and the production build; the boundary and format checks also pass on the unzipped files |
| First run of `START-HERE-WINDOWS.bat` on the unzipped package, answering "no" to the Notepad question | **Pass**: it installed the app, created the key file and started the app, which answered after 10 s on this PC (npm's download cache was already warm; on a new computer the one-time install downloads about 200 MB) |
| `START-HERE-MAC-LINUX.sh` under bash (Git Bash on Windows — not a real Mac or Linux machine) | **Pass**: it installed the app, created the key file with Unix line endings (the same text as `.env.example`) and started the app, which answered after 10 s |
| First screen with no keys | **Pass**: the globe draws, the loading screen clears, and POWER UP shows "7 KEYS WAITING" with exactly the seven keys in order, each with its https sign-up link |
| POWER UP save → restart → remove, with a dummy value | **Pass**, 11 of 11 checks: the value is saved to `.env`, the server restarts and reports the key as set, the panel shows it as saved without showing the value, and Remove takes it out again |

**Live, with real keys — the app itself, driven in Chrome**

| Check | Result |
|---|---|
| Voice: the original's own recorded-voice acceptance test ("Go to full globe view and then turn on the radio"), simulated microphone | **Pass** in both modes (click to talk, and hold Space to talk): the camera went to the full globe and the radio started playing. Gemini received all 55 tools (30 actions + 25 data tools) |
| Place search through the app ("fly to …"): Pyramids of Giza, the Suez Canal, Chernobyl, Pearl Harbor, Japan, Norway, MIT, Alaska, the Nile, Cairo | **10 of 10** landed on the right place (Pyramids of Giza 0 km off, MIT 0 km, Chernobyl 1 km, Pearl Harbor 2 km); the Google credit appears on the credit line |
| "How many flights are over Texas / Norway / California / France?" | Each answered in 0.2 s or less, naming the area it counted: Texas 100, California 96, France 7, Norway 0; a follow-up question re-filtered the same answer. As in the original, a count covers the flights the app has loaded at that moment, so an area far from the camera (Norway here; the camera was over Texas) can read 0 |
| Outline "Texas" (state boundary) | Drawn in 1.6 s from the original's bundled state boundary (331 points) |
| Road traffic at the Texas Capitol | First cars after 1.0 s; 2,841 cars on TomTom + OpenStreetMap roads, live (RTX 2060) |
| The original's newer tools, through the same runner voice uses | Live data from wind (65,160 arrows), tropical cyclones (1 active storm), ALPR cameras (4 in view), wildfire perimeters (107) and the mapped-installations search (1 installation within 30 km, 3.1 s). Weather radar showed the Texas overview but reported "frame unavailable" at city zoom. Recent Imagery and Local ADS-B stay empty until you pick an area or connect a receiver |
| MCP server (`npm run mcp`), as Claude Desktop would start it | **Pass** on the unzipped package with no keys: 30 tools listed; earthquakes worldwide (33, in 0.4 s) and in Japan (3, in 3.4 s); aircraft over Texas (760, in 1.9 s) |
| Rendering quality, chosen automatically | "standard" on the RTX 2060; "minimal" on a software renderer |

**Place search — benchmark of 199 places with independently known coordinates** (64 landmarks, 41 natural features, 45 cities, 21 countries and regions, 28 airports, universities and stadiums; a hit is the camera's target within a per-place tolerance, or the place inside the answer's box)

| Configuration | Result |
|---|---|
| With a Cesium ion token (the app's chain: Google via ion → Wikipedia → Bing via ion → Photon) | **199 of 199 (100%)** — landmarks 64/64, natural features 41/41, cities 45/45, countries and regions 21/21, airports, universities and stadiums 28/28 |
| No key at all (Natural Earth → Wikipedia → Photon), one search every few seconds | **199 of 199 (100%)** — landmarks 64/64, natural features 41/41, cities 45/45, countries and regions 21/21, airports, universities and stadiums 28/28 |

The run with a Cesium token used the merged code of 6 October, before the last two place-search fixes (both in the Wikipedia step, which comes after Google); the run with no key used the final code. With no key, Wikipedia allows only a few quick searches in a row (it answered HTTP 429 after about seven), so that run left six seconds between searches; at a person's pace this does not come up. The one miss found along the way, "the Dead Sea" sent to a road named after it, was fixed before the final run.

**Smoothness — measured**

| Check | Result |
|---|---|
| CPU time per frame at street level with live road traffic (Texas Capitol), RTX 2060, final code — median of three runs | 17.7 ms at the original's settings (about 2,840 cars) → **10.8 ms** at the lightest level (1,500 cars) |
| The same view with traffic off, final code | 10.1 ms → **5.8 ms** |
| Software renderer (no GPU at all — the worst case), measured before the merge | median frame time 442 ms → **296 ms** at the lightest level |
| Bare globe, RTX 2060, measured before the merge | 3 ms of CPU per frame; no long main-thread tasks |

Headless Chrome caps the frame rate during these runs, so CPU time per frame is the comparable figure: the lower it is, the more headroom a slower computer has for a smooth picture.

**What was not tested**

- A physical microphone (a simulated one was used, as above).
- A real Mac or Linux machine, or any browser other than Chrome.
- The optional Google Maps key path (it is off by default and nothing depends on it).
- A Local ADS-B receiver (needs your own radio hardware) and Recent Imagery exports (need an area you select).
- Months of use: public data services change, so a source that works today may not tomorrow.

---

## 5. Known limits and honest differences

- **Gemini is not word-for-word the original's voice agent.** It has its own voice and wording, can pick a different (valid) action for an ambiguous phrase, and the free tier has per-minute and per-day limits set by Google. Name places and layers plainly for the best results.
- **Privacy on the free Gemini tier:** Google may use what you say, and what the agent sends with it (map-view details, a screenshot at street level), to improve its products, and human reviewers may read it. Do not say anything private.
- **Overpass is not needed.** Like the original since 0.2.0, this edition uses no public Overpass server by default; traffic, ALPR cameras, installations, boundaries and named outlines all work without one. Only outlines of unnamed buildings need an Overpass instance you run (key file, advanced section). This edition does not disguise its name to get past public servers that refuse it.
- **Place search** is Google's with a Cesium token (passed through Cesium ion, which counts a monthly geocode allowance on your own account) and Wikipedia + OpenStreetMap without one. The names you search are sent to Cesium ion and on to Google or Microsoft. A vague name can still resolve somewhere unexpected — add the country or city.
- **Cesium's free plan is personal and non-commercial**, with monthly caps (15 GB streaming, 1,000 Google 3D sessions — roughly one per app launch). It also needs the one-time *Add to my assets* step. For commercial use you need your own Cesium plan or your own Google key.
- **Public data services** (CelesTrak, OpenSky, USGS, adsb.lol, Photon, Nominatim, Overpass, KartaView, Wikipedia, city camera feeds) can rate-limit, change, or go down. The app caches where it can.
- **Only Windows was tested.** The macOS / Linux launchers were run with bash on Windows, not on a real Mac or Linux machine. Only Chrome was driven in tests.
- **A computer with no graphics card at all** (software rendering) runs the app, but the original's traffic layer grounds every car on the 3D surface and can time out loading detailed roads there; on any real GPU it loads in seconds.
- **Rarely, a camera flight is dropped.** In one scripted sequence — three outlines on two continents, seconds apart — the original's navigation code occasionally dropped the flight to the next place, so that outline was refused as too far from the view. Asking again works; it did not recur in seven further runs.
- **Voice was tested with a simulated microphone** (real speech audio fed through Chrome's virtual microphone, exactly as a real one would deliver it), not with a physical microphone.
- **Some bundled datasets carry non-commercial terms** (for example the TeleGeography submarine-cable map and the Bhote Koshi event imagery). Read [DATA_SOURCES.md](DATA_SOURCES.md) before any commercial use, or remove those datasets.
- The "TOP SECRET" text in the HUD is a visual style, and the data may be delayed, incomplete or wrong — do not use it for navigation or safety decisions.

---

## 6. Keeping up with the original

This edition matches the original as published on **5 October 2026**: release 0.2.1 and every change on its main branch up to that day. Anything the original publishes later is not in it yet. Star and watch the original for updates: <https://github.com/bilawalsidhu/gods-eye-view>.

---

## 7. Services this edition contacts

Cesium ion and Google's 3D tile servers; Google (Gemini Live); Groq; AISStream; NASA FIRMS; TomTom; OpenSky; adsb.lol; CelesTrak; USGS; Launch Library 2; Radio Browser and the radio stations themselves; city and state camera feeds; OpenStreetMap services (Photon, Nominatim, OSRM tiles/routing, and Overpass only if you configure one); OpenFreeMap vector tiles; DeFlock's hourly ALPR extract; Overture Maps names; Cesium ion's geocoder (Google / Microsoft Bing); Wikipedia and Wikidata; NOAA (nowCOAST, NHC/CPHC, GFS), ECMWF open data; NASA GIBS and CMR; NIFC WFIGS and InciWeb; Statens vegvesen (Norway); KartaView; Open-Meteo; Esri imagery; Re:Earth terrain. Each has its own terms; by adding your own key you accept them. See [DATA_SOURCES.md](DATA_SOURCES.md).

---

## 8. Files changed by this edition

Compared byte for byte with the original's commit `a08a53c` (05 October 2026), which this edition is based on: **43 files added, 109 changed, 16 deleted**, plus the edition's own launchers and notes. Every other file is the original's own, unchanged.

Left out of the package to keep it small, not changed: the demo GIFs in `docs/media` (about 67 MB), the developer-only `TESTING.md`, `CONTRIBUTING.md` and `docs/MAINTAINER_WORKFLOW.md`, and the original's `.github` and `.agents` folders.

<details><summary><b>The edition's launchers and notes</b> (10)</summary>

- `README.md (replaced)`
- `READ-ME-FIRST.txt`
- `START-HERE-WINDOWS.bat`
- `ADD-API-KEYS.bat`
- `START-HERE-MAC-LINUX.sh`
- `START-HERE-MAC.command`
- `ADD-API-KEYS.sh`
- `ADD-API-KEYS-MAC.command`
- `FREE-EDITION.md`
- `docs/GUIDE.md`

</details>
<details><summary><b>Added: scripts</b> (2)</summary>

- `scripts/qa-voice-capture.mjs`
- `scripts/voice-check.mjs`

</details>
<details><summary><b>Added: server</b> (18)</summary>

- `server/providers/cctv/streetlevel.js`
- `server/providers/cctv/streetlevel.test.mjs`
- `server/providers/common/cross-site-guard.js`
- `server/providers/common/cross-site.js`
- `server/providers/gemini.js`
- `server/providers/gemini/constants.js`
- `server/providers/gemini/realtime.js`
- `server/providers/gemini/realtime.test.mjs`
- `server/providers/gemini/socket-proxy.js`
- `server/providers/places/keyless.js`
- `server/providers/voice.js`
- `server/providers/voice/constants.js`
- `server/providers/voice/debug-log.js`
- `server/providers/voice/hud-summary.js`
- `server/providers/voice/instructions.js`
- `server/providers/voice/rate-limit.js`
- `server/providers/voice/toolDescriptions.js`
- `server/providers/voice/tools.js`

</details>
<details><summary><b>Added: src</b> (2)</summary>

- `src/crossSiteGuard.test.mjs`
- `src/hudSummaryWords.test.mjs`

</details>
<details><summary><b>Added: src/app</b> (2)</summary>

- `src/app/performance.js`
- `src/app/performance.test.mjs`

</details>
<details><summary><b>Added: src/layers</b> (1)</summary>

- `src/layers/traffic/qualityBudget.test.mjs`

</details>
<details><summary><b>Added: src/maps</b> (2)</summary>

- `src/maps/ionGeocoding.js`
- `src/maps/ionGeocoding.test.mjs`

</details>
<details><summary><b>Added: src/search</b> (6)</summary>

- `src/search/ionGeocoder.js`
- `src/search/ionGeocoder.test.mjs`
- `src/search/naturalRegionGeocoder.js`
- `src/search/naturalRegionGeocoder.test.mjs`
- `src/search/wikipediaGeocoder.js`
- `src/search/wikipediaGeocoder.test.mjs`

</details>
<details><summary><b>Added: src/tooling</b> (1)</summary>

- `src/tooling/nominatimBoundaryRoute.test.mjs`

</details>
<details><summary><b>Added: src/voice</b> (9)</summary>

- `src/voice/geminiAudio.js`
- `src/voice/geminiAudio.test.mjs`
- `src/voice/geminiConnection.js`
- `src/voice/geminiConnection.test.mjs`
- `src/voice/geminiProtocol.js`
- `src/voice/geminiProtocol.test.mjs`
- `src/voice/geminiSession.test.mjs`
- `src/voice/geminiTools.js`
- `src/voice/geminiTools.test.mjs`

</details>
<details><summary><b>Changed: (project root)</b> (7)</summary>

- `.env.example`
- `.gitignore`
- `CHANGELOG.md`
- `DATA_SOURCES.md`
- `SECURITY.md`
- `package.json`
- `style.css`

</details>
<details><summary><b>Changed: docs</b> (6)</summary>

- `docs/APPLICATION.md`
- `docs/CODE-BOUNDARIES.md`
- `docs/CURRENT-STATE.md`
- `docs/MCP_SETUP.md`
- `docs/TOOLS.md`
- `docs/VOICE-OWNERSHIP.md`

</details>
<details><summary><b>Changed: pinokio</b> (4)</summary>

- `pinokio/_ENVIRONMENT`
- `pinokio/install.js`
- `pinokio/start.js`
- `pinokio/update.js`

</details>
<details><summary><b>Changed: scripts</b> (20)</summary>

- `scripts/dev-fresh.sh`
- `scripts/format-scope.json`
- `scripts/package-boundaries.json`
- `scripts/pinokio-environment.mjs`
- `scripts/qa-attribution-b12.mjs`
- `scripts/qa-camera-controls.mjs`
- `scripts/qa-cockpit-plates.mjs`
- `scripts/qa-cockpit-utility.mjs`
- `scripts/qa-firstrun-mutations.mjs`
- `scripts/qa-heading-b3.mjs`
- `scripts/qa-l9-matrix.mjs`
- `scripts/qa-labels.mjs`
- `scripts/qa-map-source-tray.mjs`
- `scripts/qa-overlay-baseline.mjs`
- `scripts/qa-perf.mjs`
- `scripts/qa-radio.mjs`
- `scripts/qa-sprites-b5.mjs`
- `scripts/qa-voice-routing.mjs`
- `scripts/setup-doctor.mjs`
- `scripts/track-regression.mjs`

</details>
<details><summary><b>Changed: server</b> (7)</summary>

- `server/providers/cctv.js`
- `server/providers/common/rate-limit.js`
- `server/providers/local.js`
- `server/providers/places/google.js`
- `server/providers/regional.js`
- `server/providers/regional/place.js`
- `server/standalone/voiceTools.js`

</details>
<details><summary><b>Changed: src</b> (20)</summary>

- `src/costEndpointThrottle.test.mjs`
- `src/devCctv.test.mjs`
- `src/devFreshDotenv.test.mjs`
- `src/firstRunExperience.test.mjs`
- `src/googlePlacesCoordinates.test.mjs`
- `src/googlePlacesKeyless.test.mjs`
- `src/googleServerKey.test.mjs`
- `src/hudSummaryResponse.js`
- `src/hudSummaryResponse.test.mjs`
- `src/keySetup.test.mjs`
- `src/keySetupCore.mjs`
- `src/keySetupCore.test.mjs`
- `src/keylessGeocoder.js`
- `src/localRequestGate.mjs`
- `src/mapStackUnavailableReason.test.mjs`
- `src/pinokioEnvironment.test.mjs`
- `src/pinokioLauncherContract.test.mjs`
- `src/radioMarkup.test.mjs`
- `src/setupDoctor.test.mjs`
- `src/toolProjectRoot.test.mjs`

</details>
<details><summary><b>Changed: src/annotations</b> (2)</summary>

- `src/annotations/drawTool.test.mjs`
- `src/annotations/resolver.js`

</details>
<details><summary><b>Changed: src/app</b> (2)</summary>

- `src/app/operations.js`
- `src/app/scene.js`

</details>
<details><summary><b>Changed: src/data</b> (2)</summary>

- `src/data/bundledJson.test.mjs`
- `src/data/dataCredits.js`

</details>
<details><summary><b>Changed: src/layers</b> (5)</summary>

- `src/layers/installations/source.js`
- `src/layers/installations/source.test.mjs`
- `src/layers/traffic/animation.js`
- `src/layers/traffic/policy.js`
- `src/layers/traffic/retention.js`

</details>
<details><summary><b>Changed: src/maps</b> (1)</summary>

- `src/maps/availability.js`

</details>
<details><summary><b>Changed: src/search</b> (4)</summary>

- `src/search/defaults.js`
- `src/search/index.js`
- `src/search/offlineGeocoders.test.mjs`
- `src/search/presetGeocoder.js`

</details>
<details><summary><b>Changed: src/services</b> (1)</summary>

- `src/services/requests.js`

</details>
<details><summary><b>Changed: src/standalone</b> (1)</summary>

- `src/standalone/application.js`

</details>
<details><summary><b>Changed: src/testSupport</b> (1)</summary>

- `src/testSupport/readRealtimeSource.mjs`

</details>
<details><summary><b>Changed: src/tooling</b> (4)</summary>

- `src/tooling/localServices.test.mjs`
- `src/tooling/placeProviders.test.mjs`
- `src/tooling/previewServing.test.mjs`
- `src/tooling/transitQa.test.mjs`

</details>
<details><summary><b>Changed: src/tools</b> (2)</summary>

- `src/tools/queries/panelRequest.js`
- `src/tools/queries/panelRequest.test.mjs`

</details>
<details><summary><b>Changed: src/ui</b> (2)</summary>

- `src/ui/cyberSonarControls.test.mjs`
- `src/ui/templates/provider-settings.html`

</details>
<details><summary><b>Changed: src/voice</b> (18)</summary>

- `src/voice/actionSchemas.test.mjs`
- `src/voice/aircraftIdentityNarration.test.mjs`
- `src/voice/control.js`
- `src/voice/gevActions.test.mjs`
- `src/voice/gevRealtime.test.mjs`
- `src/voice/realtimeConnection.js`
- `src/voice/realtimeController.js`
- `src/voice/realtimeDiagnostics.js`
- `src/voice/realtimeFacade.js`
- `src/voice/realtimeInput.js`
- `src/voice/realtimeOwners.test.mjs`
- `src/voice/realtimeProtocol.js`
- `src/voice/realtimeRadio.js`
- `src/voice/realtimeSession.js`
- `src/voice/realtimeTurns.js`
- `src/voice/realtimeViewport.js`
- `src/voice/session.test.mjs`
- `src/voice/sessionCommands.js`

</details>
<details><summary><b>Deleted (the retired paid services and their cost meter)</b> (16)</summary>

- the retired paid voice service's server folder and helpers (9 files)
- `src/ui/styles/voice-cost.css`
- `src/voice/realtimeBackend.js`
- `src/voice/realtimeBackend.test.mjs`
- `src/voice/realtimeCost.js`
- `src/voice/realtimePreferences.js`
- `src/voice/voiceCost.js`
- `src/voice/voiceCost.test.mjs`

</details>
