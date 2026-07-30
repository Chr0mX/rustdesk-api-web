# Webclient rebuild plan: from-source replacement of the compiled bundle

## Goal

Replace the legacy compiled webclient (`resources/web` in `rustdesk-api`,
currently patched by hand per `resources/web/PATCHES.md`) with a fully
source-available implementation that achieves **feature parity with the
legacy webclient before `/webclient` is repointed** to it: a new Vue 3
dashboard/login/settings shell (styled to match Ant Design Pro's visual
language, same approach as the `_admin`/login restyle already done) hosting
the *actual* RustDesk remote-desktop engine, built from source rather than
vendored as an opaque binary. The goal is a true replacement, not a minimum
viable one - so the whole thing is finally something we can actually read,
test, and fix instead of hex-patching a black box, without asking users to
fall back to the legacy client for anything they could already do.

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
2. Write the new Vue 3 + Element Plus dashboard/login/settings shell (the
   piece whose source was genuinely never published - `flutter/web/v2` was
   always just a `README.md` saying "Under dev.") to host that from-source
   Flutter build, the same way `index.js` currently hosts the compiled one.
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
| Vue 3 dashboard/login/settings shell, the shell/engine interop layer (Phase 3/4), embedding the Phase 2 build output | `rustdesk-api-web` | Per instruction: default location unless there's a specific reason not to. This is the piece whose source was genuinely never published (`flutter/web/v2` was always just "Under dev."). |
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

- Recover `flutter/web` from git history at `5faf0ad3^` (the commit right
  before upstream deleted it) into a branch of `Chr0mX/rustdesk`. Confirmed
  contents at that commit: `v1`/`v2` only (see Phase 1 findings) - this is
  the JS-shell lineage, not Flutter's own web scaffold, so restoring it is
  necessary but likely not sufficient on its own for `flutter build web` to
  succeed; expect to need to reconstruct or regenerate whatever else
  Flutter's web target needs (a standard `flutter create --platforms web`
  scaffold if one never existed in-tree, or was tracked elsewhere).
- Get `flutter build web --release` running successfully against
  `Chr0mX/rustdesk`'s `flutter/` app (matching upstream's now-broken CI
  step in `.github/workflows/flutter-build.yml`'s `web-basic` job, which
  can be used as a reference for the expected build steps even though it
  currently fails). Requires a real Flutter toolchain - not available in
  this session's sandbox, needs a proper dev/CI environment.
- Confirm the resulting `main.dart.js` can at minimum reach `hbbs` and
  complete a login handshake against `rustdesk-server` - the equivalent of
  the "test in isolation, headless" step the old Phase 2 called for, just
  against a real Dart build instead of a ported TypeScript one.
- Don't assume this recovered snapshot exactly reproduces today's vendored
  `main.dart.js` - version/behavior differences are possible and should be
  diffed against the current deployment (asset hashes, `version.json`,
  visible feature set) rather than assumed identical.

Exit criteria: a from-source `flutter build web --release` succeeds and
produces a `main.dart.js` that completes a real connection to a test peer
through `rustdesk-server`.

### Phase 3 - Shell/engine interop contract

A short, focused investigation before UI work starts, since this wasn't
found via static analysis of the compiled bundle (no `postMessage` or
shared-global coordination code turned up between `index.js` and
`main.dart.js`) and the new Vue shell needs to know how to host the Phase 2
build correctly:

- Determine how the JS shell hands connection config (peer ID, credentials,
  server overrides, `ws_host`) to the Flutter engine - likely Dart/JS
  interop (`dart:js_interop` or similar) reading `window`-scoped globals or
  `localStorage`, given `ws_host` is confirmed live but never appears as a
  literal string in the minified bundle (consistent with interop-based
  access surviving dart2js renaming while the shell-side JS wouldn't need
  to reference it at all).
- Determine whether the engine emits anything back out (connection-state
  changes, file-transfer progress, errors) that the shell would need to
  react to, or whether it's fully self-contained once started (no visible
  chrome from the shell during an active connection would suggest the
  latter - worth confirming either way).
- A build of `Chr0mX/rustdesk`'s Flutter app in **debug/profile mode**
  (unminified, with source maps) rather than `--release` would make this
  much faster to inspect than reverse-engineering the production
  `main.dart.js` - do this investigation against that, not the minified
  bundle.

Exit criteria: a short written note (append to this doc) on the actual
embedding contract - what the Vue shell needs to set up (DOM structure,
globals, config injection) before/while hosting the engine.

### Phase 4 - Core UI (Vue 3 + Element Plus, Ant Design Pro visual language)

Net-new work, since `v2`'s UI source was never available to port from:

- Peer-list dashboard (recent/favorite/LAN-discovered/group/address-book
  peers, online-status polling) - reusing `rustdesk-api`'s existing
  `/api/users`, `/api/peers`, `/api/ab`, `/api/device-group/accessible`
  endpoints, which already exist and are already used by `_admin` in
  similar form.
- Settings panel (General/Network/Display/Account tabs) - Account tab wires
  directly to the *existing* `POST /api/login` / account endpoints this
  session's work already established as the pattern (no new backend auth
  work needed - reuse `wc_sess`/`ConfigJs`'s existing model, just render it
  natively instead of syncing into two different localStorage namespaces
  the way the compiled bundle forced us to).
- Connection entry point that embeds/launches the Phase 2 Flutter engine
  build per Phase 3's interop contract - not a hand-built canvas/input
  layer, since the engine already owns rendering, input capture, and
  quality settings.
- Visual language: Ant Design Pro's look (card layout, primary color,
  sidebar/header conventions) reusing the same restyle approach already
  applied to `_admin`'s login page and layout shell this session - CSS/
  component-styling work, not a new framework.

This phase gets the new shell to "dashboard works, launches a connection
through the real engine." Phase 5 verifies that connection actually carries
every capability the legacy bundle had.

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

Noted for later, not actionable now: since this plan puts the new webclient
in the *same* Vue 3 + Element Plus codebase as `_admin` (rather than a
separate framework), merging them into one experience later is a real,
reachable option - shared routing/nav, shared auth state, no
framework-porting cost, since it's already one app. Revisit once Phase 6
ships and the webclient has been stable for a bit; premature to design now.

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
- **The shell/engine interop contract (Phase 3) is currently undocumented.**
  No `postMessage` or shared-global coordination code was found via static
  search of the compiled bundle. If the actual mechanism turns out to be
  something narrow/fragile (e.g. relies on exact DOM structure or timing
  the current `index.html` happens to provide), the new Vue shell may need
  to replicate more of that structure than expected.
- Building `Chr0mX/rustdesk`'s Flutter app for web requires a real Flutter
  toolchain, which was not available in this session's sandbox - this
  entire investigation (Phase 1's live-deployment confirmations aside) was
  static analysis plus a local, network-restricted headless-Chromium
  repro. Phase 2 in particular needs a proper dev/CI environment with
  Flutter, not just code review.
- No `cargo`/`npm`/Go-module-proxy/apt network access has been available in
  this session's sandbox for build verification generally - every phase
  needs real build/test verification in an environment that actually has
  it, not just code review.
