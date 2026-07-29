# Webclient rebuild plan: from-source replacement of the compiled bundle

## Goal

Replace the compiled/vendored webclient bundle (`resources/web` in `rustdesk-api`,
currently patched by hand per `resources/web/PATCHES.md`) with a from-source
Vue 3 implementation living in `rustdesk-api-web`, styled to match Ant Design
Pro's visual language (same approach as the `_admin`/login restyle already
done), so the whole thing is finally something we can actually read, test,
and fix instead of hex-patching a black box.

This does **not** mean rewriting a remote-desktop engine from scratch. See
"Why this is tractable" below - we have a real, recovered starting point for
the hard part (the WebSocket transport + protocol layer).

## Why this is tractable

Investigated this via `rustdesk/rustdesk`'s git history (see session notes):

- `flutter/web/v1` (removed from upstream `master` on 2025-07-01, commit
  `5faf0ad3`) is **real, complete source** - recoverable from git history.
  Its `websock.ts` is, near-verbatim (identical debug log strings:
  `"WebSock.onopen"`, `"WebSock.onclose"`, `"Closing WebSocket connection"`),
  the direct ancestor of the current compiled bundle's transport layer. This
  is not a guess - it's the same code, confirmed by exact string match.
- `flutter/web/v2` was **never populated** in the public repo - its entire
  history is a single `README.md` containing `"Under dev."`. There is no v2
  source to recover; the dashboard/Settings/Account UI we're replacing was
  developed and shipped without ever publishing its source.
- `v1`'s protocol layer (`message.ts`/`rendezvous.ts`) isn't hand-written -
  it's generated at build time via `protoc` (`ts_proto.py`) against
  `hbb_common`'s `.proto` files. **`rustdesk-server` (this fork) already
  vendors `libs/hbb_common` as a submodule** - the exact same protos hbbs/hbbr
  itself uses. So the protocol layer can be kept in sync with the real wire
  format by re-running codegen against a repo we already own and update,
  with no dependency on `Chr0mX/rustdesk` (the client fork) at all.

## Scope / non-goals

- In scope: peer-list dashboard, Settings (General/Network/Display/Account),
  connecting to a peer, video/audio playback, keyboard/mouse input, the
  account login/logout flows this session already wired up server-side.
- Out of scope for v1 of this effort: file transfer, terminal, and any
  feature not already present in the recovered `v1` source, unless it turns
  out the current compiled bundle relies on the backend for something we'd
  otherwise silently drop. Each such gap gets called out explicitly during
  Phase 2, not discovered in production.
- Out of scope entirely: touching `Chr0mX/rustdesk` (the native client fork).
  Nothing in this plan currently requires it (see protocol-layer point
  above). If a real need surfaces (e.g. we need `client.rs`-derived
  constants like `KEY_MAP`/`checkIfRetry` that `v1`'s `gen_js_from_hbb.py`
  pulled live from that repo), the plan is to vendor a small, hand-copied
  snapshot of just those constants into `rustdesk-api-web`, not take on a
  live cross-repo source dependency on a repo we don't otherwise touch.

## Repo split

