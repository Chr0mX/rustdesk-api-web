// Keyboard Map Mode support - USB-HID usage code -> per-peer-platform
// position code, hand-vendored from the actual rdev crate (rustdesk-org/
// rdev, referenced by Cargo.toml) rather than guessed, since the recovered
// engine's flutter_key_event path is unreachable without it and a wrong
// scancode sends the wrong key to the peer (not just a no-op).
//
// Algorithm mirrors src/keyboard.rs's _map_keyboard_mode on
// android/ios targets (the only native targets that also start from a raw
// USB HID code rather than a local OS scancode - a browser is in the same
// position): usb_hid -> Key (rdev's platform-independent enum, from
// src/keycodes/usb_hid.rs's key_from_code) -> target platform's native
// code (src/keycodes/{windows,linux,macos}.rs's code_from_key /
// scancode_from_key). Unmapped codes fall through to the raw usb_hid
// value unchanged, matching rdev's own Key::Unknown(code) => Some(code)
// fallback in every one of these tables.
//
// macOS ISO-layout switching (kVK_ISO_Section <-> kVK_ANSI_Grave) depends
// on a local Rust-side LocalConfig setting with no web equivalent - only
// the default ANSI mapping is implemented here.

const USB_HID_TO_KEY = {
  0xE2: 'Alt', 0xE6: 'AltGr', 0x2A: 'Backspace', 0x39: 'CapsLock',
  0xE0: 'ControlLeft', 0xE4: 'ControlRight', 0x4C: 'Delete', 0x52: 'UpArrow',
  0x51: 'DownArrow', 0x50: 'LeftArrow', 0x4F: 'RightArrow', 0x4D: 'End',
  0x29: 'Escape', 0x3A: 'F1', 0x3B: 'F2', 0x3C: 'F3', 0x3D: 'F4', 0x3E: 'F5',
  0x3F: 'F6', 0x40: 'F7', 0x41: 'F8', 0x42: 'F9', 0x43: 'F10', 0x44: 'F11',
  0x45: 'F12', 0x68: 'F13', 0x69: 'F14', 0x6A: 'F15', 0x6B: 'F16', 0x6C: 'F17',
  0x6D: 'F18', 0x6E: 'F19', 0x6F: 'F20', 0x70: 'F21', 0x71: 'F22', 0x72: 'F23',
  0x73: 'F24', 0x4A: 'Home', 0xE3: 'MetaLeft', 0x4E: 'PageDown', 0x4B: 'PageUp',
  0x28: 'Return', 0xE1: 'ShiftLeft', 0xE5: 'ShiftRight', 0x2C: 'Space',
  0x2B: 'Tab', 0x46: 'PrintScreen', 0x47: 'ScrollLock', 0x53: 'NumLock',
  0x35: 'BackQuote', 0x1E: 'Num1', 0x1F: 'Num2', 0x20: 'Num3', 0x21: 'Num4',
  0x22: 'Num5', 0x23: 'Num6', 0x24: 'Num7', 0x25: 'Num8', 0x26: 'Num9',
  0x27: 'Num0', 0x2D: 'Minus', 0x2E: 'Equal',
  0x14: 'KeyQ', 0x1A: 'KeyW', 0x08: 'KeyE', 0x15: 'KeyR', 0x17: 'KeyT',
  0x1C: 'KeyY', 0x18: 'KeyU', 0x0C: 'KeyI', 0x12: 'KeyO', 0x13: 'KeyP',
  0x2F: 'LeftBracket', 0x30: 'RightBracket', 0x31: 'BackSlash',
  0x04: 'KeyA', 0x16: 'KeyS', 0x07: 'KeyD', 0x09: 'KeyF', 0x0A: 'KeyG',
  0x0B: 'KeyH', 0x0D: 'KeyJ', 0x0E: 'KeyK', 0x0F: 'KeyL',
  0x33: 'SemiColon', 0x34: 'Quote', 0x64: 'IntlBackslash', 0x87: 'IntlRo',
  0x89: 'IntlYen',
  0x1D: 'KeyZ', 0x1B: 'KeyX', 0x06: 'KeyC', 0x19: 'KeyV', 0x05: 'KeyB',
  0x11: 'KeyN', 0x10: 'KeyM', 0x36: 'Comma', 0x37: 'Dot', 0x38: 'Slash',
  0x49: 'Insert', 0x56: 'KpMinus', 0x57: 'KpPlus', 0x55: 'KpMultiply',
  0x54: 'KpDivide', 0x63: 'KpDecimal', 0x58: 'KpReturn', 0x67: 'KpEqual',
  0x85: 'KpComma', 0x62: 'Kp0', 0x59: 'Kp1', 0x5A: 'Kp2', 0x5B: 'Kp3',
  0x5C: 'Kp4', 0x5D: 'Kp5', 0x5E: 'Kp6', 0x5F: 'Kp7', 0x60: 'Kp8', 0x61: 'Kp9',
  0xE7: 'MetaRight', 0x65: 'Apps', 0x80: 'VolumeUp', 0x81: 'VolumeDown',
  0x7F: 'VolumeMute', 0x8A: 'Convert', 0x8B: 'NonConvert',
  0x90: 'Hangul', 0x91: 'Hanja', 0x92: 'Lang3', 0x93: 'Lang4', 0x94: 'Lang5',
  0x9B: 'Cancel', 0x9C: 'Clear', 0x88: 'Kana', 0x00: 'Junja', 0x77: 'Select',
  0x74: 'Execute', 0x75: 'Help', 0x9f: 'Separator', 0x48: 'Pause',
}

