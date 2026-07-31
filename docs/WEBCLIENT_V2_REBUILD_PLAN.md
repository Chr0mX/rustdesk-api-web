# Webclient rebuild plan: from-source replacement of the compiled bundle

## Goal

Replace the legacy compiled webclient (`resources/web` in `rustdesk-api`,
currently patched by hand per `resources/web/PATCHES.md`) with a fully
source-available implementation that achieves **feature parity with the
legacy webclient before `/webclient` is repointed** to it: a thin Vue 3
login gate (styled to match `_admin`'s restyled login page - same approach
already done there) hosting the *actual* RustDesk remote-desktop engine,
built from source rather than vendored as an opaque binary. The goal is a
true replacement, not a minimum viable one - so the whole thing is finally
something we can actually read, test, and fix instead of hex-patching a
black box, without asking users to fall back to the legacy client for
anything they could already do.

(Revised mid-Phase-4: earlier phrasing here described a full Vue-rendered
"dashboard/login/settings shell." That assumed the dashboard/settings UI
needed rebuilding in Vue - Phase 4's findings (below) showed the recovered
Flutter engine already renders all of that itself, using RustDesk's real
shared UI code. See Phase 4's findings section for the full reasoning.)

## What's actually in the compiled bundle (confirmed, not guessed)

This plan went through two rounds of revision as investigation (static
analysis, a local headless-Chromium reproduction, and live checks against a
real deployment) overturned earlier assumptions. What's now confirmed:

- The compiled bundle is **two genuinely separate apps loaded together**:
  `js/dist/index.js`/`vendor.js` (a Vite-built JS/TS app - the dashboard/
  login/settings shell, styled per "RustDesk Web Client V2 Preview") and
  `main.dart.js` (a real, compiled build of RustDesk's actual Flutter/Dart
  client - `flutter_hbb` debug strings confirm it's not a stub).
- **`main.dart.js` is load-bearing, confirmed live**: blocking it via
  DevTools request-blocking on the real deployment leaves the webclient
  stuck at the loading spinner. It is not vestigial - it is the actual
  remote-desktop connection/render engine.
- Because `main.dart.js` is a real build of the same Dart codebase that
  ships the Android/iOS/Linux/macOS/Windows clients, it already has real
  file transfer, terminal, clipboard, multi-monitor, and (per the protobuf
  schema - see Phase 1 findings) a `view_camera` mode - **not net-new work
  to build these; they already exist once the engine is built from
  source.** This reverses this plan's earlier framing, which assumed file
  transfer/terminal would need to be built from scratch against a ported
  TypeScript transport layer.
- `flutter/web/js` (the JS shell's lineage, later split into `v1`/`v2` on
  2024-06-22, commit `41a20b50e`) predates `v1` - `v1` was one branch of
  that split, not the original. **The whole `flutter/web/` directory -
  covering the JS shell's source and whatever Flutter itself needed for the
  web target - was deleted from upstream `rustdesk/rustdesk` on 2025-07-01
  (commit `5faf0ad3`) and has never been restored, in upstream or in
  `Chr0mX/rustdesk`.** Upstream's own CI (`.github/workflows/
  flutter-build.yml`, the `web-basic` release job) still references
  `flutter/web/js`, but that path has been broken since the 2024-06-22
  split and is dead infrastructure today, not an active build pipeline.
- `app.ws-host`/`window.ws_host` (the single reverse-proxied `wss://` URL
  override) is confirmed **live and load-bearing** too (setting it to a
  bogus value on the real deployment broke connections) - `v1` has no
  concept of it at all, so it's real surface the recovered engine build (or
  its config wiring) needs to keep working.

## Revised approach: recover and build the real engine, replace only the shell

Given the above, porting `v1`'s stale (mid-2024, pre-terminal, no file
transfer) TypeScript transport layer into a hand-rolled Vue connection
viewer would mean **reimplementing, with real regression risk, capabilities
the actual RustDesk client already has** - and would still need to catch up
to protocol additions like `view_camera` that `v1` never knew about. That's
strictly worse than the alternative:

1. Recover `flutter/web` from `rustdesk/rustdesk`'s git history (the commit
   right before `5faf0ad3`, `5faf0ad3^`, is already confirmed to have it -
   see Phase 1 findings for exact contents) into `Chr0mX/rustdesk`, and get
   `flutter build web --release` producing a working `main.dart.js` from
   source again. This is real, uncertain reverse-engineering/reconstruction
   work - not "run one command" - since neither upstream nor the fork has
   had a working web build target in over a year, and the recovered
   snapshot isn't guaranteed to exactly reproduce what's in today's vendored
   bundle on the first try.
2. Write a new Vue 3 + Element Plus login gate + engine-hosting shell (the
   piece whose source was genuinely never published - `flutter/web/v2` was
   always just a `README.md` saying "Under dev.") to host that from-source
   Flutter build, the same way `index.js` currently hosts the compiled one.
   (Originally scoped as a full dashboard/settings UI too - Phase 4's
   findings showed the engine already renders all of that itself; see
   Phase 4 below.)
3. The exact interop contract between the shell and the Flutter engine
   (how connection config gets passed in, what events - if any - the engine
   emits back out) was **not** found via static string search of the
   compiled bundle (no `postMessage`/shared-global coordination code turned
   up) and needs its own investigation - see the new Phase 3 below.

`v1` isn't wasted effort even so: its wire-format assumptions (WS scheme,
port offsets, message/field names) were directly useful for sanity-checking
`rustdesk-server`'s current protocol in Phase 1, and remain a useful
reference for understanding the wire format independent of Flutter/Dart.

## Scope / non-goals

In scope: every user-facing capability currently available in the legacy
webclient, including:

