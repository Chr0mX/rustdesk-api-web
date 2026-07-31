// The actual shell/engine interop contract found in Phase 3 (see
// docs/WEBCLIENT_V2_REBUILD_PLAN.md) - registers window.setByName and
// window.getByName exactly as the recovered Flutter engine's
// flutter/lib/web/bridge.dart expects (js.context.callMethod('setByName'/
// 'getByName', ...)), dispatching into a singleton CurConn instance. This
// is new glue code (not ported from anywhere - the minified compiled
// bundle's actual dispatcher isn't real source), written to match the
// case list Phase 3 found live in js/dist/index.js.
//
// window.onRgba/window.onGlobalEvent are NOT registered here - those are
// registered BY the Flutter engine itself (see web_model.dart), and
// globals.js's draw()/pushEvent() call them. This file only owns the
// Dart -> JS direction.
import CurConn, { testDelay, getApiServer } from './curConn'
import translations from './translations'

// getByName("get_version_number")'s encoding - ported verbatim from the
// legacy bundle's own K() (resources/web/js/dist/index.js). Not a standard
// semver-to-int scheme: every dotted component before the last is
// accumulated base-1000, but the last one is scaled by 10 instead (then a
// trailing "-N" build suffix, if present, is added on top of that) -
// deliberately kept exactly as found rather than "fixed" into a cleaner
// encoding, since callers compare this against the same function's output
// for other versions, not against some independently-documented format.
function parseVersionNumber (v) {
  try {
    const parts = v.split('-')
    let i = 0
    let n = 0
    if (parts.length > 0) {
      for (const a of parts[0].split('.')) {
        n = parseInt(a) || 0
        i = i * 1000 + n
      }
      i -= n
      i += n * 10
    }
    if (parts.length > 1) i += parseInt(parts[1]) || 0
    return i
  } catch (e) {
    console.error(`Failed to parse version number: "${v}" ${e.message}`)
    return 0
  }
}

let curConn

// bridge.dart's mainGetLocalOption/mainSetLocalOption ("option:local"),
// and the analogous "option:user:default"/"option:flutter:local" cases,
// are NOT per-peer connection settings - they're used for things like
// access_token/user_info (models/user_model.dart's refreshCurrentUser()/
// getLocalUserInfo(), which is what backs the engine's own Settings ->
// Account tab), lang, kb_layout, input-source, and hard-settings flags
// (isDisableAccount/isDisableGroupPanel/etc, all via mainGetLocalOption
// too). These were previously routed through curConn.getOption/setOption
// (curConn.js's own `_options`, loaded from globals.getPeers()[id] - a
// specific PEER's remembered connection settings, only populated after
// connecting to that peer) - so mainGetLocalOption('access_token') always
// read undefined/''. That's why the engine's own Account tab showed
// "not logged in" regardless of this webclient's real (Vue-side) auth
// state: bind.mainGetLocalOption(key: 'access_token') never saw the
// access_token curConn.js itself already reads directly from
// localStorage elsewhere (see _start()'s punch_hole_request) - a plain,
// unprefixed key, which is also exactly what rustdesk-api's ConfigJs
// (http/controller/web/index.go) seeds. So "option:local" reads/writes
// plain localStorage keys directly (no extra namespacing - deliberately
// matching what's already there for access_token/user_info), while
// "option:user:default"/"option:flutter:local" get their own namespaced
// prefixes only to avoid colliding with option:local's plain keys or
// each other - nothing external needs to read those two.
function getLocalOption (key) {
  return localStorage.getItem(key) || ''
}
function setLocalOption (key, value) {
  if (value === undefined || value === null) {
    localStorage.removeItem(key)
  } else {
    localStorage.setItem(key, value)
  }
}
function getUserDefaultOption (key) {
  return localStorage.getItem('option:user:default:' + key) || ''
}
function setUserDefaultOption (key, value) {
  if (value === undefined || value === null) {
    localStorage.removeItem('option:user:default:' + key)
  } else {
    localStorage.setItem('option:user:default:' + key, value)
  }
}
function getFlutterLocalOption (key) {
  return localStorage.getItem('option:flutter:local:' + key) || ''
}
function setFlutterLocalOption (key, value) {
  if (value === undefined || value === null) {
    localStorage.removeItem('option:flutter:local:' + key)
  } else {
    localStorage.setItem('option:flutter:local:' + key, value)
  }
}
// bridge.dart's mainGetOptionSync/mainSetOption - bare getByName/setByName
// "option" (distinct from "option:local"/"option:session"/etc above), the
// generic local-config store Rust's own Config::get_option/set_option
// backs on native platforms (Settings -> "This Desktop"/acting-as-server
// options: verification-method, temporary-password-length, approve-mode,
// allow-numeric-one-time-password, stop-service, and others in the same
// family). Entirely unhandled before, spamming the console on every one
// of ServerModel's periodic polls. A webclient never acts as a server -
// there's no host-side daemon here for these to actually configure - but
// they still need *a* backing store rather than an unhandled-case warning
// every poll; own namespaced prefix (like option:user:default/
// option:flutter:local above) so it can't collide with option:local's own
// plain keys.
function getMainOption (key) {
  return localStorage.getItem('option:main:' + key) || ''
}
function setMainOption (key, value) {
  if (value === undefined || value === null) {
    localStorage.removeItem('option:main:' + key)
  } else {
    localStorage.setItem('option:main:' + key, value)
  }
}