| Work | Repo | Why |
|---|---|---|
| Everything below (transport, protocol codegen consuming hbb_common's protos, connection logic, codec, UI) | `rustdesk-api-web` | Per instruction: default location unless there's a specific reason not to. |
| Read-only source of `.proto` files for codegen | `rustdesk-server` (`libs/hbb_common/protos/*.proto`) | Already vendored there; no changes needed to that repo, just read its files at our build time (e.g. a small script/submodule reference, or a one-time vendored copy re-synced when hbb_common bumps). |
| Legacy-slug route + admin toggle (Phase 0), and later the `/webclient/*` route swap (Phase 5) | `rustdesk-api` | The Go backend owns routing. Phase 0 adds a new config-gated path serving today's compiled bundle unchanged; Phase 5 later points `router.go`'s `wc.StaticFS(...)` for the canonical `/webclient/` path at the new build's output instead. Neither is new logic - `ConfigJs`, `WebclientAuth`, `WebclientLogin`/`WebclientLogout`, and the wc_sess session model all stay exactly as they are today. |

## Phases

### Phase 0 - Relocate the legacy webclient behind its own slug + admin toggle

Ships **before** any rebuild investigation starts. Small, standalone,
immediately useful on its own regardless of whether the rest of this plan
ever ships - and it's a cheap rehearsal of the exact routing touchpoint
Phase 5 (Cutover) needs anyway.

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
  repointed at the new Vue app later, in Phase 5.
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
   practice. This determines whether Phase 2-4 is a full replacement or
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

### Phase 2 - Transport + protocol layer

- Port `websock.ts` into `rustdesk-api-web` (TypeScript, framework-agnostic -
  no Vue dependency needed at this layer).
- Wire up the `hbb_common`-sourced protobuf codegen as a build step (a
  package.json script, mirroring `v1`'s `ts_proto.py` but pointed at
  wherever we vendor/reference `rustdesk-server`'s protos from).
- Port `connection.ts`, adjusting anything Phase 1's spike found
  incompatible with the current protocol/handshake.
- Port the encryption/handshake logic (`libsodium`-based, matches what we
  already confirmed the compiled bundle uses via `crypto_sign_open`).
- **Test in isolation**, headless (no UI): script a connection to a real
  test peer through this layer alone and confirm login + a single video
  frame decodes, before building any UI on top of it. This is the
  highest-risk layer; validate it works before sinking time into UI work
  that would be wasted if it doesn't.

### Phase 3 - Video/audio codec

- Implement per Phase 1's decision (reuse existing WASM decoders vs.
  WebCodecs). Either way, this replaces `v1`'s stale `codec.js` entirely -
  not a straight port.
- Audio: `v1` used `pcm-player`; confirm this (or an equivalent) still
  covers what's needed for the audio format `hbbs`/peers currently send.

### Phase 4 - UI (Vue 3 + Element Plus, Ant Design Pro visual language)

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
- Connection viewer (canvas render target, keyboard/mouse input capture,
  Ctrl+Alt+Del, multi-display switching, quality settings) driven by
  Phase 2/3's transport+codec layer.
- Visual language: Ant Design Pro's look (card layout, primary color,
  sidebar/header conventions) reusing the same restyle approach already
  applied to `_admin`'s login page and layout shell this session - CSS/
  component-styling work, not a new framework.

### Phase 5 - Cutover

- `rustdesk-api`: point `router.go`'s `wc.StaticFS(...)` for `/webclient/`
  (the canonical path) at the new Vue app's build output instead.
  `ConfigJs`, `WebclientAuth`, `WebclientLogin`/`WebclientLogout` stay as-is
  - the new frontend reads the same injected `localStorage` values (or,
  better, we simplify `ConfigJs` at this point since it won't need to
  satisfy two different localStorage namespaces anymore - one real win of
  owning the source).
- The legacy client needs no changes here at all - it's already living at
  its own slug with its own admin toggle since Phase 0, so this phase is
  purely "repoint the canonical URL," not "stand up a fallback path under
  time pressure." Leave the legacy path enabled by default for at least one
  release cycle post-cutover, then it's the admin's call whether to keep it
  around (some deployments may want it available indefinitely as a manual
  fallback) or disable/remove it.
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
framework-porting cost, since it's already one app. Revisit once Phase 5
ships and the webclient has been stable for a bit; premature to design now.

## Risks

- Phase 1 finding that `main.dart.js` is load-bearing for something
  non-trivial would meaningfully change scope - treat Phase 1 as a real
  go/no-go gate, not a formality.
- Protocol drift since `v1` was last touched (mid-2024) is the single
  biggest unknown - Phase 1 item 4 and Phase 2's isolated connection test
  exist specifically to surface this early, before UI work depends on it.
- No `cargo`/`npm`/Go-module-proxy network access has been available in
  this session's sandbox for build verification - every phase needs real
  build/test verification in an environment that actually has it, not just
  code review.