- Peer dashboard
- Settings
- Login/logout
- Remote desktop
- Keyboard/mouse input
- Multi-monitor
- Clipboard
- Audio
- File transfer
- Terminal
- Any additional user-facing features present in the legacy client

Features may be implemented incrementally across phases (see Phase 4/5
below), but **Phase 6 (Cutover) is blocked until feature parity is reached,
or any intentional omissions are explicitly approved.** This replaces the
earlier, narrower framing of this section, which scoped file transfer and
terminal out entirely - that risked a silent feature regression the moment
`/webclient` got repointed at the new client.

Updated accuracy note (supersedes the previous one, which assumed a `v1`
TypeScript port): file transfer, terminal, clipboard, multi-monitor, and
`view_camera` are **not** net-new implementation work anymore. They already
exist in RustDesk's real Flutter/Dart client - the plan is now to recover
and build that client from source (Phase 2) rather than reimplement its
capabilities against a ported `v1` transport layer. Parity work in Phase 5
is about **verifying** the from-source build actually preserves and exposes
these, and that the new Vue shell's embedding of it doesn't lose access to
any of them - not building them from scratch.

`Chr0mX/rustdesk` (the native client fork) is **in scope** for this plan,
reversing the earlier decision to exclude it. It's needed to recover and
build the Flutter web engine (Phase 2) - see "Revised approach" above for
why.

## Success criteria

The Vue webclient is considered complete only when it can replace the
legacy compiled webclient for everyday use, without requiring users to
return to the legacy interface for any existing feature. The legacy
webclient remains available only as an optional, administrator-controlled
fallback during the transition period (see Phase 0 and Phase 6). Whatever
is in the legacy webclient will be in the Vue rewrite - achieving parity
before cutover avoids running two different clients that users have to
switch between depending on which feature they need.

## Repo split

| Work | Repo | Why |
|---|---|---|
| Recover `flutter/web` from git history, get `flutter build web --release` working from source again (Phase 2) | `Chr0mX/rustdesk` | This is where the Flutter/Dart engine's source lives - the same repo already used for the Android/iOS/Linux/macOS/Windows clients. Reversed from the earlier decision to keep this plan out of that repo entirely, once `main.dart.js` was confirmed load-bearing. |
| Vue 3 login gate + engine-hosting shell, the shell/engine interop layer (Phase 3/4), embedding the Phase 2 build output | `rustdesk-api-web` | Per instruction: default location unless there's a specific reason not to. This is the piece whose source was genuinely never published (`flutter/web/v2` was always just "Under dev."). Scoped down from a full dashboard/settings UI once Phase 4 found the engine already renders that itself. |
| Read-only source of `.proto` files, for any wire-format sanity checks that still reference `v1` | `rustdesk-server` (`libs/hbb_common/protos/*.proto`) | Already vendored there; no changes needed to that repo. Less central to this plan than originally thought, now that the transport/protocol layer lives inside the recovered Flutter engine rather than a ported TypeScript layer - kept for reference/verification only. |
| Legacy-slug route + admin toggle (Phase 0, shipped), and later the `/webclient/*` route swap (Phase 6) | `rustdesk-api` | The Go backend owns routing. Phase 0 added a new config-gated path serving today's compiled bundle unchanged; Phase 6 later points `router.go`'s `wc.StaticFS(...)` for the canonical `/webclient/` path at the new build's output instead (now a composite of the Vite-built shell and the `flutter build web` engine output). Neither is new logic - `ConfigJs`, `WebclientAuth`, `WebclientLogin`/`WebclientLogout`, and the wc_sess session model all stay exactly as they are today. |

## Phases

### Phase 0 - Relocate the legacy webclient behind its own slug + admin toggle

Ships **before** any rebuild investigation starts. Small, standalone,
immediately useful on its own regardless of whether the rest of this plan
ever ships - and it's a cheap rehearsal of the exact routing touchpoint
Phase 6 (Cutover) needs anyway.

- `rustdesk-api` (Go): add `app.webclient-legacy-enabled` (bool, default
  `true`) and `app.webclient-legacy-path` (string, default e.g.
  `webclient-legacy`) to config. Register the *same* compiled-bundle-serving
  logic (today's `wc.StaticFS(...)` + `wcAuth`/`requireWebclientAuth`/
  `ConfigJs`/`WebclientLogin`/`WebclientLogout` - none of that changes) at
  this new, separately-configurable path, gated on
  `webclient-legacy-enabled`. When disabled, the route 404s rather than
  falling through to anything else.
- `/webclient/` itself is **untouched** in this phase - it keeps serving the
  current compiled bundle exactly as it does today, at its current URL, so
  nothing breaks for existing bookmarks/links while this ships. The new
  legacy slug is purely additive for now; `/webclient/` only gets
  repointed at the new Vue app later, in Phase 6.
- `rustdesk-api-web`: add the on/off toggle to the existing webclient
  settings page (`src/views/settings/webclient.vue`), same pattern as the
  other webclient config fields already there (`updateWebclientConfig` in
  `src/api/config.js`) - a checkbox + save, nothing novel.
- Exit criteria: an admin can flip the legacy client on/off from
  `_admin`'s settings, and toggling it off makes the legacy path 404
  without touching `/webclient/`.

### Phase 1 - Spike (before committing to full replacement)

Time-boxed investigation to de-risk the rest of the plan. Each item below is
a real open question from this session, not busywork:

1. **Resolve the `main.dart.js` / `js/dist/index.js` split in the current
   bundle.** Console logs show both initializing together
   (`_globalFFI init`, `registerEventHandler ...` from `main.dart.js`,
   `WebSock.onopen`/`custom-config script tag not found` from `index.js`).
   Determine whether `main.dart.js` is still load-bearing for anything the
   new Vue app needs to replace, or whether it's vestigial/unused in
   practice. This determines whether Phase 2-5 is a full replacement or
   needs to keep something Flutter-shaped around.
