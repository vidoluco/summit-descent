# Testing and playing

## Play

```
npm install        # once
npm run play       # builds dist/, starts the server, opens the game in the browser
```

The terminal prints three addresses and a QR code:

| Line | Who opens it |
|---|---|
| `game (this Mac)` | the browser on the Mac or the TV (opened for you by `npm run play`) |
| `game (LAN)` | the same page from another computer on the Wi-Fi |
| `phone pad` | each phone: scan the QR on the TV (or in the terminal) or type the address |

1. The phones and the Mac must be on the **same Wi-Fi**. No app and no HTTPS needed.
2. Each phone that opens the pad takes a slot: the first is the blue drop, the second the pink one. A third phone waits until a slot frees up.
3. Press **Start the race** on the TV, or **BOOST** (SCATTO) on each phone: a tap makes that phone ready, and the race starts once both are. With one phone, **hold** BOOST for a second and a half: a bot races the other drop and your view takes the whole screen. A phone that joins while a bot drives its slot is told it plays from the next race.
4. After the results, BOOST is ignored for 2.5 s (the bar on **Rematch** fills). Then **Rematch** or a BOOST tap starts again, and **Change players** or a held BOOST goes back to the lobby and its QR code.

Hold the phone sideways: the right two thirds are the joystick (rest your thumb anywhere and drag), the left third is BOOST. Each phone has its own language switch (EN/IT, top right); the TV switches in the lobby.

No phone at hand: the keyboard drives the drops for development (WASD + Shift for blue, arrows + Enter for pink).

### When the phone cannot connect

| Symptom | Cause and fix |
|---|---|
| The QR points to a `10.x`, `100.x` or other odd address, or the phone page never loads | A **VPN on the Mac** can take over the network address the server picks, or block the LAN. Disconnect the VPN, or force the Wi-Fi address: `LAN_IP=192.168.1.23 npm run play` (find it with `ipconfig getifaddr en0`). |
| The page loads on the Mac but not on the phone | macOS asked "Allow incoming connections" for `node`: allow it (System Settings, Network, Firewall). Guest or office Wi-Fi often isolates devices from each other: use the home Wi-Fi or a phone hotspot. |
| `Port 5190 is already in use` | Another copy is running. Stop it, or `PORT=5191 npm run play`. |
| The phone says "Connection lost" | It reconnects by itself and keeps its slot for 60 s; the drop waits on the TV. |

## Tests

```
npm test                                   # everything (node --test 'test/*.test.mjs'), about 4 minutes
node --test test/sim.test.mjs              # one file
node --test --test-name-pattern=Italian test/e2e-race.test.mjs   # one test
```

The browser tests use the Chromium from the playwright cache (`~/Library/Caches/ms-playwright`: the headless shell, and Chrome for Testing for headed runs). Without it they skip. Nothing is installed system wide.

| Files | What they cover | Browser |
|---|---|---|
| `sim*`, `game-logic`, `ui-logic`, `i18n-parity`, `net-input`, `net-i18n`, `animals-*`, `render-geometry` | the deterministic sim, race flow, HUD logic, dictionaries, input | no |
| `net`, `net-pad` | the server, slots, reconnection, room full; the pad page with touch | pad only |
| `bake*` | the baked worlds: monotonic stages, real elevations, valid indices | no |
| `render-*`, `ui-dom` | the scene and the overlays render | yes |
| `game-browser` | the host page with bots and scripted WebSocket phones: lobby to results, a phone dropping out, rematch | yes |
| `e2e-race` | the whole game as played, see below | yes |
| `e2e-harness` | the helpers the end to end test relies on | no |
| `e2e-pads` | the two phones as real controllers, see below | yes |

### End to end (`test/e2e-race.test.mjs`)

The game exactly as `npm run play` serves it: `node build.mjs`, then `node server/index.js` as its own process on a free port. The TV is the host page at 1920x1080 on the Mac GPU (ANGLE Metal). The two phones are the real controller pages, each in its own browser context with touch emulation. A driver moves their thumbs with what a bot would do (the stick held and moved, BOOST tapped). BOOST on the blue phone makes it ready, BOOST on the pink one starts the race; both drops go through every stage and every cloud to the valley floor.

It runs twice, in Italian and in English, and checks: both phones joined and got a slot, the countdown ran, every stage in order with one cloud between each pair, both drops finished or the 30 s grace ran out, the results screen, the finish toast and HUD on each phone, no page or console errors on any page, no NaN or Infinity anywhere in `window.__game`, and that **every visible string on the TV and on both phones comes from that language's dictionary** (numbers, times, the pad URL and the baked stage names aside).

The Italian run saves `docs/screens/e2e-stage-1..4.png`, `e2e-transition.png` (the first cloud flight) and `e2e-results.png`; `OUT=dir` moves them. It runs the game clock at x3, so each race takes about 100 s.

Shared helpers (server process, backends, pad pages, touch driver, checks) live in `tools/perf/harness.mjs`.

