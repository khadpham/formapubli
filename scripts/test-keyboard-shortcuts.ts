import assert from 'node:assert';
import {
  isMacPlatform,
  matchNavShortcut,
  matchActionShortcut,
  getShortcutLabel,
} from '../src/lib/keyboard';

console.log('--- TEST KEYBOARD SHORTCUTS CROSS-PLATFORM ---');

// 1. Test isMacPlatform
assert.strictEqual(isMacPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), true);
assert.strictEqual(isMacPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), false);
assert.strictEqual(isMacPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), true);
assert.strictEqual(isMacPlatform('Mozilla/5.0 (Linux; Android 14)'), false);
console.log('PASS: isMacPlatform user-agent detection');

// 2. Test Navigation Shortcuts on Windows (Alt + 1..8)
// On Windows, Alt+1 has e.altKey=true, e.key='1', e.code='Digit1'
const winEvent1 = {
  altKey: true,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  key: '1',
  code: 'Digit1',
} as KeyboardEvent;
assert.strictEqual(matchNavShortcut(winEvent1, false), '1');

// 3. Test Navigation Shortcuts on macOS (Option + 1)
// On macOS, Option+1 generates special character '¡' in e.key, but e.code is 'Digit1'!
const macEventOption1 = {
  altKey: true,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  key: '¡', // composed special character on Mac
  code: 'Digit1',
} as KeyboardEvent;
assert.strictEqual(matchNavShortcut(macEventOption1, true), '1', 'macOS Option+1 (with ¡) must match tab 1');

// 4. Cmd + 1 tren macOS: TRINH DUYET NUOT TRUOC (chuyen tab) -> page khong nhan keydown.
// Helper phai TRA VE NULL (khong nhan la shortcut cua app).
const macEventCmd1 = {
  altKey: false,
  ctrlKey: false,
  metaKey: true,
  shiftKey: false,
  key: '1',
  code: 'Digit1',
} as KeyboardEvent;
assert.strictEqual(matchNavShortcut(macEventCmd1, true), null, 'macOS Cmd+1 is swallowed by browser, must NOT match');

// 5. Test Copilot Shortcut (Alt+C on Windows, Option+C on Mac)
// On Mac, Option+C produces key 'ç', but code is 'KeyC'
const macEventOptionC = {
  altKey: true,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  key: 'ç',
  code: 'KeyC',
} as KeyboardEvent;
assert.strictEqual(matchActionShortcut(macEventOptionC, 'KeyC', { isMac: true }), true, 'Option+C on Mac matches KeyC');

const winEventAltC = {
  altKey: true,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  key: 'c',
  code: 'KeyC',
} as KeyboardEvent;
assert.strictEqual(matchActionShortcut(winEventAltC, 'KeyC', { isMac: false }), true, 'Alt+C on Windows matches KeyC');

// 6. Test Alt+Shift+T (Transfer) on Windows and Mac
const winEventAltShiftT = {
  altKey: true,
  ctrlKey: false,
  metaKey: false,
  shiftKey: true,
  key: 'T',
  code: 'KeyT',
} as KeyboardEvent;
assert.strictEqual(matchActionShortcut(winEventAltShiftT, 'KeyT', { shift: true, isMac: false }), true);

// On Mac, Option+Shift+T produces key 'ˇ'
const macEventOptionShiftT = {
  altKey: true,
  ctrlKey: false,
  metaKey: false,
  shiftKey: true,
  key: 'ˇ',
  code: 'KeyT',
} as KeyboardEvent;
assert.strictEqual(matchActionShortcut(macEventOptionShiftT, 'KeyT', { shift: true, isMac: true }), true);

// 7. Test getShortcutLabel
assert.strictEqual(getShortcutLabel('T', { alt: true, shift: true }, false), 'Alt+Shift+T');
assert.strictEqual(getShortcutLabel('T', { alt: true, shift: true }, true), '⌥⇧T');
assert.strictEqual(getShortcutLabel('1', { alt: true }, true), '⌥1');
assert.strictEqual(getShortcutLabel('1', { alt: true }, false), 'Alt+1');
console.log('PASS: getShortcutLabel for Windows and Mac');

// 8. Dang go trong o input: nav shortcut phai bi chan (tranh nhay tab mat ngu canh)
const typingEvent = {
  altKey: true,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  key: '1',
  code: 'Digit1',
  target: { tagName: 'INPUT', isContentEditable: false },
} as unknown as KeyboardEvent;
assert.strictEqual(matchNavShortcut(typingEvent, false), null, 'typing in input must not switch tab');

console.log('ALL KEYBOARD SHORTCUT TESTS PASSED!');