2. **Confirm `hbbs`'s WebSocket endpoint behavior against `v1`'s wire
   assumptions.** `v1` connects via `Websock` to a rendezvous/relay
   WebSocket URL - confirm the URL scheme/path/sub-protocol it expects still
   matches what `Chr0mX/rustdesk-server`'s current `hbbs` exposes (upstream
   added "WS real ip" and other WS-related fixes since `v1` was last
   touched in 2024 - shouldn't be breaking, but verify against a real
   connection attempt rather than assuming).
3. **Decide the codec replacement approach.** `v1`'s `codec.js` uses
   OGV.js-based VP9/Theora decoding via Web Workers - almost certainly
   stale versus whatever the current compiled bundle actually uses (it
   ships `ffmpeg-core.wasm` + `libopus.wasm`, a different pipeline
   entirely). Two real options to evaluate here, not assume:
   - Reuse the *same* `ffmpeg-core.wasm`/`libopus.wasm` the current bundle
     already ships (known to work, no new WASM toolchain to stand up), or
   - Use the browser-native `WebCodecs` API where available, falling back
     to WASM decode otherwise (better performance, but narrows browser
     support and is genuinely new integration work).
4. **Run `v1`'s codegen against `rustdesk-server`'s current `hbb_common`
   protos** (`ts_proto.py`'s `protoc` step) as an isolated spike, unblocked
   from everything else, to confirm the generated TypeScript actually
   compiles cleanly against `v1`'s `connection.ts`/`websock.ts` usage before
   assuming the protocol hasn't drifted.

Exit criteria: a short written note (append to this doc) answering all four,
before Phase 2 work starts.

#### Phase 1 findings

Investigated via static analysis of the compiled bundle (`resources/web` in
`rustdesk-api`) plus a headless-Chromium reproduction of it served locally,
and direct comparison against `rustdesk-server`'s current
`libs/hbb_common/protos/*.proto` and `v1`'s recovered source. Full `protoc`
codegen and a real network connection test were not possible in this
session's sandbox (no outbound access to npm/apt/Go-module-proxy hosts, nor
to the user's live server) - noted per item below where that matters.

1. **`main.dart.js` / `js/dist/index.js` split - resolved, confirmed live.**
   Static analysis found `js/dist/index.js` owns the WebSocket transport
   (exact `WebSock.onopen`/`WebSock.onclose` debug strings) and eagerly
   spins up its own `ffmpeg-core.wasm`/`libopus.wasm` Web Workers on load -
   initially read as "probably a fully independent app." A local headless-
   Chromium reproduction then found `main.dart.js` fetching a genuine
   Flutter asset bundle (custom icon fonts named `tabbar.ttf`,
   `peer_searchbar.ttf`, `address_book.ttf`, `device_group.ttf`, etc. -
   dashboard-shaped, not just a remote-desktop canvas), which was enough to
   flag "not obviously vestigial" but not conclusive from a sandbox with no
   route to `gstatic.com`. **Confirmed against the real, live deployment**:
   `canvaskit.js` loads (200), a `<flt-glass-pane>` element is present in
   the DOM, and blocking `main.dart.js` via DevTools request-blocking
   leaves the webclient stuck at the loading spinner. **`main.dart.js` is
   the actual remote-desktop engine, not vestigial.** This overturns the
   plan's original premise (see "Revised approach" above) - `js/dist/
   index.js` is the dashboard/login/settings shell, `main.dart.js` is the
   engine, and the two are genuinely separate apps composited into one
   bundle, not one being dead weight alongside the other.
2. **hbbs/hbbr WebSocket wire compatibility - confirmed compatible; the
   `ws_host` gap is real, not dead code.** `rustdesk-server`'s
   `rendezvous_server.rs`/`relay_server.rs` accept a plain WebSocket
   (`tokio_tungstenite::accept_hdr_async`) on `id-server port + 2`
   (rendezvous) and `+ 3` (relay) respectively, carrying the *same*
   protobuf bytes as the plain-TCP path as WS binary frames - matching
   `v1`'s `connection.ts` (`getrUriFromRs`: `SCHEMA = "ws://"`, `+2`/`+3`
   offsets). The "WS real ip" fix (`X-Real-IP`/`X-Forwarded-For` header
   parsing) is server-side-only and transparent to any client. `v1` has no
   concept of `app.ws-host`/`window.ws_host` at all, and a string search of
   the compiled bundle found zero literal references to it either -
   flagged as "possibly dead configuration, needs a live check."
   **Confirmed against the real deployment: it's live, not dead** - setting
   `app.ws-host` to a bogus value broke connections. Since it doesn't
   appear as a literal string anywhere in the bundle, it's most likely
   consumed inside `main.dart.js` via Dart/JS interop where dart2js
   compilation renamed the property access - consistent with `ws_host`
   being real engine-level config, not shell-level. The recovered
   from-source engine build (Phase 2) needs to preserve this wiring.
3. **Codec approach - moot given the pivot, kept for the record.**
   Confirmed via string search that the compiled bundle uses **zero**
   `WebCodecs` APIs (the one apparent match was a false positive -
   `e.video_frame`, a protobuf field access, not the `VideoFrame`
   constructor) - it's 100% `ffmpeg-core.wasm` (video) + `libopus.wasm`
   (audio) via Web Workers, both driven from inside `main.dart.js`/the
   Flutter engine, not something the Vue shell needs to reimplement now
   that the plan reuses the real engine (see "Revised approach" above)
   instead of porting `v1`'s stale OGV.js-based `codec.js`.
4. **Protobuf codegen spike - no wire-breaking drift found; less central
   to the plan now.** `protoc`/`ts-proto` couldn't be installed in this
   sandbox (no apt/npm access), so this was a field-level comparison, not
   an executed codegen + compile check. Every message/enum `v1`'s
   `connection.ts`/`websock.ts` reference (`LoginRequest`, `PeerInfo`,
   `OptionMessage`(`_BoolOption`), `VideoFrame`, `MouseEvent`, `KeyEvent`,
   `SwitchDisplay`, `Hash`, `IdPk`, `PublicKey`, `Misc`, `ImageQuality`;
   `RendezvousMessage`, `PunchHoleRequest`/`Response`, `RequestRelay`,
   `RelayResponse`, `ConnType`, `NatType`) still exists, unchanged in kind,
   in `rustdesk-server`'s current `.proto` files - protobuf's field-number
   stability guarantees mean new fields don't break old generated code.
   Real drift found is additive, not breaking: `LoginRequest.union` gained
   `view_camera`/`terminal` variants (fields 15/16, i.e. the newest
   additions) alongside the existing `file_transfer`/`port_forward`, and
   `OptionMessage` gained toggles like `disable_camera`/
   `terminal_persistent`/`follow_remote_cursor`. The `view_camera` login
   mode is a genuinely new finding, not previously called out anywhere in
   this plan - **RustDesk apparently has a "view a peer's camera" connection
   mode distinct from screen sharing**; the recovered Flutter engine (Phase
   2) already speaks this natively (it's the real client), so this is now
   about confirming the *shell* surfaces it as an option, per Phase 5 - it
   belongs alongside file transfer/terminal in the Scope section's "any
   additional user-facing features" catch-all. Since the plan no longer
   ports `connection.ts` into TypeScript, an actual `protoc`/`tsc` run
   against it is no longer a blocking step - this comparison was sufficient
   to close this item out.

### Phase 2 - Recover and build the Flutter web engine from source

In `Chr0mX/rustdesk`. This is the phase that replaces the old "port `v1`'s
transport/codec layer" approach - genuine reconstruction work, not a
one-command rebuild, since no working web build target has existed in
upstream or the fork for over a year.

- [x] **Recover `flutter/web` from git history** - done, merged
  (`Chr0mX/rustdesk#1`). Restored from `flutter/web/v1`'s content at
  `5faf0ad3^` (the commit right before deletion), **flattened up to
  `flutter/web/` directly** rather than left nested under `v1/` - `v1`'s
  root-level files (`index.html`, `manifest.json`, `yarn.lock`, `yuv.js`/
  `.wasm`, `libs/firebase-*.js`) turned out to be byte-identical to the
  original pre-split `flutter/web/`, confirming `v1` is the real
  continuation of the whole scaffold, not just the JS shell alone as
  assumed when this phase was written. `icons/`/`favicon.svg` (dropped in
  the same 2024-06-22 split that created `v1`/`v2`) restored separately
  from the commit right before that split. `v2` was not restored - nothing
  in it, ever, to recover. Full provenance in `flutter/web/
  RECOVERY_NOTES.md` in that repo.
  - **Important caveat surfaced by the recovery itself, not added
    after the fact**: the restored `README.md` already said, as of the
    last commit before deletion, "v1 is not compatible with current
    Flutter source code." Real reconciliation against the current
    `flutter/lib` should be expected - not assumed away by the fact that
    the files now exist again.
- [ ] Get `flutter build web --release` running successfully against
  `Chr0mX/rustdesk`'s `flutter/` app (matching upstream's now-broken CI
  step in `.github/workflows/flutter-build.yml`'s `web-basic` job, which
  can be used as a reference for the expected build steps even though it
  currently fails). Requires a real Flutter toolchain - **not attempted
  yet**; not available in this session's sandbox (no Flutter/Dart
  toolchain, no npm/pub.dev access), needs a proper dev/CI environment.
  Also needs `flutter/web/js`'s codegen step (`ts_proto.py`/
  `gen_js_from_hbb.py`) run first - `message.ts`/`rendezvous.ts`/
  `gen_js_from_hbb.ts` are gitignored and not present in the recovered
  tree, matching how `v1` always worked (generated, not committed).
