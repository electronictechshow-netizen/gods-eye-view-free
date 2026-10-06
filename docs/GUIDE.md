# 🌐 God's Eye View — Free Edition: Field Guide

**What it can do and how to drive it.** Starting the app and adding keys are in [README.md](../README.md); what differs from the original is in [FREE-EDITION.md](../FREE-EDITION.md).

> This guide is adapted from the original project's README (© Bilawal Sidhu, MIT license). Counts such as "11,000+ aircraft" or "~3,600 cameras" are the original author's figures and move with the live feeds. Wherever the original needed a paid voice key, this edition uses a **free Gemini key**.

**Jump to:** [Why this exists](#-why-this-exists) · [What it does](#-what-this-thing-does) · [First five minutes](#-the-first-five-minutes) · [Cockpit](#-the-cockpit) · [Talk to it](#-talk-to-it) · [What's on the globe](#-whats-on-the-globe) · [Field missions](#-field-missions) · [Under the hood](#-under-the-hood) · [Keys, costs & limits](#-keys-costs--limits) · [Responsible & open](#-responsible--open)

---

## 🌍 Why This Exists

God's Eye View brings public signals into one explorable globe. Track the world live. Talk to it. Break it. Extend it.

Flight transponders, ship beacons, orbital elements, seismographs, and public cameras already tell us a lot about the world. God's Eye View puts them in the same place, so you can move between a global picture and an individual aircraft, ship, or street. It runs locally in your browser, with source code you can inspect and extend.

> Half the magic is that it looks like a forbidden cockpit. The other half is that every line of code is inspectable.

Most feeds are live or regularly refreshed. Traffic is simulated along real roads using aggregate location data. CCTV camera poses and rocket launch trajectories are coarse estimates.

Start with the included data sources, then add your own. Each layer is a separate module.

---

## 🎛️ What This Thing Does

- **🛩️ Cockpit view:** Ride inside a tracked flight — the camera holds the terrain under you all the way down.
- **📡 Contacts:** A 250 km roster of everything near your target — step through live aircraft and drop into any cockpit.
- **🎯 Click-to-track anything:** Camera locks on, draws a fading trail, surfaces full metadata — and a tracked fire or vessel hands you off to the nearest live camera in one click.
- **🖊️ Voice whiteboard:** Speak annotations onto the world — real boundary polygons, marks, and routes.
- **🛫 3D hangar:** Real per-class aircraft models — 787, ATR-72, Citation, Bell 206, MQ-9 — and a tracked contact swaps from glyph to 3D model as you close in.
- **🎨 Reskin reality:** GLSL sensor looks over the normal globe — CRT, NVG, FLIR/thermal, Noir, Snow.
- **🟩 Detection overlay:** Screen-space bounding boxes and IDs on everything in view.
- **🎖️ Military HUD:** Tactical heads-up display with intelligence-style telemetry.
- **🌐 Global Context:** Stage the full situational picture with one switch — and get your exact view back when you leave.
- **🎥 Scene director:** Capture cinematic camera tours for clips and demos.
- **🔗 Share Links:** Camera, style, layers, and even one tracked target serialize into a URL — a live target is a handoff, not a bookmark.
- **🏠 Reset Globe:** One control — or one sentence — back to the full Earth.

---

## 🕐 The First Five Minutes

Choose a first-run mission, or try these in order. Your starting basemap depends on the keys you've added: with none, you get the Esri satellite globe; with a Cesium ion token (and the Google 3D tiles added to your assets), the same steps happen inside photorealistic 3D cities.

1. **Light up the sky.** Take the **Live Contacts** mission (or turn on **Flights** yourself) — thousands of live aircraft, gliding on real telemetry, detection mesh already reading the scene. Click one: the camera locks on, a trail draws behind it, and its live telemetry card comes up.
2. **Take the controls.** Hit **COCKPIT** on your tracked plane and ride it down, switching sensors mid-flight: NVG into Ironbow FLIR.
3. **Drop into a busy airport.** Search one and descend to the taxiways with **3D** aircraft on — grounded contacts, taxi trails, the whole apron working in real time.
4. **Look through a public camera.** Turn on **CCTV** over Austin, London, California, or Finland. The feeds aren't webcam embeds — they project _into_ the 3D city. Cycle coverage to **VIEWSHED** and every camera draws its estimated coverage volume — where it reaches, and where it goes blind.
5. **Track something in orbit.** Turn on **Satellites** and click the ISS — you ride along at orbital distance, orbit ring and all.
6. **Switch the optics.** Tap `1`–`7` — CRT, NVG, FLIR — and the whole live planet re-renders through a different sensor.
7. **Talk to it** _(needs the free Gemini key)_: _"Take me to LAX and select the nearest airborne aircraft."_
8. **Come home.** Hit **Reset Globe** — or just say _"zoom out to a globe view."_

**Keyboard:** `1`–`7` visual styles · `H` HUD · `D` detection · `C` cockpit · `Esc` out · hold `Space` to talk.

---

## 🛩️ The Cockpit

> Every plane should let you do this.

Real-time cockpit mode, built from live flight data: the camera rides your contact with real terrain holding underneath, all the way down — sensor styles come along for the ride, and **Contacts** keeps the 250 km roster one click away: jump plane to plane and fall straight into the next cockpit.

The cockpit even carries its own briefing strip: nearby live signals, regional headlines, and real local weather — with an opt-in **WX** mode that renders volumetric clouds from actual observations around your aircraft.

_Why cockpit mode exists: you're riding a real aircraft over real terrain — and you get to pick which sensor you see the world through._

---

## 🎙️ Talk to It

> Voice needs a free **Gemini** key (see [Keys, costs & limits](#-keys-costs--limits)). Without it, the entire app still runs; the mic button just tells you voice needs a key. The **AI HUD summary** — a terse, five-word intelligence-style readout that regenerates as you move — uses a free **Groq** key; without one the HUD shows a plain built-in summary.

Click **MIC** (always listening — just talk) or **hold Space** (push-to-talk — release to send), and grant the microphone when your browser asks. This is more than a voice-controlled remote:

- **🧠 It knows what it's looking at.** The agent pulls live scene context before answering — including coordinates, street names, active layers, and view scale. Ask _"what city is this?"_ mid-flight and it knows.
- **🎯 Entity Q&A.** Click any plane, ship, or datacenter and ask _"what's this?"_ It answers using the object's live telemetry.
- **👁️ Visual grounding.** At street level, it reads a viewport screenshot to identify legible signage and building names, and is instructed never to hallucinate labels.
- **🎬 Cinematic framing.** _"Show me the planes overhead"_ pulls the camera back, angles it, and frames the live traffic like a director.
- **🔒 Honest and secure.** The agent only confirms actions that succeeded. Your `GEMINI_API_KEY` never touches the browser: the page opens a socket to your own local server, which relays it to Google with the key attached.

**Privacy:** on Google's free tier, Google may use what you say (and the map-view details the agent sends with it) to improve its products, and human reviewers may read it. Do not say anything private.

Thirty actions and twenty-five data tools, four jobs — the commands below come straight from the product's voice test suite and tool playbook:

**🎥 Direct it** — drone-operator camera verbs:

> 🗣️ _"Take me to Tokyo."_ · _"Orbit around this area slowly."_ · _"Draw the walking route from the Capitol to Zilker Park."_ → _"Fly the route we just drew."_ · _"Zoom out to a globe view."_

**🖊️ Annotate it** — a whiteboard over the real world:

> 🗣️ _"Outline the state of Texas."_ · _"Annotate the Texas State Capitol and its grounds"_ — it draws the **actual enclosing boundary**, not a circle. · _"How far is the Eiffel Tower from the Louvre?"_ — a connector arrow appears and it speaks the distance. Everything persists until you say _"clear the map."_

**✍️ Or draw it yourself** — DISPLAY ▸ **Draw**: pick Area, Line or Pin, click the vertices on the real world, double-click to finish, label it. Same whiteboard, same persistence, no microphone needed.

**🔎 Interrogate it** — analyst queries against the live layers:

> 🗣️ _"How many flights are over Texas right now?"_ · _"Which ships are headed to Oakland?"_ · _"What is the biggest fire near Los Angeles?"_ · _"Is anything flying above forty thousand feet?"_ · _"When does the ISS pass over next?"_

**🎛️ Operate it** — the whole console, hands-free:

> 🗣️ _"Switch to night vision and turn on the flights layer."_ · _"Turn on the camera viewsheds."_ · _"Play a news radio station near Austin."_ · _"Track that plane."_ → _"Enter Cockpit."_

**And the rapid-fire tier** — one sentence each:

> 🗣️ _"Show me global infrastructure."_ (stages the layers and pulls back to the globe) · _"Play Orbital Watch."_ (a full cinematic scene) · _"Set detection density to fifty percent."_ · _"Next contact — helicopters only."_ (mid-cockpit) · _"Show me space missions."_ · _"Switch to OSM."_ · _"Sharpen the image a touch."_ · _"Switch to the tactical layout."_ · _"What's turned on right now?"_

_Ask for radio near anywhere and the globe starts broadcasting — every station is a real place you can fly to._

**Good to know with Gemini:** it words its answers its own way, and an ambiguous phrase can occasionally be understood differently than the original's voice agent would. Name the place or the layer plainly ("turn on the **fires** layer", "take me to **Lisbon, Portugal**") for the most reliable results. Place names go to Google's place search through your Cesium ion token (key #1, no extra key), then Wikipedia (which famous place a name means) and the free OpenStreetMap-based search, plus the world's mountain ranges, deserts and seas from the bundled Natural Earth data — so "the Colosseum", "the Pyramids of Giza", "the Alps" and "Gulf of Mexico" go to the real thing. Without a Cesium token the same search runs on Wikipedia and OpenStreetMap alone. A vague name that is not famous can still resolve somewhere unexpected — add the city or country ("Springfield, Illinois").

---

## 🛰️ What's on the Globe

Nineteen layers and map sources. **Seventeen have a keyless path.** Some offer additional capabilities with a free provider key. (🟢 no key · 🟡 free key.)

| Layer                       | What you get                                                                                                                                                                                                                                                                                                                                                                                                       | Source                                  | Auth                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------ |
| 🗺️ **Map Stack**            | Esri satellite imagery, Google Photorealistic 3D (through Cesium ion), OSM, plus additional ion-hosted stacks                                                                                                                                                                                                                                                                                                      | Esri / Google via ion / OSM             | 🟢 Esri satellite + OSM · 🟡 ion-hosted Google 3D + terrain  |
| ✈️ **Live Flights**         | 11,000+ live aircraft + route history                                                                                                                                                                                                                                                                                                                                                                              | OpenSky + adsb.lol                      | 🟢 (🟡 optional for more polling credits)                    |
| 🎖️ **Military Flights**     | ADS-B military traffic in amber                                                                                                                                                                                                                                                                                                                                                                                    | adsb.lol                                | 🟢                                                           |
| 🚢 **Live Vessels**         | Thousands of ships worldwide                                                                                                                                                                                                                                                                                                                                                                                       | AISStream                               | 🟡                                                           |
| 🛰️ **Satellites**           | Catalog color-coded by class with a live legend — the **DENSE** chip drops in the whole Starlink shell                                                                                                                                                                                                                                                                                                             | CelesTrak                               | 🟢                                                           |
| 🌍 **Earthquakes**          | Global seismic activity, last 24h                                                                                                                                                                                                                                                                                                                                                                                  | USGS                                    | 🟢                                                           |
| 🚗 **Traffic**              | Simulated vehicles on OpenStreetMap roads (OpenFreeMap tiles). With TomTom, live flow speeds drive the simulation and congestion colors below ~8 km; individual vehicle positions are not live observations                                                                                                                                                                                                       | TomTom + OSM                            | 🟢 simulation · 🟡 live flow speeds                          |
| 📹 **CCTV Mesh**            | ~3,600 public cameras projected _into_ the 3D space — Austin · Texas (TxDOT) · California (Caltrans) · London (TfL) · Ontario (511) · Finland (Fintraffic) · British Columbia (DriveBC) · Estonia (Tallinn, Tarktee) · Delaware (DelDOT live video) · New South Wales (Live Traffic NSW) · Calgary. Positions are published; poses are estimated priors **you calibrate by dragging a gizmo on the camera itself** | City APIs                               | 🟢                                                           |
| 📷 **Mapped ALPR Cameras**  | License-plate-reader camera locations tagged by OpenStreetMap contributors, loaded one city-sized view at a time, with **SHOW NEAREST**. Locations and tags only: no plate data, no video                                                                                                                                                                                                                         | OpenStreetMap (incl. DeFlock mapping)   | 🟢                                                           |
| 📻 **Radio**                | Geolocated world radio with an **analog tuner** — drag the needle across up to 750 stations and the globe flies to each broadcaster                                                                                                                                                                                                                                                                                | Radio Browser / broadcasters            | 🟢                                                           |
| 🚌 **Transit**              | Live buses, trams, metros, trains and ferries with delayed playback between reports, selected-vehicle trails, and mode-coloured DETECT labels — Boston, Austin, Minneapolis, Helsinki, the Netherlands, Norway, South East Queensland                                                                                                                                                                              | Operator GTFS-Realtime feeds            | 🟢                                                           |
| 🚲 **Bikeshare**            | Live station availability                                                                                                                                                                                                                                                                                                                                                                                          | GBFS                                    | 🟢                                                           |
| 🧭 **Directions**           | Click A and B on the globe for a street-following drive, walk or cycle route draped on the terrain with turn-by-turn steps — then FLY the camera along it. No key, no geocoder, no mic                                                                                                                                                                                                                             | OSRM on FOSSGIS servers (OpenStreetMap) | 🟢                                                           |
| 🔥 **Active Fires**         | Live NASA FIRMS detections, trailing 24h                                                                                                                                                                                                                                                                                                                                                                           | NASA FIRMS                              | 🟡                                                           |
| 🚀 **Space Missions**       | Rolling 30-day launches with payload, stage, and recovery detail                                                                                                                                                                                                                                                                                                                                                   | Launch Library 2                        | 🟢                                                           |
| 🎖️ **Mapped Installations** | Viewport-bounded military-site context from community mapping — incomplete by nature, and labeled that way                                                                                                                                                                                                                                                                                                         | OpenStreetMap (OpenFreeMap + Overture names) | 🟢                                                      |
| 🌬️ **Wind**                 | Animated 10 m forecast wind with an optional speed, temperature or pressure color field and a reading at map center                                                                                                                                                                                                                                                                                                | NOAA GFS / ECMWF IFS                    | 🟢                                                           |
| 🌦️ **Observed Weather**     | Rain radar (contiguous US), Satellite clouds (GOES regional or global infrared, Clouds only or Full image) and Lightning density (Americas and Pacific) on one history timeline                                                                                                                                                                                                                                    | NOAA nowCOAST                           | 🟢                                                           |
| 🌀 **Cyclones**             | Advisory positions, forecast tracks and uncertainty cones for the Atlantic and eastern/central North Pacific                                                                                                                                                                                                                                                                                                       | NOAA NHC / CPHC                         | 🟢                                                           |

**Weather, keyless.** **Wind** animates 10 m forecast flow from NOAA GFS or ECMWF IFS, with an optional color field and a reading at map center. **Rain radar**, **Satellite clouds** and **Lightning density** are observations on one history timeline in the **WEATHER** panel (step back, **Play**, **Latest**); **Cyclone advisories** draw NHC and CPHC positions, forecast tracks and cones. On Google 3D Tiles the observed layers float above the city as translucent shells, sharpened around your view.

In the app, **Data Layers** groups them as Movement, Cameras, Infrastructure, Events, Weather and Utilities. Also keyless: **Recent Imagery** (NASA GIBS Sentinel-2 / Landsat / VIIRS of the last 30 days, with image export), **wildfire perimeters** (NIFC WFIGS), **satellite pass prediction**, and a **Local ADS-B** layer for your own 1090/978 MHz receiver (see `docs/LOCAL-RECEIVERS.md`).

**💬 Or ask from Claude and Codex.** God's Eye View is also an MCP server: ask Claude Desktop, Codex or ChatGPT desktop to show a place, and the live globe opens right in the conversation. See [docs/MCP_SETUP.md](MCP_SETUP.md) (`npm run mcp`).

**The basemap ladder — what each tier buys you:**

| You have                                              | The globe you get                                                                                                                                                            |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🟢 Nothing                                            | Esri World Imagery satellite basemap + keyless terrain, in 2D. OSM takes over automatically if Esri is unreachable; if terrain is unavailable the globe continues without it |
| 🟡 A free Cesium ion token (+ the tiles in My Assets) | **Google Photorealistic 3D cities** and world terrain — eligible personal, non-commercial use; current ion terms and quotas apply                                            |

**Places, without a Google key.** With a Cesium ion token (key #1), place search asks **Google** through Cesium ion first — the same geocoder the original used, at no extra cost (the Community plan includes a monthly geocode allowance) — and **Bing** through ion as a later fallback. Without a token, and for nearby-place context and named-place lookup (voice scene context, Global Context, annotation resolution), it uses **Wikipedia** (which famous place a name means), **Photon** (OpenStreetMap-derived: where it is, how to frame it) and the bundled **Natural Earth** regions for mountain ranges, deserts and seas — no key. A camera with no live frame falls back to **KartaView** street-level photos. Coverage is strong on landmarks and civic features and thinner on long-tail retail.

**No Overpass needed.** OpenStreetMap's public "Overpass" servers are not used unless you configure your own in the key file: road traffic reads OpenFreeMap road tiles, ALPR cameras an hourly OpenStreetMap extract, Mapped Installations OpenFreeMap with a bundled name index, and state/country/city outlines (and "how many flights are over Texas"), plus named buildings and parks ("outline the Pentagon"), come from OpenStreetMap's **Nominatim**. Only outlines of unnamed buildings need an Overpass instance.

**Smooth on slow computers.** The app measures the machine it runs on and picks a rendering quality to match: the original's full settings on a capable graphics card, and lighter ones (no multisampling, a smaller canvas, coarser 3D tiles, a smaller tile cache, a steady 30 fps, and fewer road-traffic cars: 60% or 25% of the original's number) on a weak laptop or when the measured frame rate stays low. No layer or feature is switched off. To choose yourself, open the app with `?quality=standard`, `?quality=low` or `?quality=minimal` at the end of the address (`?quality=auto` returns to automatic); the choice is remembered.

**Also on the globe:** neighborhood overlays · an optional cockpit WX cloud effect · the Cyber HUD layout with Sonar. **Bundled static infrastructure:** Datacenters (4,351), Dams (704), and Submarine Cables (712).

---

## 🎖️ Field Missions

Once the basics click, run these:

| Mission                             | How                                                                                                                                                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **🚁 Ask the planet**               | _"Why are all these military helicopters flying in circles?"_ Select a military track — it silently backfills ~24 h of real trace history — and see what it's been doing, resolved as stacked 3D loops.   |
| **✈️ Final approach**               | Click-track an airliner lining up for a runway, hop into the **cockpit**, and ride it down.                                                                                                               |
| **🌃 Night watch**                  | Fly to your own city, switch to **NVG**, and let the detection mesh and HUD read the scene.                                                                                                               |
| **🚢 Port call**                    | Vessels on over the Port of Long Beach _(needs the AISStream key)_. Click a tanker for its tactical card and wake trail — then hit **NEAREST** in the CCTV panel and look at the same water through a public camera. |
| **📻 Tokyo FM**                     | Orbit Shibuya with the **Radio** layer on — then drag the analog tuner needle: every position snaps to a real station and the globe flies to whoever's broadcasting.                                      |
| **🔥 Fire line**                    | FIRMS over California _(needs the NASA FIRMS key)_. Click a detection — the camera dives to it — read the intensity, then hit **NEAREST** in the CCTV panel for a ground view.                              |
| **🚶 Ask for a walking route** _🎙️_ | Tell the world where you want to go and watch a real street-following route trace itself through the 3D city — then _"fly it"_: banked turns, eased ends, a camera that leads the path like a drone shot. |
| **📏 Measure LAX to DFW** _🎙️_      | _"How far is LAX from DFW?"_ — an arrow spans the country, the distance lands in the caption, and the endpoints stay pinned to the real world as you orbit.                                               |
| **🚀 Launch replay**                | Open **Space Missions**, pick a launch from the last 30 days, and ride the T-minus countdown through ascent to orbit — scrub it at 0.25×–4×. Labeled `RECONSTRUCTED ESTIMATE`, because it is one.         |
| **🪦 Walk the boneyard**            | Fly from regional context down into dense, fully resolved rows of retired aircraft.                                                                                                                       |
| **🏗️ Orbit Three Gorges**           | Sweep the dam and its terrain at a glance — then flip on the **Dams** layer and find 703 more.                                                                                                            |

_🎙️ = voice missions — they need the free Gemini key._

---

## 🔧 Under the Hood

How the globe handles live data:

- **World-stable icons.** Aircraft and ships point along their _true real-world heading_ at every camera angle — tracked or not, looking straight down or across the horizon — via per-frame screen-space course projection. No spinning, no viewport-locking.
- **Smooth motion from choppy data.** Live feeds arrive every 15–30s; the globe renders one interval behind real time and interpolates between known fixes. Dead reckoning fills the gaps.
- **Honest satellites.** SGP4 propagation with orbit rings that stay locked to their satellites via GMST realignment — no drift, no per-second flicker.
- **Sits on the real ground.** Entity heights are aligned to work with Google 3D tiles, so aircraft park on aprons and cameras stand on street corners instead of floating.
- **Caching and request budgets.** An OpenSky credit governor, a TomTom daily tile budget, and disk-cached TLEs reduce repeated requests. These controls do not replace provider quotas or billing controls.
- **Server-side credentials.** Every API that touches a private key (Gemini, Groq, AISStream, OpenSky OAuth, camera frames) is brokered through a hardened local server-side proxy with SSRF protection, response caps, and sanitized errors. The only key the browser sees is the Cesium ion token, which is built for browser use (restrict it at the provider — [SECURITY.md](../SECURITY.md) shows how). This edition also refuses `/api` requests that come from another website, so a page you happen to have open cannot spend your keys.
- **One voice agent.** The agent speaks one internal event vocabulary. It runs over the Gemini Live WebSocket: the browser streams 16 kHz microphone audio to a same-origin socket on your own server, which relays it upstream with the key attached and plays back 24 kHz audio. All 30 actions, the 25 data tools (weather, tracks, cameras, places, routes, briefs …), the turn handling and the radio handoff are shared code.
- **No framework.** Vanilla JavaScript, **CesiumJS**, and **Vite**. Fast to read, fast to hack on.

```
src/
├── main.js                 # Bootstrap: Google 3D tiles, layer registration
├── ui.js                   # Runtime UI — panels, HUD, styles, control facade
├── hud.js                  # Intelligence HUD + AI scene summary
├── keySetup.js             # POWER UP panel — in-app provider keys (dev server only)
├── mapStackController.js   # Basemap switching — Google 3D / Esri / OSM / ion stacks
├── voice/                  # Voice session (Gemini Live) + 30 voice actions
├── data/                   # One module per layer + orchestration + context store
│   ├── iconOrientation.js  # Screen-projected headings + horizon cull
│   └── local_data/         # Bundled datasets (per-folder provenance)
└── scenes/                 # Cinematic scene director
server/providers/           # Server-side brokers: gemini, voice, places, cctv, overpass, ...
```

See [`docs/CURRENT-STATE.md`](CURRENT-STATE.md) for the runtime reference. It, `SECURITY.md` and the other files in `docs/` are the original project's documents, updated where this edition differs (voice and keys); some pages may still describe details of the original.

---

## 🔑 Keys, Costs & Limits

🟢 **No key** · 🟡 **Free key**

Keys go in the key file (`ADD-API-KEYS.bat` opens it in Notepad — the sign-up link is written above every key) or in the in-app **POWER UP** panel. None is required to start.

| #   | Key                | Switches on                                           | Get it                                                             |
| --- | ------------------ | ----------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | 🟡 **Cesium ion**  | Photorealistic 3D cities + world terrain              | <https://cesium.com/ion> · tiles: <https://ion.cesium.com/assetdepot> · token: <https://ion.cesium.com/tokens> |
| 2   | 🟡 **Gemini**      | Voice (all 30 actions + 25 data tools)                | <https://aistudio.google.com/apikey>                               |
| 3   | 🟡 **Groq**        | AI summary line in the HUD                            | <https://console.groq.com/keys>                                    |
| 4   | 🟡 **AISStream**   | Live ships                                            | <https://aisstream.io> (sign in with GitHub) → <https://aisstream.io/account> |
| 5   | 🟡 **NASA FIRMS**  | Live wildfires                                        | <https://firms.modaps.eosdis.nasa.gov/api/map_key/>                |
| 6   | 🟡 **TomTom**      | Live traffic flow colors                              | <https://my.tomtom.com/keys>                                       |
| 7   | 🟡 **OpenSky**     | More flight-polling credits (flights work without)    | <https://opensky-network.org/my-opensky/account> → API client      |


### 💸 What it actually costs

Honest numbers, as of this edition — always check the provider pricing pages:

|                          | Cost reality                                                                                                                                                                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **🟢 Most layers**       | **$0, no signup.** OpenSky anon, USGS, CelesTrak, adsb.lol, city CCTV, Radio Browser, GBFS, Launch Library 2, bundled datasets.                                                                                                                                                         |
| **🟡 The free-key tier** | **$0 with a signup.** Gemini, Groq, AISStream, NASA FIRMS, TomTom, OpenSky, plus Cesium ion for eligible personal/non-commercial use. Provider quotas, rate limits and eligibility still apply, and providers can change them.                                                           |
| **🔴 Not needed**        | An optional Google Maps Platform key (it needs a Google billing account with a card, and Google charges beyond its free monthly allowance) can be added in the key file's *advanced* section for Google's own 3D tiles and place data. Nothing in this edition requires it. |

**Free-tier limits you may notice.** Cesium ion's free plan caps streaming and Google 3D sessions per month (roughly one session per app launch). Gemini's free tier limits requests per minute and per day, so very long or very rapid voice sessions can be throttled by Google. CelesTrak rate-limits repeated downloads, so the app caches satellite data on disk. Use the free tiers for personal exploration; they are not a service you can promise to other people.

### 🔒 Sharing an instance

By default nobody else can reach your server — it binds to localhost. To share on your home network you must opt in (`HOST=0.0.0.0` in the key file) — but know that ⚠️ **a network-visible server brokers your configured API keys to anyone who can reach it.** Set the per-IP throttles (`GEV_RATELIMIT_VOICE_PER_MIN`, `GEV_RATELIMIT_GOOGLE_PER_MIN` — see the key file) and, before anything else, **configure provider quotas, usage limits, and billing alerts**: app-level throttles are not billing caps. Full threat model in [SECURITY.md](../SECURITY.md).

Provider Settings (POWER UP) is disabled when the server is shared, so remote users cannot access the key-entry panel.

---

## 📋 Responsible & Open

God's Eye View runs on **public data, clear sources, and local-first execution.** No secrets, no private datasets, no mystery scraping — anything involving a private key is brokered server-side. It has the visual grammar of a classified ops room, built entirely from open signals and inspectable code. The "TOP SECRET" text in the HUD is a visual style, not a claim.

**The line.** This project models **events, assets, infrastructure, and systems** — aircraft, vessels, satellites, fires, cameras, cities. It does not build features for named-person search, face recognition, or tracking individuals. People are not a query type here.

**Status:** an evolving open-source client for exploration and learning — a fast, hackable foundation, not a hardened production service. The code is released under the **[MIT License](../LICENSE)**. Bundled and live datasets carry their own terms — read **[DATA_SOURCES.md](../DATA_SOURCES.md)** (some are non-commercial only). Security model: **[SECURITY.md](../SECURITY.md)**.

**Original authors:** [Bilawal Sidhu](https://github.com/bilawalsidhu) and [Sameh Khamis](https://github.com/samehkhamis) at [Halfpixel](https://halfpixel.ai). Original project: <https://github.com/bilawalsidhu/gods-eye-view>.

> [!IMPORTANT]
> God's Eye View is an exploratory visualization of public and third-party data.
> Data may be delayed, incomplete, modeled, inferred, or wrong. Do not use it
> for flight or maritime navigation, emergency response, medical or health
> decisions, investment decisions, or other safety-critical or operational
> purposes. Verify important information with authoritative sources.

---

**🌐 God's Eye View. No place left behind.**