// key -> [win_scancode, linux_code, macos_code]. -1 means "no mapping" for
// that platform (matches rdev's Key::Unknown / non-existent match arm).
const KEY_TABLE = {
  Alt: [0x38, 64, 58], AltGr: [0xE038, 108, 61], Backspace: [0x0E, 22, 51],
  CapsLock: [0x3A, 66, 57], ControlLeft: [0x1D, 37, 59], ControlRight: [0xE01D, 105, 62],
  Delete: [0xE053, 119, 117], UpArrow: [0xE048, 111, 126], DownArrow: [0xE050, 116, 125],
  LeftArrow: [0xE04B, 113, 123], RightArrow: [0xE04D, 114, 124], End: [0xE04F, 115, 119],
  Escape: [0x01, 9, 53], F1: [0x3B, 67, 122], F2: [0x3C, 68, 120], F3: [0x3D, 69, 99],
  F4: [0x3E, 70, 118], F5: [0x3F, 71, 96], F6: [0x40, 72, 97], F7: [0x41, 73, 98],
  F8: [0x42, 74, 100], F9: [0x43, 75, 101], F10: [0x44, 76, 109], F11: [0x57, 95, 103],
  F12: [0x58, 96, 111], F13: [0x64, 0xBF, 105], F14: [0x65, 0xC0, 107], F15: [0x66, 0xC1, 113],
  F16: [0x67, 0xC2, 106], F17: [0x68, 0xC3, 64], F18: [0x69, 0xC4, 79], F19: [0x6A, 0xC5, 80],
  F20: [0x6B, 0xC6, 90], F21: [0x6C, 0xC7, -1], F22: [0x6D, 0xC8, -1], F23: [0x6E, 0xC9, -1],
  F24: [0x76, 0xCA, -1],
  Home: [0xE047, 110, 115], MetaLeft: [0xE05B, 133, 55], PageDown: [0xE051, 117, 121],
  PageUp: [0xE049, 112, 116], Return: [0x1C, 36, 36], ShiftLeft: [0x2A, 50, 56],
  ShiftRight: [0x36, 62, 60], Space: [0x39, 65, 49], Tab: [0x0F, 23, 48],
  PrintScreen: [0xE037, 107, -1], ScrollLock: [0x46, 78, -1], NumLock: [0x45, 77, 71],
  BackQuote: [0x29, 49, 50], Num1: [0x02, 10, 18], Num2: [0x03, 11, 19], Num3: [0x04, 12, 20],
  Num4: [0x05, 13, 21], Num5: [0x06, 14, 23], Num6: [0x07, 15, 22], Num7: [0x08, 16, 26],
  Num8: [0x09, 17, 28], Num9: [0x0A, 18, 25], Num0: [0x0B, 19, 29], Minus: [0x0C, 20, 27],
  Equal: [0x0D, 21, 24],
  KeyQ: [0x10, 24, 12], KeyW: [0x11, 25, 13], KeyE: [0x12, 26, 14], KeyR: [0x13, 27, 15],
  KeyT: [0x14, 28, 17], KeyY: [0x15, 29, 16], KeyU: [0x16, 30, 32], KeyI: [0x17, 31, 34],
  KeyO: [0x18, 32, 31], KeyP: [0x19, 33, 35],
  LeftBracket: [0x1A, 34, 33], RightBracket: [0x1B, 35, 30], BackSlash: [0x2B, 51, 42],
  KeyA: [0x1E, 38, 0], KeyS: [0x1F, 39, 1], KeyD: [0x20, 40, 2], KeyF: [0x21, 41, 3],
  KeyG: [0x22, 42, 5], KeyH: [0x23, 43, 4], KeyJ: [0x24, 44, 38], KeyK: [0x25, 45, 40],
  KeyL: [0x26, 46, 37],
  SemiColon: [0x27, 47, 41], Quote: [0x28, 48, 39], IntlBackslash: [0x56, 94, 10],
  IntlRo: [0x0073, 0x61, 94], IntlYen: [0x007D, 0x84, 93],
  KeyZ: [0x2C, 52, 6], KeyX: [0x2D, 53, 7], KeyC: [0x2E, 54, 8], KeyV: [0x2F, 55, 9],
  KeyB: [0x30, 56, 11], KeyN: [0x31, 57, 45], KeyM: [0x32, 58, 46],
  Comma: [0x33, 59, 43], Dot: [0x34, 60, 47], Slash: [0x35, 61, 44],
  Insert: [0xE052, 118, 114],
  KpMinus: [0x4A, 82, 78], KpPlus: [0x4E, 86, 69], KpMultiply: [0x37, 63, 67],
  KpDivide: [0xE035, 106, 75], KpDecimal: [0x53, 91, 65], KpReturn: [0xE01C, 104, 76],
  KpEqual: [0x59, 0x7D, 81], KpComma: [0x7E, 0x81, 95],
  Kp0: [0x52, 90, 82], Kp1: [0x4F, 87, 83], Kp2: [0x50, 88, 84], Kp3: [0x51, 89, 85],
  Kp4: [0x4B, 83, 86], Kp5: [0x4C, 84, 87], Kp6: [0x4D, 85, 88], Kp7: [0x47, 79, 89],
  Kp8: [0x48, 80, 91], Kp9: [0x49, 81, 92],
  MetaRight: [0xE05C, 134, 54], Apps: [0xE05D, 135, 110],
  VolumeUp: [0xE030, 0x007B, 72], VolumeDown: [0xE02E, 0x007A, 73], VolumeMute: [0xE020, 0x0079, 74],
  NonConvert: [0x007b, 0x0066, 102 /* -> kVK_JIS_Eisu, see macOS special-case below */],
  Convert: [0x0079, 0x0064, 104 /* -> kVK_JIS_Kana, see macOS special-case below */],
  Lang3: [0x0078, 0x0062, -1], Lang4: [0x0077, 0x0063, -1], Lang5: [0x0076, 0x005d, -1],
  Cancel: [-1, -1, -1], Clear: [-1, -1, -1],
  Kana: [0x0080, -1, -1],
  Hangul: [0x00f2, 0x0082, -1], Lang1: [0x00f2, 0x0082, 104 /* JIS Kana via Convert alias */],
  Junja: [-1, -1, -1], Final: [-1, -1, -1],
  Hanja: [0x00f1, 0x0083, -1], Lang2: [0x00f1, 0x0083, 102 /* JIS Eisu via NonConvert alias */],
  Select: [-1, -1, -1], Print: [-1, -1, -1], Execute: [-1, -1, -1], Help: [-1, -1, 114],
  Sleep: [-1, -1, -1], Separator: [-1, -1, -1], Pause: [-1, 127, -1],
}

function resolveKey (usbHid) {
  return USB_HID_TO_KEY[usbHid]
}

function platformIndex (platform) {
  const p = (platform || '').toLowerCase()
  if (p.includes('win')) return 0
  if (p.includes('linux')) return 1
  if (p.includes('mac')) return 2
  return -1
}

// Mirrors _map_keyboard_mode's per-target usb_hid_code_to_* calls -
// falls back to the raw usb_hid code unchanged when there's no mapping,
// matching rdev's own Key::Unknown(code) => Some(code) behavior.
export function usbHidToPositionCode (usbHid, platform) {
  const idx = platformIndex(platform)
  if (idx === -1) return usbHid
  const key = resolveKey(usbHid)
  if (!key) return usbHid
  const row = KEY_TABLE[key]
  if (!row) return usbHid
  const code = row[idx]
  return code === -1 ? usbHid : code
}

export function isLetterKey (usbHid) {
  const key = resolveKey(usbHid)
  return !!key && /^Key[A-Z]$/.test(key)
}

export function isNumpadKey (usbHid) {
  const key = resolveKey(usbHid)
  return !!key && key.startsWith('Kp')
}