- [ ] Confirm the resulting `main.dart.js` can at minimum reach `hbbs` and
  complete a login handshake against `rustdesk-server` - the equivalent of
  the "test in isolation, headless" step the old Phase 2 called for, just
  against a real Dart build instead of a ported TypeScript one.
- [ ] Don't assume this recovered snapshot exactly reproduces today's
  vendored `main.dart.js` - version/behavior differences are possible and
  should be diffed against the current deployment (asset hashes,
  `version.json`, visible feature set) rather than assumed identical.

Exit criteria: a from-source `flutter build web --release` succeeds and
produces a `main.dart.js` that completes a real connection to a test peer
through `rustdesk-server`. **Not yet met** - recovery is done, build
verification is not.

### Phase 3 - Shell/engine interop contract

A short, focused investigation before UI work starts, since this wasn't
found via static analysis of the compiled bundle (no `postMessage` or
shared-global coordination code turned up between `index.js` and
`main.dart.js`) and the new Vue shell needs to know how to host the Phase 2
build correctly:

- [x] Determine how the JS shell hands connection config/commands to the
  Flutter engine, and how the engine emits events back - **done**, see
  findings below. Turned out fully discoverable from source (Phase 2's
  recovery) without needing a debug Flutter build at all.

Exit criteria: a short written note (append to this doc) on the actual
embedding contract - what the Vue shell needs to set up (DOM structure,
globals, config injection) before/while hosting the engine. **Met** - see
findings below.

#### Phase 3 findings

