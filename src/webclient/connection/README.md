# Connection layer scaffold (Phase 4)

This directory is the `curConn`-equivalent object Phase 3 found the
recovered Flutter engine expects at `window.setByName`/`.getByName` (see
`docs/WEBCLIENT_V2_REBUILD_PLAN.md`'s Phase 3 findings and "Revised
approach" section). It's a scaffold, not a working connection - written now
so the structure is ready and reviewable, ahead of Phase 2's `flutter build
web` actually succeeding (there's nothing to embed/test against yet).

## Files

- `websock.js` - straight port of `Chr0mX/rustdesk`'s recovered
  `flutter/web/js/src/websock.ts` (v1). Logic unchanged, just stripped of
  TypeScript types to match this project's plain-JS convention.
- `curConn.js` - port of the same repo's `connection.ts`, renamed `CurConn`
  to match what the engine actually calls it (see Phase 3 findings - nearly
  every `setByName`/`getByName` case in `flutter/lib/web/bridge.dart`
  dispatches into a global literally named `curConn`). Adapted in two
  places: `loadVideoDecoder`/`handleVideoFrame` for Phase 1's codec
  decision (reuse `ffmpeg-core.wasm`, not v1's OGV.js), and every place v1
  talked to its own UI/canvas now instead calls into `globals.js`'s
  `pushEvent`/`msgbox`/`draw`, which forward to the engine's
  `window.onGlobalEvent`/`window.onRgba` per Phase 3's contract. Everything
  v1 never had (file transfer, terminal, virtual display, elevation, 2FA,
  codec switching - see Phase 1 findings item 4 on the protobuf schema
  additions) is appended as explicit stubs, not silently omitted.
- `bridge.js` - **new** code (not ported from anywhere - the real
  dispatcher in the compiled bundle is minified, not real source).
  Registers `window.setByName`/`window.getByName` matching the case list
  Phase 3 found live in `js/dist/index.js`, dispatching into a `CurConn`
  singleton.
- `globals.js`, `common.js` - adapted subsets of v1's same-named files;
  only what `curConn.js`/`websock.js` actually import. See inline comments
  for what's a straight port vs. a stub.

## What's NOT done here (and why)

This scaffold will not connect to anything yet. In order:

1. **`message.js`/`rendezvous.js` don't exist.** These are protobuf
   bindings generated at build time via `protoc`/`ts-proto` against
   `rustdesk-server`'s `libs/hbb_common/*.proto` (see v1's `ts_proto.py` -
   `ts-proto` is already in this repo's `package.json` devDependencies).
   `websock.js`/`curConn.js` import them exactly as v1 did (they were
   gitignored there too, never committed) - this needs a real codegen step
   wired into the build, in an environment with `protoc` available (not
   this sandbox - see the plan doc's Risks section).
2. **`libsodium-wrappers` isn't installed yet** (added to `package.json`,
   not run - no npm registry access in this sandbox). Needed for
   `globals.js`'s crypto functions (`genBoxKeyPair`, `genSecretKey`,
   `seal`, `verify`, `encrypt`, `decrypt`).
3. **Video/audio decode isn't wired up.** Per Phase 1's codec decision,
   this should call into the same `ffmpeg-core.wasm`/`libopus.wasm` the
   currently-vendored bundle already ships, not v1's OGV.js pipeline - not
   implemented yet, flagged inline in `curConn.js`.
4. **`mapKey`/`translate` need constants vendored from the real client.**
   v1 generated these (`KEY_MAP`, `LANGS`) from `Chr0mX/rustdesk`'s
   `src/client.rs` via a script (`gen_js_from_hbb.py`) this plan
   deliberately isn't reusing live (see the plan doc's Scope section) -
   needs a small, hand-copied snapshot instead.
5. **The new-protocol stubs in `curConn.js`** (file transfer, terminal,
   virtual display, elevation, 2FA, codec switching) have no source to
   port from at all - v1 predates all of them. Each needs its exact wire
   messages worked out against a real connection, once Phase 2's engine
   build exists to compare against (see the plan doc's Phase 5).
6. **Not wired into the Vue app yet.** Nothing in `src/webclient/views`
   calls `bridge.js`'s `initBridge()` or embeds the Phase 2 engine build -
   that's the next slice, once there's an actual engine build to point at.