### The phones (`test/e2e-pads.test.mjs`, `test/helpers/phones.mjs`)

The real server as its own process (ports 8205-8209), the TV in headless chromium, and each phone opened from the URL the TV prints **and** the one its QR decodes to, in a mobile context (iPhone 15 or Pixel 7, portrait or landscape, its own language and localStorage), thumbs driven by real CDP touch events. Each phone reaches the Mac through its own proxy, its "Wi-Fi", which the test can cut without closing the sockets.

| Test | Checks |
|---|---|
| URL | the QR is the Wi-Fi address with NordVPN's NordLynx and Meshnet tunnels listed first (they show up as "other addresses"), and `LAN_IP` overrides everything |
| two phones race | both join (blue, pink), SCATTO makes them ready, both steer at once and the drops really move apart and back, release recentres, a boost speeds the drop up and a press while the ring recharges does nothing, a second finger never steals the stick, the HUD shows the sim's mass and place, touch to host latency (p50, p95), a third phone sees "the room is full" and so does the TV, Wi-Fi lost and phone locked: the TV waits for that colour and the same slot comes back |
| every phone | iPhone and Android, portrait and landscape: SCATTO big and clear of the bars and the banner, the longest banner inside the screen, the dead zone, the knob under the thumb (and never cut off), the base dragged past the rim, up is forward, SCATTO with the stick held, the recharge ring |
| hygiene | no scroll, zoom or text selection under swipe, pinch and long press (a plain page in the same phone shows the gestures do land), screen kept awake (a muted looping video on plain http), no vibrate before the first tap, then every buzz accepted |
| WebKit | the pad in Safari's engine as an iPhone (`npx playwright-core install webkit`, skipped without it): layout, join, tap, stick, gesture events cancelled, the switch haptic in place of vibrate |

`PADS_SHOTS=<dir>` saves every phone screen. For a playtest of your own:

```js
import { buildGame, startGame, launchPhones, openTV, shownPadUrl, openPhone, latency, NORDVPN } from './test/helpers/phones.mjs';
import { launch } from './tools/perf/harness.mjs';
const dist = await buildGame();                              // a private dist/ built from source
const game = await startGame({ port: 8205, dist });          // lanIp: '…' or vpn: NORDVPN to try those
const tv = await openTV(await launch('metal'), game, { lang: 'it' });
const { qr } = await shownPadUrl(tv);                        // decoded from the QR the lobby draws
const phones = await launchPhones();
const blue = await openPhone(phones, qr, { device: 'iphone', orientation: 'landscape', locale: 'it-IT', label: 'blue' });
await blue.steer(1, 0); await blue.tapBoost(); await blue.release();
await blue.dropWifi(); await blue.restoreWifi(); await blue.lock(); await blue.unlock();
console.log(await latency(blue, tv));                        // { socket: {p50, p95}, sim: {p50, p95} } in ms
```

### Screenshots of every screen

```
node build.mjs && node src/game/tools/shoot.mjs           # docs/screens/game-*.png: lobby, countdown, stages, clouds, results
node src/game/tools/shoot.mjs --pads                       # lobby with both phones, an animal drinking
node src/render/debug/shoot.mjs                            # the render debug views
```

## Frame time

```
node tools/perf/measure.mjs                     # headless Chromium on the Mac GPU (ANGLE Metal), vsync on
node tools/perf/measure.mjs --uncapped          # without the 60 Hz cap: shows the headroom
node tools/perf/measure.mjs --backend headed    # Chrome for Testing in a real window (a window opens for about a minute)
node tools/perf/measure.mjs --all               # metal, metal uncapped, headed, swiftshader
```

Two bots race at 1920x1080 split screen; it measures each stage for 6 s (`--seconds`, `--stages 0,2`) and one cloud transition (`--no-cloud` skips it). Every frame of the game loop is timed by wrapping `requestAnimationFrame` before the page loads, so no game code changes. It prints the WebGL renderer it really got.

`node tools/perf/playtest.mjs [world ...]` plays a whole ?bots=2 race on every world (or the ones named) through the real page, sped up (`--speed 3`), and saves the start shot, every stage, each cloud transition and the results as PNGs (`--out dir`, default `$TMPDIR/summit-descent-playtest/`), with `report.json`: finishing times, fps, non-finite numbers, HTTP and console errors. `--intro` stops after the start shot. Look at every capture.

| Column | Meaning |
|---|---|
| `fps`, `interval` | time between frames as the players see it; 16.7 ms is 60 fps at vsync |
| `cpu` | main thread time of the game's frame (sim, scene update, draw calls); uncapped it also includes waiting on the GPU |
| `long` | frames over 25 ms, a visible hitch at 60 Hz |

Backends: `metal` and `headed` use the real GPU and are the numbers to trust. `swiftshader` is Chrome's CPU rasteriser: far slower than any Mac and **not representative**, kept only to see the floor. The Metal numbers come from an M4 Pro; an M1 or M2 has less headroom, so rerun there before trusting 60 fps on the TV Mac.