Found directly in `flutter/lib/web/bridge.dart` and `flutter/lib/models/
web_model.dart` (`Chr0mX/rustdesk`, now recoverable thanks to Phase 2) -
`dart:js`'s legacy `js.context` API, cross-checked against literal string
matches in the currently-deployed `js/dist/index.js`. This is a complete,
symmetrical, and much simpler contract than expected - two directions, each
a small, fixed set of global functions on `window`:

**Dart → JS** (synchronous RPC, one call site pattern used ~80 times across
`bridge.dart`): `js.context.callMethod('setByName', [name, args])` and
`.callMethod('getByName', [name, args])`. Confirmed live: `window
.setByName=(u,e)=>{switch(u){...}}` and `window.getByName=(u,e)=>{...}` are
defined verbatim in the current `js/dist/index.js`, with `name` values that
map directly onto `curConn.*` method calls - `handle_login_from_ui`,
`inputKey`/`inputString`, `switchDisplay`, `setImageQuality`/
`setCustomImageQuality`, `ctrlAltDel`, `toggleVirtualDisplay`,
`togglePrivacyMode`, `send2fa`, `elevateDirect`/`elevateWithLogon`,
`changePreferCodec`, `sendNote`, `setAuditGuid`, and - important for
Phase 5 - **file transfer is already dispatched through this exact same
mechanism**: `readRemoteDir`, `sendFiles`, `sendLocalFiles`, `cancelJob`,
`remove_all_empty_dirs` are all `setByName` cases calling straight into
`curConn`.

**JS → Dart** (Dart registers a small, fixed set of global callbacks via
`js.context["name"] = (args) => {...}` early in `web_model.dart`'s
init): `onRegisteredEvent` (generic event bus, JSON-decoded then
dispatched via `tryHandle`), `onGlobalEvent` (same shape, routed through
`setEventCallback`'s caller-supplied handler), `onInitFinished`,
`onFullscreenChanged`, `onLoadAbFinished`, `onLoadGroupFinished` - and the
one that matters most for the rendering split: **`onRgba`**
(`(int display, Uint8List rgba)`), which JS calls with **already-decoded,
raw RGBA pixel buffers, one call per display**.

This resolves the biggest remaining architectural question cleanly:
**JS does networking, protocol, and video/audio decode (`ffmpeg-core.wasm`/
`libopus.wasm`) - Dart does painting (via CanvasKit, fed raw RGBA through
`onRgba`) and native-feeling input capture, then calls back into JS via
`setByName` to actually act on that input.** There's no `onAudio`-style
callback into Dart at all, confirming audio playback happens entirely in
JS (Web Audio API) without a Dart round-trip. This means `curConn` - the
object nearly every `setByName`/`getByName` case ultimately calls into -
**is JS, not Dart**, and is a direct descendant of `flutter/web/js/src/
connection.ts` (the same file this plan already has real source for via
`v1`/the Phase 2 recovery), just evolved to cover everything `v1` didn't
(file transfer, virtual display, elevation, 2FA).

Practical implication for Phase 4/5: the new Vue shell doesn't need to
treat the recovered Flutter build as a sealed black box requiring a whole
new interop layer to be invented. It needs to (a) implement/extend a
`curConn`-equivalent object - starting from `connection.ts`, which is
already most of the way there structurally - covering the full
`setByName`/`getByName` case list above, and (b) expose the same `window
.setByName`/`.getByName`/`onRegisteredEvent`/`onGlobalEvent`/`onRgba`/
`onInitFinished`/`onFullscreenChanged` global functions the recovered
`main.dart.js` already expects, so that exact build can be reused
**unchanged** as the rendering/input layer rather than needing its own
UI reimplementation. This also reframes Phase 5: features like file
transfer aren't just "does the engine have them" (yes) but "does the new
shell's `curConn`-equivalent implement the matching `setByName` cases" -
a concrete, enumerable checklist (the case names above), not an open-ended
reverse-engineering task.

#### Phase 3 correction (found live, post-cutover): don't guess `setByName`/`getByName` case names

`bridge.js`'s case list was largely written by inference/analogy (matching
names against the legacy compiled bundle's own dispatcher, or just
plausible-sounding names) before a real engine build existed to check
against live. Two of those guesses were wrong in a way that fully broke the
connect flow, only caught after Phase 6 cutover via a real deployment's
console log: the recovered engine never calls `setByName("connect", ...)`
or `setByName("close")` at all. The actual names, confirmed directly in
`flutter/lib/web/bridge.dart`:

- **Connect** = `bind.sessionAddSync()` immediately followed by
  `bind.sessionStart()` → `setByName("session_add_sync", ...)` (JSON:
  `id`/`password`/`is_shared_password`/`isFileTransfer`/`isViewCamera`/
  `isTerminal`) then `setByName("session_start", ...)` (JSON: `{id}`).
- **Disconnect** = `sessionClose()` → `setByName("session_close")`.

Because both were unhandled, every connect attempt silently fell through to
the `default`/unhandled-case branch - no error, no log line, nothing -
which is why the symptom looked like "settings are fine but nothing happens
when I try to connect" rather than a visible crash. Fixed in
`rustdesk-api-web` PR #43.

**Methodology lesson for any future `bridge.js` case work**: don't infer a
`setByName`/`getByName` name from what seems plausible or from the legacy
bundle's *variable* names - grep the exact literal string at the real call
site in the recovered Dart source, and do it across **all** of
`flutter/lib/web/` (`bridge.dart`, `web_unique.dart`, `custom_cursor.dart`,
`common.dart`) plus `flutter/lib/models/web_model.dart`, not just
`bridge.dart` alone (e.g. `send_local_files` lives in `web_unique.dart`,
not `bridge.dart`). Use a multiline-aware search
(`callMethod\(\s*'(setByName|getByName)'\s*,\s*\[\s*'([^']+)'` with
`re.DOTALL`, or equivalent) - a plain single-line grep misses call sites
where the method name is split onto its own line inside the argument list,
which is most of them.