// mainGetEnv/mainSetEnv (bridge.dart) - "Use the global variable as the
// environment variable in web," per bridge.dart's own comment - a plain
// per-browser KV store, not real environment variables.
function getEnvVar (key) {
  return localStorage.getItem('envvar:' + key) || ''
}
function setEnvVar (key, value) {
  if (value === undefined || value === null) {
    localStorage.removeItem('envvar:' + key)
  } else {
    localStorage.setItem('envvar:' + key, value)
  }
}

// bridge.dart's mainGetFav/mainStoreFav - the bare getByName/setByName
// "fav" case (distinct from "load_fav_peers") is what "Add to Favorites"
// actually calls (confirmed in common/widgets/peer_card.dart:
// bind.mainGetFav() -> add/remove the id -> bind.mainStoreFav(favs)), and
// it's just a JSON array of peer ID strings, not full peer records - the
// full records "load_fav_peers" needs for display are looked up
// separately (see buildPeerRecordsById below).
function getFavIds () {
  try {
    return JSON.parse(localStorage.getItem('fav_ids') || '[]')
  } catch (e) {
    return []
  }
}
function setFavIds (ids) {
  localStorage.setItem('fav_ids', JSON.stringify(ids))
}

// Resolves a list of peer IDs into Peer.fromJson-shaped records for
// display (the "load_fav_peers"/"load_recent_peers" pushEvent payload) by
// looking them up in recent_peers_cache - the one place this file already
// keeps full records (curConn.js's recordRecentPeer(), written on every
// successful connect). A favorited peer never connected to yet (added
// straight from the address book, say) won't have an entry there, so
// falls back to an otherwise-empty record carrying just the id - Dart
// still renders a card, just without username/hostname until it connects
// once.
function buildPeerRecordsById (ids) {
  let recents = []
  try {
    recents = JSON.parse(localStorage.getItem('recent_peers_cache') || '[]')
  } catch (e) {
    recents = []
  }
  const byId = {}
  for (const p of recents) byId[p.id] = p
  return ids.map((id) => byId[id] || {
    id,
    hash: '',
    password: '',
    username: '',
    hostname: '',
    platform: '',
    alias: '',
    tags: [],
    forceAlwaysRelay: 'false',
    rdpPort: '',
    rdpUsername: '',
    loginName: '',
    device_group_name: '',
    note: '',
  })
}

// bridge.dart's mainLoadAb/mainLoadGroup are NOT getByName pulls - they
// register a completer under window.onLoadAbFinished/onLoadGroupFinished
// (with a 2s timeout) and THEN call setByName("load_ab"/"load_group") with
// no argument, expecting us to call that completer back asynchronously
// with the cached JSON once we have it. Previously entirely unhandled, so
// Dart's own 2s timeout always fired and resolved the Future with the
// literal string "Timeout" - confirmed live ("load ab cache:
// FormatException: SyntaxError: Unexpected token 'T', "Timeout" is not
// valid JSON", since whatever called mainLoadAb() then tried to
// JSON-decode that placeholder). Ported the legacy bundle's own contract
// (resources/web/js/dist/index.js's vs()/xs()/Ka()/$o()): call the
// *Finished callback synchronously with either the cached entry or a
// default empty structure - Dart expects a String either way, never an
// error, so there's no real "not found" case to signal. Deliberately NOT
// porting the legacy bundle's own encryption of this cache (Wa()/qa()) -
// this cache isn't shared with that bundle's storage at all (different
// keys entirely), so there's nothing to interoperate with, and Dart's own
// httpClient/api-token gate already protects the actual data in transit.
function loadCachedEntries (storageKey, emptyDefault, finishedCallbackName) {
  let result
  try {
    result = localStorage.getItem(storageKey) || JSON.stringify(emptyDefault)
  } catch (e) {
    result = ''
  }
  if (typeof window[finishedCallbackName] === 'function') {
    window[finishedCallbackName](result)
  }
}

