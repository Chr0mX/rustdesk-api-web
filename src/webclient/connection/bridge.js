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
      case 'connect':
        curConn = new CurConn()
        curConn.start(arg)
        break
      case 'login':
        curConn.handle_login_from_ui(...Object.values(JSON.parse(arg)))
        break
      case 'close':
        curConn.close()
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
      case 'send_mouse': {
        const e = JSON.parse(arg)
        curConn.inputMouse(e.mask, e.x, e.y, e.alt, e.ctrl, e.shift, e.command)
        break
      }
      case 'send_2fa':
        curConn?.send2fa(arg)
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
      // for every piece of UI text, expecting the translated string back -
      // v1's own implementation (flutter/web/js/src/common.ts's translate())
      // looks up a generated per-locale dictionary and falls back to the
      // original (English) text when there's no entry. That dictionary was
      // never ported here (see README.md), so every call fell through to
      // getByName's default case, returning '' - not "untranslated", but
      // blank, which is why every label/button/tooltip in the engine
      // rendered empty even though the engine itself was running fine.
      // Always returning the source text matches v1's own fallback path
      // exactly (its dict lookup for "en" mostly returns the source text
      // unchanged anyway, since that dictionary's keys ARE the English
      // strings) - it just means no actual localization until a real i18n
      // dictionary is added.
      case 'translate': {
        const e = JSON.parse(arg)
        result = e.text
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
      case 'option:session':
        result = curConn?.getOption(arg)
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