**Known-unverified, currently-unhandled cases found by that same audit**
(fall through to `default`/console.warn today - not confirmed broken in
practice yet, since none were hit in the log that surfaced the connect
bug, but worth a dedicated pass before relying on them): bare `option`
(`mainGetOption`/`mainSetOption` - distinct from `option:local`/
`option:session`/etc.), `option:peer` (`mainGetPeerOption`/
`mainSetPeerOption` - arbitrary-peer-by-id, distinct from the
currently-connected-peer-scoped `option:flutter:peer`), `load_recent_peers`/
`load_recent_peers_sync`/`load_fav_peers`/`peer_exists`/`peer_has_password`/
`remove_peer` (recent-peers/favorites convenience UI - not on the
manual "enter an ID and connect" path this fix covers).

### Phase 4 - Core UI (Vue shell + engine bootstrap)

#### Phase 4 finding that changed this phase's scope

Before writing the dashboard/settings UI this phase originally called for,
checked `Chr0mX/rustdesk`'s actual Dart source (recovered in Phase 2) for
what the web build's root widget renders. It's decisive, not ambiguous:

- `flutter/lib/main.dart` picks `WebHomePage()` as the app's `home` for web
  builds.
- `WebHomePage` (`flutter/lib/mobile/pages/home_page.dart`) renders
  `ConnectionPage` (`flutter/lib/mobile/pages/connection_page.dart`) - the
  **same connection-entry screen the mobile app uses**: an ID input bar
  with autocomplete, backed by `AllPeersLoader` (a real peer list). Its app
  bar action opens `WebSettingsPage`
  (`flutter/lib/web/settings_page.dart`), which navigates straight to
  `DesktopSettingPage` - **the actual, full desktop settings screen**,
  reused as-is.
- `flutter/lib/web/web_unique.dart` shows Dart also drives file-transfer's
  local-file-picker UI via `setByName('select_files', ...)`/
  `setByName('send_local_files', ...)`.

**The recovered Flutter engine, once built, already renders a complete,
working dashboard - peer list, connect-by-ID, settings, file transfer UI -
using RustDesk's real, shared cross-platform widgets.** None of that needs
to be rebuilt. This directly contradicts this phase's original premise (a
Vue-rendered peer-list dashboard and settings panel) - **the Vue
`Dashboard.vue`/`Settings.vue` views built under that premise (an earlier
Phase 4 slice) are redundant and have been removed**, per the decision
below.

This also means Ant Design Pro-style visual restyling, if it's meant to
change what a user actually *sees* once logged in, is a **Flutter/Dart
theming question in `Chr0mX/rustdesk`**, not a Vue/Element Plus question in
`rustdesk-api-web` - CanvasKit paints those pixels, not the DOM. Out of
scope for this repo unless a future decision explicitly extends it there.