export function initBridge () {
  curConn = new CurConn()
  testDelay()

  // Not part of the setByName/getByName contract - models/web_model.dart's
  // PlatformFFI.init() calls this bare global directly
  // (context.callMethod('init')) as one of its first startup actions,
  // before ever reaching the code that renders anything. It also registers
  // context["onInitFinished"] (a Completer.complete callback) synchronously
  // just before that call, and its own init() Future doesn't resolve until
  // that callback fires - so PlatformFFI.init() would hang forever
  // awaiting it if nothing ever called window.onInitFinished(). v1's own
  // window.init kicked off yuv/opus decode workers, VP9 and zstd here -
  // none of that's wired up yet (see globals.js's initAudio/playAudio and
  // curConn.js's loadVideoDecoder stubs), so this is a no-op until Phase
  // 4/5 gets to audio/video codecs - but it still has to exist and still
  // has to signal completion, or Dart's own init sequence never finishes.
  window.init = async () => {
    if (typeof window.onInitFinished === 'function') {
      window.onInitFinished()
    }
  }

  window.setByName = (name, arg) => {
    switch (name) {
      // bridge.dart never actually calls setByName("connect", ...) - that
      // was this file's original (wrong) guess at the contract. The real
      // connect flow (models/model.dart's PeerTabModel session-start path)
      // is bind.sessionAddSync() immediately followed by bind.sessionStart()
      // (flutter/lib/web/bridge.dart), which dispatch as "session_add_sync"
      // (JSON: id/password/is_shared_password/isFileTransfer/isViewCamera/
      // isTerminal) and "session_start" (JSON: {id}) respectively - neither
      // was handled here, so every connect attempt silently fell through to
      // the default/unhandled-case branch and curConn.start() never ran at
      // all (confirmed live: zero "Connecting to rendezvous server" log
      // lines despite the user attempting to connect). sessionAddSync's
      // return value is explicitly ignored by its one real caller for a
      // fresh connection (model.dart: `// ignore: unused_local_variable`),
      // so '' is fine here - only sessionAddExistedSync's return is
      // actually checked, and that one (tab -> window reuse) never reaches
      // JS at all (flutter/lib/web/bridge.dart's stub returns '' directly,
      // see line 68-75). Only the default remote-desktop connection type is
      // implemented (see README.md item 5), so warn rather than silently
      // ignoring a file-transfer/view-camera/terminal attempt.
      case 'session_add_sync': {
        const e = JSON.parse(arg)
        if (e.isFileTransfer || e.isViewCamera || e.isTerminal) {
          console.warn('setByName("session_add_sync") - file transfer/view camera/terminal sessions are not implemented, only the default remote desktop connection is supported', arg)
        }
        curConn = new CurConn()
        return ''
      }
      case 'session_start': {
        const e = JSON.parse(arg)
        curConn?.start(e.id)
        break
      }
      case 'login':
        curConn.handle_login_from_ui(...Object.values(JSON.parse(arg)))
        break
      // web/custom_cursor.dart's CursorManager.setSystemCursor/
      // resetSystemCursor - sets the actual remote cursor image while the
      // pointer is over the session, via a CSS `cursor` style on the
      // <flutter-view> element (not through onGlobalEvent/pushEvent at
      // all - a separate, direct setByName call). Entirely unhandled
      // before, so the pointer never showed anything but the browser's
      // plain default arrow, no matter what shape the remote cursor
      // actually was - confirmed against the legacy bundle's own ss()
      // (resources/web/js/dist/index.js), ported verbatim (same "auto"
      // bare-string vs JSON {url,hotx,hoty} cases, same target element).
      case 'cursor': {
        let style = 'auto'
        if (arg !== 'auto') {
          try {
            const c = JSON.parse(arg)
            if (!c.url) break
            style = `url(${c.url}) ${c.hotx} ${c.hoty}, auto`
          } catch (e) {
            console.error('Failed to set custom cursor: ' + e.message)
            break
          }
        }
        for (const el of document.body.children) {
          if (el.tagName === 'FLUTTER-VIEW') el.style.cursor = style
        }
        break
      }
      // Same wrong-guessed-name bug as session_add_sync/session_start above -
      // bridge.dart's sessionClose (flutter/lib/web/bridge.dart) dispatches
      // as "session_close", never "close". Unhandled, this meant clicking
      // disconnect never actually tore down the WebSocket/curConn instance.
      case 'session_close':
        curConn?.close()
        break
      case 'refresh':
        curConn.refresh()
        break
      case 'reconnect':
        curConn?.reconnect()
        break
      case 'toggle_virtual_display':
        curConn.toggleVirtualDisplay(arg)
        break
      case 'toggle_privacy_mode':
        curConn.togglePrivacyMode(arg)
        break
      case 'image_quality':
        curConn.setImageQuality(arg)
        break
      case 'custom_image_quality':
        curConn.setCustomImageQuality(arg)
        break
      case 'custom-fps':
        curConn.setCustomFps(arg)
        break
      case 'lock_screen':
        curConn.lockScreen()
        break
      case 'ctrl_alt_del':
        curConn.ctrlAltDel()
        break
      case 'switch_display':
        curConn.switchDisplay(arg)
        break
      case 'input_key': {
        const e = JSON.parse(arg)
        curConn.inputKey(e.name, e.down === 'true', e.press === 'true', e.alt === 'true', e.ctrl === 'true', e.shift === 'true', e.command === 'true')
        break
      }
      case 'input_string':
        curConn.inputString(arg)
        break
      // models/input_model.dart's processEventToPeer/modify build a JSON
      // mouse event with STRING fields - {type: "down"|"up"|"wheel"|
      // "trackpad"|"" (move), x, y, buttons: "left"|"right"|"wheel"|"back"|
      // "forward"|"", ctrl/shift/alt/command: "true" when held (omitted
      // otherwise) - never a numeric "mask". This case previously read
      // `e.mask` (which never existed - always undefined, silently
      // defaulting to 0) and dropped `e.type` entirely, so every mouse
      // event - move, down, up, wheel alike - reached the peer encoded as
      // mask 0 ("move, no button"), which is why clicks never did
      // anything. Rebuilt the actual mask packing (button << 3 | type,
      // confirmed against both curConn.js's own inputOsPassword() calls -
      // `inputMouse(1 | (1 << 3))`/`inputMouse(2 | (1 << 3))`, i.e. left-
      // button down then up - and the legacy bundle's own equivalent
      // (resources/web/js/dist/index.js), decompiled to confirm the exact
      // type/button -> integer mapping and the reverse-scroll/swap-buttons
      // toggle-option handling alongside it.
      case 'send_mouse': {
        const e = JSON.parse(arg)
        let mask = 0
        switch (e.type) {
          case 'down': mask = 1; break
          case 'up': mask = 2; break
          case 'wheel': mask = 3; break
          case 'trackpad': mask = 4; break
        }
        switch (e.buttons) {
          case 'left': mask |= 1 << 3; break
          case 'right': mask |= 2 << 3; break
          case 'wheel': mask |= 4 << 3; break
          case 'back': mask |= 8 << 3; break
          case 'forward': mask |= 16 << 3; break
        }
        let x = parseInt(e.x || '0')
        let y = parseInt(e.y || '0')
        if ((mask === 3 || mask === 4) && curConn?.getOption('reverse_mouse_wheel') === 'Y') {
          x = -x
          y = -y
        }
        const isLeft = (mask & (1 << 3)) > 0
        const isRight = (mask & (2 << 3)) > 0
        if (isLeft !== isRight && curConn?.getToggleOption('swap-left-right-mouse')) {
          mask = isLeft ? (mask & ~(1 << 3)) | (2 << 3) : (mask & ~(2 << 3)) | (1 << 3)
        }
        curConn.inputMouse(mask, x, y, e.alt === 'true', e.ctrl === 'true', e.shift === 'true', e.command === 'true')
        break
      }
      case 'send_2fa':
        curConn?.send2fa(arg)
        break
      case 'option': {
        const e = JSON.parse(arg)
        setMainOption(e.name, e.value)
        break
      }
      case 'envvar': {
        const e = JSON.parse(arg)
        setEnvVar(e.name, e.value)
        break
      }
      // common/widgets/peer_card.dart's "Add to Favorites" action calls
      // bind.mainStoreFav(favs: favs) with the FULL updated favorites list
      // (bind.mainGetFav() mutated locally), which is bare
      // setByName("fav", jsonEncode(favs)) in flutter/lib/web/bridge.dart -
      // NOT option:*, and a plain JSON array of peer ID strings, not full
      // Peer records (those are resolved separately via buildPeerRecordsById
      // for the load_fav_peers getByName case above).
      case 'fav':
        try {
          setFavIds(JSON.parse(arg))
        } catch (e) {
          console.error('Failed to save favorites: ' + e.message)
        }
        break
      case 'option:local': {
        const e = JSON.parse(arg)
        setLocalOption(e.name, e.value)
        break
      }
      case 'option:flutter:local': {
        const e = JSON.parse(arg)
        setFlutterLocalOption(e.name, e.value)
        break
      }
      case 'option:user:default': {
        const e = JSON.parse(arg)
        setUserDefaultOption(e.name, e.value)
        break
      }
      case 'option:flutter:peer': {
        const e = JSON.parse(arg)
        curConn.setFlutterUiOption(e.name, e.value)
        break
      }
      case 'option:session': {
        const e = JSON.parse(arg)
        curConn.setOption(e.name, e.value)
        break
      }
      case 'option:toggle':
        return curConn.toggleOption(arg)
      case 'input_os_password':
        curConn.inputOsPassword(arg)
        break
      case 'elevate_direct':
        curConn.elevateDirect()
        break
      case 'elevate_with_logon':
        curConn.elevateWithLogon(arg)
        break
      case 'restart':
        curConn.restart()
        break
      case 'change_prefer_codec':
        curConn.changePreferCodec(arg)
        break
      case 'enter_or_leave':
        curConn?.enterOrLeave(arg)
        break
      case 'send_note':
        curConn?.sendNote('conn', arg)
        break
      case 'audit_guid':
        curConn?.setAuditGuid(arg)
        break
      case 'read_remote_dir':
        curConn?.readRemoteDir(arg)
        break
      case 'send_files':
        curConn?.sendFiles(arg)
        break
      case 'send_local_files':
        curConn?.sendLocalFiles(arg)
        break
      case 'cancel_job':
        curConn?.cancelJob(arg)
        break
      case 'create_dir':
        curConn?.createDir(arg)
        break
      case 'remove_file':
        curConn?.removeFile(arg)
        break
      case 'rename_file':
        curConn?.renameFile(arg)
        break
      case 'select_files':
        curConn?.selectFiles(arg)
        break
      case 'open_terminal':
        curConn?.openTerminal(arg)
        break
      case 'send_terminal_input':
        curConn?.sendTerminalInput(arg)
        break
      case 'resize_terminal':
        curConn?.resizeTerminal(arg)
        break
      case 'close_terminal':
        curConn?.closeTerminal(arg)
        break
      case 'save_ab':
        localStorage.setItem('ab_cache', arg)
        break
      case 'clear_ab':
        localStorage.removeItem('ab_cache')
        break
      case 'load_ab':
        loadCachedEntries('ab_cache', { access_token: '', ab_entries: [] }, 'onLoadAbFinished')
        break
      case 'save_group':
        localStorage.setItem('group_cache', arg)
        break
      case 'clear_group':
        localStorage.removeItem('group_cache')
        break
      case 'load_group':
        loadCachedEntries('group_cache', { access_token: '', users: [], peers: [] }, 'onLoadGroupFinished')
        break
      // bridge.dart's queryOnlines() asks the rendezvous server whether a
      // batch of peer IDs are currently online, expecting the result back
      // via a pushEvent("callback_query_onlines", {onlines, offlines})
      // (comma-separated ID strings - see models/peer_model.dart's
      // _updateOnlineState). That's a real rendezvous-protocol round trip
      // (an online-status request message), not just missing plumbing -
      // no different in kind from curConn.js's other new-protocol stubs
      // (file transfer, terminal, 2FA - see its own README.md item 5).
      // Silently doing nothing here just means peers show their
      // last-known/offline state instead of live online status - visible
      // but not broken, unlike the ab/group cases above which were
      // actively throwing.
      case 'query_onlines':
        console.warn('setByName("query_onlines") not implemented - see bridge.js', arg)
        break
      // models/input_model.dart's newKeyboardMode -> sessionHandleFlutterKeyEvent,
      // used when the session's keyboard mode is "map" (Settings ->
      // Keyboard) rather than the "legacy" default that input_key (already
      // wired) handles. Encoding a raw USB HID code into the right
      // KeyEvent protobuf needs the full USB-HID-to-RustDesk-keycode table
      // (hundreds of entries) plus per-platform lock-modifier handling
      // (resources/web/js/dist/index.js's yr()/kr/be()/Qa()) - the same
      // class of "needs a hand-copied generated table, not a quick port"
      // gap as the input_key path's own mapKey()/KEY_MAP (see this
      // directory's README.md item 4), just for the alternate keyboard
      // mode. Left as an explicit stub rather than a guessed/partial
      // mapping, which would silently send wrong keys instead of just
      // dropping them.
      case 'flutter_key_event':
        console.warn('setByName("flutter_key_event") not implemented - see bridge.js (Settings > Keyboard > Map Mode is not supported; use Legacy mode)', arg)
        break
      default:
        console.warn(`setByName("${name}") - unhandled case`, arg)
    }
  }

  window.getByName = (name, arg) => {
    let result
    switch (name) {
      case 'remember':
        result = curConn?.getRemember()
        break
      // bridge.dart's translate() (flutter/lib/web/bridge.dart) calls this
      // for every piece of UI text, expecting the translated string back.
      // Most call sites pass the literal English text as the key (a short
      // button label), so a bare passthrough looked fine for those - but
      // some pass a snake_case/kebab-case *key* expecting a real lookup
      // (mostly longer tooltip/help text), and a passthrough left those
      // showing up as raw identifiers instead of English sentences
      // (confirmed live: "empty_recent_tip", "show_monitors_tip", etc. on
      // the Recents tab and in Settings). translations.js is a hand-copied
      // snapshot of the recovered engine's own real English source
      // (Chr0mX/rustdesk's src/lang/en.rs) - not exhaustive, so anything
      // missing from it still falls back to the same passthrough as
      // before, just for a smaller set of keys than today.
      case 'translate': {
        const e = JSON.parse(arg)
        result = translations[e.text] || e.text
        break
      }
      // bridge.dart's mainGetAppNameSync (flutter/lib/web/bridge.dart) -
      // not part of v1's getByName contract at all (added later), but the
      // recovered engine calls it unconditionally during startup nav
      // rendering. Static, matches this project's actual app.
      case 'app-name':
        result = 'RustDesk'
        break
      // bridge.dart's mainGetApiServer (flutter/lib/web/bridge.dart) - the
      // address book (ab_model.dart) and every other /api/* call build
      // their request URL by string-concatenating this value directly
      // (`"${await bind.mainGetApiServer()}/api/ab/shared/profiles..."`),
      // so an unhandled '' here doesn't fail loudly - it just produces a
      // malformed relative/scheme-less URI ("Failed to fetch,
      // uri=///api/ab/shared/profiles..."). A bare localStorage['api-server']
      // read isn't enough on its own - that key is only populated when the
      // admin has explicitly configured a separate api-server; getApiServer()
      // (curConn.js) is the legacy bundle's own fallback chain (derive from
      // custom-rendezvous-server, then localhost, then same-origin) ported
      // faithfully, so this works whether or not that override is set.
      case 'api_server':
        result = getApiServer()
        break
      // bridge.dart's mainGetOptionsSync ("options", bare/plural - not to
      // be confused with "option:local"/"option:session"/etc above) is
      // what backs the engine's own Settings -> Network panel (id-server/
      // relay-server display). Ported faithfully from the legacy bundle's
      // own getByName dispatcher (resources/web/js/dist/index.js): a
      // JSON blob of whichever of custom-rendezvous-server/relay-server/
      // api-server/key are actually set, omitting the rest - unhandled
      // here meant '', and Dart's JSON.decode('') threw ("Invalid server
      // config: FormatException: ... Unexpected end of JSON input"),
      // confirmed live, leaving the panel blank. Reads plain (unprefixed)
      // keys, matching this file's/curConn.js's own established
      // convention (not the legacy bundle's own "wc-" prefixed storage
      // wrapper, which is specific to its own vendored JS Settings UI).
      case 'options': {
        const keys = ['custom-rendezvous-server', 'relay-server', 'api-server', 'key']
        const opts = {}
        keys.forEach((k) => {
          const v = localStorage.getItem(k)
          if (v) opts[k] = v
        })
        result = JSON.stringify(opts)
        break
      }
      case 'option':
        result = getMainOption(arg)
        break
      // bridge.dart's mainIsUsingPublicServer - whether the currently
      // configured id/relay server is RustDesk's own public infrastructure
      // (rs-ny/rs-sg/etc, used as a fallback when nothing else is
      // configured) rather than a self-hosted one. Ported the legacy
      // bundle's own check exactly (!localStorage["custom-rendezvous-server"])
      // rather than hardcoding "false" - this webclient always has that key
      // seeded by ConfigJs before the engine loads (see Engine.vue), so in
      // practice it's always false here too, but matching the real check
      // means it stays correct if that ever changes.
      case 'is_using_public_server':
        result = localStorage.getItem('custom-rendezvous-server') ? 'false' : 'true'
        break
      // bridge.dart's sessionGetAuditServerSync - the endpoint session
      // audit-log entries (send_note/audit_guid, already wired) actually
      // get posted to. Ported the legacy bundle's own Fn() verbatim -
      // getApiServer() + "/api/audit/" + <typ>.
      case 'audit_server':
        result = getApiServer() + '/api/audit/' + arg
        break
      // bridge.dart's mainGetBuildVersion-adjacent numeric version check
      // (get_version_number) - some feature gates compare peer/build
      // versions as an int, not a string. Ported the legacy bundle's own
      // K() verbatim (not a standard semver encoding - the last dotted
      // component is scaled by 10 rather than 1000, deliberately leaving
      // room to fold in a "-N" build-number suffix in the ones place).
      case 'get_version_number':
        result = String(parseVersionNumber(arg))
        break
      // bridge.dart's mainGetMainDisplay/common.dart's screenInfo_ - LOCAL
      // browser window/screen geometry (not the remote peer's displays,
      // which come from peer_info). Only consumed by one non-critical
      // toolbar info line (desktop/widgets/remote_toolbar.dart), but
      // ported the legacy bundle's own real values (not a placeholder)
      // since they're one-liners against the DOM's own window/screen APIs.
      case 'main_display':
        result = JSON.stringify({
          w: window.screen.availWidth,
          h: window.screen.availHeight,
          scaleFactor: window.devicePixelRatio,
        })
        break
      case 'screen_info':
        result = JSON.stringify({
          frame: {
            l: window.screenX,
            t: window.screenY,
            r: window.screenX + window.innerWidth,
            b: window.screenY + window.innerHeight,
          },
          visibleFrame: {
            l: window.screen.availLeft,
            t: window.screen.availTop,
            r: window.screen.availLeft + window.screen.availWidth,
            b: window.screen.availTop + window.screen.availHeight,
          },
          scaleFactor: window.devicePixelRatio,
        })
        break
      // bridge.dart's sessionGetPlatform(isRemote: true) - the connected
      // peer's OS, sourced straight from the real PeerInfo.platform this
      // client already stores in curConn._peerInfo (handlePeerInfo). Feeds
      // file transfer's Windows-vs-POSIX path-joining logic
      // (FileController.directoryData().options.isWindows).
      case 'platform':
        result = curConn?._peerInfo?.platform || ''
        break
      // bridge.dart's own comment: "Do not return the real environment
      // variables. Use the global variable as the environment variable in
      // web." - a plain per-session KV store, not real env vars.
      case 'envvar':
        result = getEnvVar(arg)
        break
      case 'build_date':
        result = ''
        break
      case 'conn_session_id':
        result = curConn?.getConnSessionId() || ''
        break
      // Paired with send_note/setAuditGuid, which are themselves still
      // documented stubs (see README.md item 5/curConn.js) - stays empty
      // until those actually record something server-side.
      case 'last_audit_note':
        result = ''
        break
      case 'option:local':
        result = getLocalOption(arg)
        break
      case 'option:flutter:local':
        result = getFlutterLocalOption(arg)
        break
      case 'option:user:default':
        result = getUserDefaultOption(arg)
        break
      case 'option:flutter:peer':
        result = curConn?.getFlutterUiOption(arg)
        break
      // bridge.dart's sessionGetScrollStyle forwards this getByName result
      // straight into ScrollStyle.fromString(style) whenever it's non-null
      // (models/model.dart's updateScrollStyle) - and since this file's own
      // getByName wrapper (see below) always turns an unset option into the
      // JS string '' rather than actual null, that check never sees the
      // null it needs to fall back to ScrollStyle.scrollauto.
      // ScrollStyle.fromString('') has no case for '' and throws
      // ArgumentError, crashing every onRgba paint callback - confirmed
      // live ("onRgba error: Invalid argument(s): Unknown ScrollStyle
      // string value: ''", repeated on every single decoded frame once a
      // peer without this option ever explicitly set connects). Default it
      // to the same 'scrollauto' Dart would have used for a real null.
      case 'option:session':
        result = curConn?.getOption(arg)
        if (arg === 'scroll_style' && !result) result = 'scrollauto'
        break
      case 'option:toggle':
        result = curConn?.getToggleOption(arg)
        break
      case 'image_quality':
        result = curConn?.getImageQuality()
        break
      case 'get_conn_status':
        result = curConn?.getStatus() || JSON.stringify({ status_num: 0 })
        break
      case 'alternative_codecs':
        result = curConn?.getAlternativeCodecs()
        break
      // bridge.dart's mainGetMyId (models/server_model.dart's fetchID())
      // is "this machine's own RustDesk ID", displayed in Settings ->
      // This Desktop when acting as a server others connect TO. A
      // webclient never registers with hbbs as a connectable server at
      // all - there genuinely is no ID here, so '' is the correct answer,
      // not a missing one.
      case 'my_id':
        result = ''
        break
      // bridge.dart's mainGetUuid backs the same device-identification
      // pair as my_id above, sent as part of LoginRequest when logging
      // into the engine's own internal Account tab (common/widgets/
      // login.dart) - this webclient's own outer login (api/user.js's
      // login()) already sends uuid: '' the same way, and the Account
      // tab bridge fix (option:local) means that internal login form
      // should rarely even be reached once already authed.
      case 'uuid':
        result = ''
        break
      // bridge.dart's mainGetVersion - just a display string (e.g. an
      // "About" panel), not used for any compatibility/protocol check on
      // this path.
      case 'version':
        result = '1.4.9'
        break
      // bridge.dart's mainGetLangs backs the language picker in Settings.
      // No i18n dictionary has been ported here yet (see the 'translate'
      // case above) - "en" is the only language actually supported right
      // now, so that's the only one the picker should offer.
      case 'langs':
        result = JSON.stringify([['en', 'English']])
        break
      // bridge.dart's mainLoadRecentPeers/mainLoadFavPeers are Future<void>
      // - their own getByName return value is discarded entirely. The
      // actual data reaches Dart through the generic pushEvent/
      // registerEventHandler mechanism instead: models/peer_model.dart's
      // Peers class registers a handler under the exact same name
      // ("load_recent_peers"/"load_fav_peers") expecting
      // {peers: <JSON-encoded array of Peer.fromJson-shaped objects>} -
      // confirmed by reading Peers._updatePeers/Peer.fromJson directly,
      // not guessed. curConn.js's recordRecentPeer() is what actually
      // populates recent_peers_cache, on every successful connection.
      case 'load_recent_peers':
        globals.pushEvent('load_recent_peers', { peers: localStorage.getItem('recent_peers_cache') || '[]' })
        result = ''
        break
      case 'load_recent_peers_sync':
        result = localStorage.getItem('recent_peers_cache') || '[]'
        break
      case 'load_fav_peers':
        globals.pushEvent('load_fav_peers', { peers: JSON.stringify(buildPeerRecordsById(getFavIds())) })
        result = ''
        break
      case 'fav':
        result = JSON.stringify(getFavIds())
        break
      default:
        console.warn(`getByName("${name}") - unhandled case`, arg)
    }
    return typeof result === 'string' || result instanceof String
      ? result
      : (result === undefined || result === null ? '' : JSON.stringify(result))
  }
}

export function getCurConn () {
  return curConn
}
