# Media shortcuts implementation plan

Goal: port the user's saved Global Speed checkpoint and speed shortcuts to the
focused YouTube player, synchronized with existing app controls.

Design: use physical KeyboardEvent.code (W/S/A/D = Dvorak ./o/a/e).
Shift+W replaces checkpoint; W seeks to it; S toggles 1×/previous speed;
A/D adjust by 0.1× within the current app's 0.25–2× bounds. Read-only inspection
of installed Global Speed 3.4.124 confirmed these bindings and toggle semantics.
Use the same React actions for buttons and keyboard. Capture native player keys
in the isolated script world, drain a bounded action queue through Qt, and forward
only known actions to the local UI. No app bridge is exposed to YouTube. Avoid
shortcuts in editable fields, modals, inactive tabs, or sign-in. Show actual rate
and Dvorak shortcut hints. Keep browser navigation restrictions.

Alternatives: frontend-only listeners miss keys when the native player is focused;
Qt character shortcuts depend on layout. Physical DOM key codes on both surfaces
preserve the user's existing muscle memory. Existing authorization covers this
small extension of the playback controls; no separate approval step is needed.

- [x] Add failing interaction coverage for physical Dvorak events, checkpoint
  replacement, speed toggle and steps, held keys, UI synchronization, typing,
  modifiers, hidden tabs, and native-player focus.
- [x] Add shortcut decoding and serialized shared playback actions in frontend;
  implement isolated native shortcut capture and Qt forwarding.
- [x] Run frontend suite/build, backend suite, Qt integration and player smoke checks.
- [x] Review and document shortcuts and verification.

Verification: the shortcut integration test failed before implementation, then passed
with Dvorak code/key pairs, held speed keys, native WebEngine key events, checkpoint
replacement and button synchronization. Review identified stale actions across tab
changes; a delayed bridge-response test failed before adding activation/modal
generation cancellation and passed afterward. React queue bounded to 32 actions.
107 frontend tests, 33 backend tests, production build, and three Qt smoke checks
passed. Backend socket tests required running outside the network-restricted
sandbox (the restricted attempt had five PermissionError failures). Existing npm
version, bundle-size, and Python HTTPError cleanup warnings remain.