**Decision** (see session notes): keep the Vue app as a **thin pre-engine
gate only** - the outer login page (before the engine loads) and
bootstrapping/hosting the Flutter engine - rather than the alternative
(suppressing Dart's own UI and reimplementing it in Vue, which would mean
touching `Chr0mX/rustdesk`'s Dart UI code, not just consuming it as-is).
Once the engine loads, it owns the entire visible experience.

#### Scope, as revised

- **Login gate**: the existing `Login.vue` (built in an earlier Phase 4
  slice, still needed unchanged) - wires to `POST /api/login`, matching
  what this session's earlier work already established as the pattern for
  the legacy webclient's own login page. This is the *only* Vue-rendered
  screen a logged-in-and-loaded user should ever actually see for more
  than a moment.
- **Engine bootstrap view**: replaces the removed `Dashboard.vue` as the
  post-login route. Loads the Phase 2 `flutter build web` output (`main
  .dart.js` + assets) into the page, calls `bridge.js`'s `initBridge()` so
  `window.setByName`/`.getByName` are live before the engine starts asking
  for data, and gets out of the way - no dashboard UI of its own beyond a
  loading state.
- **`curConn`/`bridge.js` (already scaffolded)**: still exactly as
  necessary as before this finding - Dart's `AllPeersLoader`, connection
  flow, and settings all still call into this JS layer for actual
  networking/data (peer lists, login, video/audio, file transfer), the
  same way `js/dist/index.js` does in the currently-vendored bundle. This
  finding is about who **renders the UI**, not who **owns the
  transport/data layer** - Phase 3's contract is unchanged and still the
  right target.

This phase gets the new shell to "log in, hand off to the real engine,
which renders everything else." Phase 5 verifies that hand-off actually
carries every capability the legacy bundle had.

#### Real build, verified

`npm run build` now succeeds end-to-end against a real deployment (via
`Rustdesk-Server-Installer`'s `update.sh`, which builds `rustdesk-api-web`
from source on every update) - not just this session's `node --check`.
Closes out what was flagged as an open risk earlier in this doc. Getting
here took three real, live-caught bugs, each fixed and verified against
actual published package/repo content rather than assumption:

- `message`/`rendezvous` import specifiers needed no file extension for
  Vite's resolver to find the `.ts` files `ts-proto` generates (`v1`'s own
  `.js`-suffixed imports relied on a TypeScript compiler this project
  doesn't have).
- `SERVER_BRANCH` (used by the install/update scripts' new protobuf-codegen
  step) defaulted to a branch name (`master`) that doesn't exist on
  `Chr0mX/rustdesk-server` (actual default: `forapi`) - and even with the
  right branch, `libs/hbb_common` is a git submodule, so fetching
  `rustdesk-server`'s own tarball was never going to include its content
  at all; needed resolving the submodule's real target repo/commit first.
- `libsodium-wrappers`' published ESM build has a real upstream packaging
  bug (a relative import that can only ever resolve inside its own
  package), and its `package.json` `"exports"` map blocks reaching the
  working CJS build via a subpath specifier - needed an alias to an
  actual resolved filesystem path to sidestep exports-map resolution
  entirely.

**Not yet wired to anything visible.** A successful `npm run build`
produces `dist/webclient.html` + assets, but nothing in `rustdesk-api`
routes a URL at it yet (that's Phase 6, deliberately last), and even if it
were reachable, `Engine.vue` would hit its error state immediately - Phase
2's `flutter build web` still hasn't been run anywhere, so there's no
`main.dart.js` for it to load. The build succeeding confirms the *source*
is sound; it doesn't yet mean there's anything to click through.

### Phase 5 - Feature parity verification

Since the recovered engine (Phase 2) is the real RustDesk client, this
phase is about **verification**, not building capabilities from scratch:

- **File transfer, terminal, clipboard sync, multi-monitor, `view_camera`**
  - confirm each actually works end-to-end through the Phase 2 build as
  launched via the new shell (Phase 4), the same way it works in the
  legacy compiled bundle. Any gap here is either a Phase 2 build issue
  (the recovered engine build is missing/misconfigured something) or a
  Phase 3/4 issue (the shell isn't invoking/exposing it correctly) - triage
  accordingly rather than assuming it needs new engine-level code.
- **Remaining legacy features** - anything else surfaced by comparing
  against the legacy client directly - call these out explicitly as found
  rather than discovering them post-cutover.
- **Compatibility testing** - systematic side-by-side comparison against
  the legacy client (still available at its Phase 0 slug) for every item in
  the Scope list, before Phase 6 is allowed to start.

Exit criteria: every item in the Scope section's "in scope" list works in
the new shell + recovered engine, or has an explicitly recorded, approved
exception appended to this doc.

#### Phase 5 findings (retroactive - done post-cutover, not before)

Phase 6 shipped before this phase was formally run (see Phase 6's own
notes - cutover became urgent once the connect/video-decode bugs below
were found live). This is the deferred pass, done by cross-referencing
every `setByName`/`getByName` call site across all of `flutter/lib/web/`
(not just `bridge.dart`) against `bridge.js`'s actual case list, then
checking each matched case's `curConn.js` implementation for whether it's
real or a stub. ~60 distinct engine↔shell calls audited, current count:
29 confirmed working, 7 wired to an explicit stub (visible in the UI,
does nothing), 17 have no handler at all (silently unhandled), 11 are a
hard platform ceiling (`web/bridge.dart` itself throws
`UnimplementedError` - not reachable from any web build, ours or
legacy's, so not a parity gap). Updated same day as first written -
audio, the Recents tab, and the whole stubbed-toolbar batch (PRs
#50-#52) moved from stub/missing to working; see below for what's still
open. A published audit artifact with the full per-feature breakdown
exists alongside this doc (not repo-tracked, ask if you need the link
regenerated).

**Working** (includes many fixed live this session, via PRs #43-#52):
connect/disconnect lifecycle, reconnect, video decode (all 5 codecs, via
ffmpeg-core.wasm), audio playback (via libopus.wasm, same reuse-not-
rebuild approach), mouse input, remote cursor image, keyboard (Legacy
mode), quality monitor + toolbar indicator (delay/bitrate/fps/speed/codec/
chroma), scroll/view style, image quality, custom image quality, custom
FPS, codec switching, alternative-codecs list, show-quality-monitor
toggle, virtual display, privacy mode, elevation (direct + with-logon),
restart, personal/shared address book, groups, recent peers (no native
history file to read on web, so `curConn.js`'s `recordRecentPeer()`
builds it from every successful connection instead), network settings,
Account tab, "this desktop" server-settings defaults, UI text (~140
strings via `translations.js`, sourced from the engine's own
`src/lang/en.rs`).

**Stubbed** (UI present, does nothing): file transfer/browse/cancel-job
(already flagged as needing real protocol work), per-session login 2FA,
live online-status polling (`query_onlines`), language picker
(English-only), audit notes (`send_note`/`setAuditGuid` - the
audit-server URL itself is wired), favorites (`load_fav_peers` now reads
real, if empty, storage instead of being unhandled, but nothing writes to
it yet - "Add to Favorites" itself isn't wired anywhere).

**Missing entirely** (falls through to the generic unhandled-case
warning - no prior stub at all): keyboard Map Mode (`flutter_key_event` -
needs the full USB-HID→RustDesk keycode table, same class of gap as
`input_key`'s own `mapKey()`/`KEY_MAP`, see item 4 above), local→remote
clipboard (peer→local already works; sync is currently one-way) and
multi-format clipboard (`multi_clipboards`, only the older single-format
`clipboard` message is handled), terminal (open/close/resize/send-input -
the whole feature area), file management (`select_files`/`create_dir`/
`rename_file`/`remove_file`/`remove_all_empty_dirs`/
`read_dir_to_remove_recursive`/`confirm_override_file`), account-auth
(`account_auth`/`account_auth_cancel`/`account_auth_result` - worth a
live check for reachability given the 2FA-setup platform-ceiling item
below), per-peer alias/existence/password checks (`option:peer`/
`peer_exists`/`peer_has_password`), remove-peer, peer-sent message boxes
(the wire-level `message_box` field - distinct from this client's own
internally-generated msgbox calls, which do work), and several
low-traffic info getters (`envvar`, `build_date`, `conn_session_id`,
`last_audit_note`, `platform`, `resolve_avatar_url`, `local_os`, `fav`).

**Platform ceiling** (not a gap - `web/bridge.dart` throws
`UnimplementedError` directly): LAN discovery, RDP tunneling, acting as a
host (Connection Manager functions), voice calls, Wake-on-LAN, the plugin
system, native installer flows, account-level 2FA setup (`mainGenerate2Fa`/
`mainVerify2Fa`/`mainVerifyBot` - distinct from per-session login 2FA
above, which *is* reachable), native trackpad-speed tuning, native
screenshot capture.

Recommended order (impact vs. effort), updated: "Add to Favorites" writer
→ local→remote clipboard → file transfer → terminal → keyboard Map Mode →
remaining small getters.

### Phase 6 - Cutover

- Switch `/webclient`: `rustdesk-api` points `router.go`'s
  `wc.StaticFS(...)` for `/webclient/` (the canonical path) at the new
  build output instead - now a composite of the Vite-built Vue shell
  (Phase 4) and the `flutter build web --release` engine output (Phase 2),
  the same two-part structure as today's bundle, just both parts built from
  source instead of one being vendored. `ConfigJs`, `WebclientAuth`,
  `WebclientLogin`/`WebclientLogout` stay as-is - the new frontend reads the
  same injected `localStorage` values (or, better, we simplify `ConfigJs`
  at this point since it won't need to satisfy two different localStorage
  namespaces anymore - one real win of owning the source).
- Keep legacy path as optional fallback: the legacy client needs no changes
  here at all - it's already living at its own slug with its own admin
  toggle since Phase 0, so this phase is purely "repoint the canonical
  URL," not "stand up a fallback path under time pressure." Leave the
  legacy path enabled by default for at least one release cycle
  post-cutover, then it's the admin's call whether to keep it around (some
  deployments may want it available indefinitely as a manual fallback) or
  disable/remove it.
- Regression testing: re-run Phase 5's compatibility pass against the newly
  repointed `/webclient/` itself (not just the pre-cutover build), since
  cutover is the point real users hit the new client by default.
- Once there's confidence the new client is stable and the legacy path is
  disabled for good in a given deployment, `resources/web/PATCHES.md`
  becomes moot for that deployment (nothing compiled left to patch) - but
  since the legacy path is designed to be a standing, admin-controlled
  option rather than a time-boxed rollback window, there's no fixed
  deadline to actually delete `resources/web`/the patch notes from the
  repo; that's a separate decision from cutover itself.

## Future: merging the admin dashboard and webclient

Noted for later, not actionable now, and smaller in scope than originally
imagined: since Phase 4's findings, the webclient app is a thin login gate
(one screen) plus an engine-hosting view, not a full parallel dashboard -
there's much less to "merge" with `_admin` than this section originally
pictured. What's still real: both apps share the same Vue 3 + Element Plus
codebase and could share auth state/routing for the login step specifically
(e.g. an already-logged-in admin skipping straight past the webclient's own
login gate - `webclientSession`/`webclientBridge` in `src/api/config.js`
already do something like this today). Revisit once Phase 6 ships; not
worth designing further now.

## Risks

- **Recovering `flutter/web` and getting `flutter build web --release`
  working again (Phase 2) is the single biggest unknown in this plan.**
  Neither upstream `rustdesk/rustdesk` nor `Chr0mX/rustdesk` has had a
  working web build target in over a year (the last commit to touch
  `flutter/web` before deletion was the 2024-06-22 `v1`/`v2` split); the
  recovered snapshot is not guaranteed to build cleanly or to exactly
  reproduce what's in today's vendored bundle. Treat Phase 2 as a real
  go/no-go gate - if it turns out irrecoverable or prohibitively difficult
  to get building, this plan needs to fall back to keeping `main.dart.js`
  vendored as an opaque binary (still confirmed working today) and scoping
  the rebuild down to just the shell, same as the alternative considered
  and set aside when this pivot was decided.
- ~~The shell/engine interop contract (Phase 3) is currently
  undocumented.~~ **Resolved** - found directly in `Chr0mX/rustdesk`'s
  Dart source once Phase 2 made it readable again (`js.context.callMethod
  ('setByName'/'getByName', ...)` plus a handful of registered `window`
  callbacks, `onRgba` chief among them). See Phase 3 findings. The
  remaining risk here is narrower: whether the Vue shell's own
  `curConn`-equivalent object faithfully implements every `setByName`/
  `getByName` case the recovered engine calls, not whether the mechanism
  itself is discoverable.
- Building `Chr0mX/rustdesk`'s Flutter app for web requires a real Flutter
  toolchain, which was not available in this session's sandbox - this
  entire investigation (Phase 1's live-deployment confirmations aside) was
  static analysis plus a local, network-restricted headless-Chromium
  repro. Phase 2 in particular needs a proper dev/CI environment with
  Flutter, not just code review.
- No `cargo`/`npm`/Go-module-proxy/apt network access has been available in
  this session's sandbox for build verification generally - every phase
  needs real build/test verification in an environment that actually has
  it, not just code review. **Partially resolved for `rustdesk-api-web`**:
  the actual deployment's `update.sh` now builds it from source on every
  run and has caught (and driven fixes for) three real bugs no amount of
  sandboxed code review would have - see "Real build, verified" under
  Phase 4. Still fully open for Phase 2's Flutter build specifically, and
  for `rustdesk-api`/`rustdesk-server` Go/Rust builds beyond what this
  session's `go build`/`cargo` attempts already covered earlier.
- **Visual styling is now largely out of `rustdesk-api-web`'s control.**
  Phase 4's finding means the dashboard/settings/connection UI a user sees
  is whatever `Chr0mX/rustdesk`'s Dart/Flutter theme produces, not
  something this repo's Vue/Element Plus code can restyle. If matching Ant
  Design Pro's look for the *whole* experience (not just the login gate)
  turns out to matter to stakeholders, that's a real, separate Flutter
  theming project in `Chr0mX/rustdesk` - not scoped or estimated here.
