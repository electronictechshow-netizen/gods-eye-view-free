# 🌐 God's Eye View — Free Edition

**A spy-satellite simulator in your browser — where the sources are public and every key is free.**

Photorealistic 3D globe · live aircraft, ships, satellites, earthquakes, fires, traffic and public cameras · **hands-free voice control**.

> **Unofficial community edition** of [God's Eye View](https://github.com/bilawalsidhu/gods-eye-view) by **Bilawal Sidhu** (MIT licensed). It is **not affiliated with or endorsed by** the original author. The original project is where the idea, the art and nearly all of the code come from — please star it and watch it for new releases.
>
> This edition is based on the original's **v0.2.1** (October 2, 2026) **plus its main branch up to October 5, 2026** — every feature the original has published, including the weather layers, Recent Imagery, wildfire perimeters, local ADS-B receivers, the Norway road cameras and the MCP server. See [FREE-EDITION.md](FREE-EDITION.md) for exactly what was changed and what was tested.

---

## ⚡ Start in 3 steps (Windows)

1. **Install Node.js** (free): get the **LTS** installer from <https://nodejs.org/en/download> and click Next through it.
2. **Unzip this folder** somewhere you will keep it, then **double-click `START-HERE-WINDOWS.bat`**.
   The first run installs the app's parts (about 200 MB, a few minutes — once).
3. **Your browser opens the app.** Keep the black window open while you use it; close it to stop.

If Windows says *"Windows protected your PC"*, click **More info → Run anyway**. The launcher is a plain text script you can read in Notepad.

**You do not need any API key to start.** With none you still get the satellite globe, live flights, military flights, satellites, earthquakes, radio, public CCTV, transit, bike share, directions and more. Each free key below switches on one extra thing.

<details>
<summary><b>macOS / Linux</b></summary>

Install **Node.js 24 LTS** from <https://nodejs.org/en/download>, then:

- **macOS:** double-click **`START-HERE-MAC.command`**. The first time, macOS may say it cannot check the file: right-click it → **Open** → **Open**. Keys: **`ADD-API-KEYS-MAC.command`**.
- **Linux:** open a terminal in this folder and run `bash START-HERE-MAC-LINUX.sh`. Keys: `bash ADD-API-KEYS.sh`.

They do what the Windows launcher does: check Node, install the app's parts once, make your key file, and open the app. By hand it is `npm ci`, `cp .env.example .env`, `npm run dev -- --open`.

This edition was built and tested on Windows. The macOS / Linux launchers were checked with bash on Windows (syntax and a dry run); they have not been run on a real Mac or Linux machine.
</details>

---

## 🔑 Free API keys (all optional)

Run **`ADD-API-KEYS.bat`** — it opens your key file in **Notepad**. Every key has its **sign-up link written right above it**. Paste the key after the `=`, save with Ctrl+S, close Notepad, and restart the app. (The **POWER UP** button inside the app does the same and restarts the app for you.)

| # | Unlocks | Key | Get it here | Free-plan notes |
|---|---------|-----|-------------|-----------------|
| 1 | 🏙️ **Photorealistic 3D cities** + world terrain + **Google-grade place search** | Cesium ion token | <https://cesium.com/ion> → **also** add the tiles once at <https://ion.cesium.com/assetdepot> (search *Google Photorealistic 3D Tiles* → **Add to my assets**) → copy a token from <https://ion.cesium.com/tokens> | Personal, non-commercial use. 1,000 Google 3D sessions/month (about one per app launch), 15 GB streaming/month, and a monthly geocode allowance that place search uses (a name you search is sent to Cesium ion, which asks Google or Microsoft Bing). **The globe stays flat until the tiles are added to *My Assets*.** |
| 2 | 🎙️ **Voice control** | Gemini API key | <https://aistudio.google.com/apikey> | No credit card. Per-minute/per-day limits set by Google. **Privacy:** on the free tier Google may use what you say to improve its products and human reviewers may read it — don't say anything private. |
| 3 | 🧠 AI summary line in the HUD | Groq API key | <https://console.groq.com/keys> | No credit card. Without it the HUD shows a plain built-in summary. |
| 4 | 🚢 **Live ships** worldwide | AISStream key | <https://aisstream.io> → *Sign in with GitHub* → <https://aisstream.io/account> | Free; needs a GitHub account. |
| 5 | 🔥 **Live wildfires** | NASA FIRMS key | <https://firms.modaps.eosdis.nasa.gov/api/map_key/> | Free; the key arrives by email (check spam). |
| 6 | 🚦 **Live traffic colors** | TomTom key | <https://my.tomtom.com/keys> | Free: 200,000 tile requests/month, no card. The app self-limits to 6,000 tiles/day to stay inside it. |
| 7 | ✈️ More flight data | OpenSky API client | <https://opensky-network.org/my-opensky/account> → *API client* (a `credentials.json` downloads — the secret is only in that file) | Optional. Flights work without it (anonymous + a built-in fallback source). |

Keys stay **on your computer** (in the `.env` file next to this README) and are only sent to the company that issued them. Never share that file or show it on screen.

---

## 🎙️ Voice

Click **MIC** (always listening) or **hold SPACE** and talk. It understands the same **30 actions** as the original, plus its **25 data tools** (weather, tracks, cameras, places, routes, briefings) — camera moves, layers, sensor looks, tracking, cockpit, drawing on the map, analyst questions, radio, and more:

> *"Take me to Tokyo."* · *"Switch to night vision and turn on the flights layer."* · *"How many flights are over Texas right now?"* · *"Draw the walking route from the Capitol to Zilker Park."* → *"Fly the route we just drew."* · *"Play a news radio station near Austin."* · *"Zoom out to a globe view."*

Voice runs on **Google Gemini Live** on its free tier. It is not word-for-word identical to the original's voice agent — see [FREE-EDITION.md](FREE-EDITION.md) for the measured comparison.

---

## 📖 What can it do?

Open **[docs/GUIDE.md](docs/GUIDE.md)** — the field guide: your first five minutes, the cockpit, every kind of voice command, every layer, field missions, costs and limits. What is different from the original, and how this edition was tested, is in **[FREE-EDITION.md](FREE-EDITION.md)**.

---

## What replaced the original's paid services

| The original used (paid) | This edition uses (free) |
|---|---|
| A paid realtime voice service | **Google Gemini Live** (same 30 actions and 25 data tools) |
| A paid AI summary service | **Groq** |
| Google Maps — direct 3D tiles | **Cesium ion** (Google's tiles, free Community plan) |
| Google Places / place search | **Google and Bing place search through your Cesium ion token** (key #1, no extra key), then **Wikipedia** (famous places) + **OpenStreetMap Photon / Nominatim** (everything else), plus bundled **Natural Earth** for mountain ranges, deserts and seas. Without a Cesium token the keyless part runs on its own. |
| Google Street View fallback for cameras | **KartaView** street-level photos (no key) |

You never need any other key. (If you happen to already have a Google Maps Platform key, the key file has an optional, clearly labelled spot for it in its *advanced* section — it needs a Google billing account with a card, so it is off by default and nothing depends on it.)

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| The globe is **flat** even with a Cesium token | Add *Google Photorealistic 3D Tiles* to **My Assets** at <https://ion.cesium.com/assetdepot>, then restart. Also check the token and your monthly quota. |
| Mic says **VOICE UNAVAILABLE** | Add a Gemini key (key #2), restart the app, and allow the microphone when the browser asks. |
| No ships / no fires | Add the AISStream / NASA FIRMS key. |
| An outline of an **unnamed building** never appears | That one still needs an OpenStreetMap "Overpass" server, and the public ones refuse this app. Everything else (traffic, ALPR cameras, installations, state/country/city outlines, named buildings) works without one. If you run or may use an Overpass instance, list it in the key file's Overpass note. |
| The globe feels **slow** | The app already lowers its rendering quality on a weak machine. To force the lightest setting, open it with `?quality=minimal` at the end of the address (`?quality=auto` returns to automatic). Fewer layers on at once also helps. |
| "Port 4173 is in use" | Close other copies of the app, or change `PORT=` in the key file. |
| Anything else | Run `npm run doctor` in this folder and read what it reports. |

---

## Privacy & safety in one paragraph

The server listens **only on your computer** (`localhost`). A web page on another site cannot use your keys through it (cross-site requests are refused). Voice audio goes to Google (free-tier terms above); map-context requests go to the public data providers named in [DATA_SOURCES.md](DATA_SOURCES.md). The app writes a local debug log of voice sessions to `.gev-logs/` — delete that folder any time. All feeds are public data; the "TOP SECRET" text in the HUD is a visual style, not a claim.

---

## Credits & license

- **God's Eye View** © 2026 **Bilawal Sidhu**, MIT — <https://github.com/bilawalsidhu/gods-eye-view>. This edition keeps that copyright and license notice, as the license requires.
- **Read [LICENSE](LICENSE) and [DATA_SOURCES.md](DATA_SOURCES.md).** The MIT license covers the *code*. Some bundled data is **not** MIT and some is **non-commercial only** (for example the TeleGeography submarine-cable map is CC BY-NC-SA, and the Bhote Koshi event imagery is CC BY-NC). Use this edition for personal / non-commercial purposes as shipped, or remove those datasets first.
- Third-party services (Cesium ion, Google, Groq, AISStream, NASA, TomTom, OpenSky and others) have their own terms; by adding your own key you accept them.
