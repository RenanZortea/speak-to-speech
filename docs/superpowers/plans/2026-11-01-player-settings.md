# Native YouTube player controls

The user requested ad skipping, a seekable timeline, and captions/settings while
retaining the focused presentation and restricted browsing. Expose YouTube's own
player controls and popover menus. Keep app practice controls unchanged. Native
ad skipping appears only when YouTube offers it; do not invent ad bypass behavior.

Implementation: focus the original player container rather than only its video.
Whitelist control bar, settings menus, caption display and native skip-ad controls.
Suppress navigation links, recommendations, end screens and unsupported window-mode
buttons; keep Qt selected-video navigation checks. Enable keyboard focus for native
controls. Preserve ad/seek/menu semantics by letting YouTube handle allowed events.

- [x] Write/run failing Qt fixture for visible and interactive native controls,
      caption rendering, settings menu, skip button, and blocked unrelated links.
- [x] Implement focused CSS/event allowlist with reversible/repeatable styling.
- [x] Run existing Qt/frontend/backend tests and inspect a real YouTube player.
- [x] Review changes and document limitations of real ad availability.

Verification: 107 frontend tests, 33 backend tests, frontend production build,
and Qt player-controls/desktop/frontend smoke checks passed. The controls fixture
covers pointer input, keyboard seeking, caption display, ad skip, settings selection,
blocked navigation, and player reparenting. A temporary-profile live YouTube check
confirmed video rendering, a 776px native timeline, and opening the settings menu.
The sample video offered neither captions nor a skippable ad: those interactions
were verified with the fixture, not a live ad/account. Manual code review completed;
the separate reviewer was unavailable due to its usage limit.
