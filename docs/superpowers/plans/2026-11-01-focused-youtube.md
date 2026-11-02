# Focused YouTube Implementation Plan

**Goal:** Focused native YouTube video with app controls and deliberate sign-in.
**Spec:** ../specs/2026-11-01-focused-youtube-design.md
**Architecture:** React controls call Qt media RPC; website has no application bridge.

- [x] Add/test video navigation and authentication policies; restrict the embedded view.
- [x] Add validated async native status/play/pause/seek/seek_to/rate and sign-in RPC.
- [x] Restore compact React practice controls, URL loading and styled Sign in action.
- [x] Verify focused page CSS, real bridge control effects, failed launch recovery,
      tab hiding, and restricted authentication in synthetic Qt tests.
- [x] Run frontend tests/build and backend suite, review changes, prepare the dev app for restart.

Review focus: stale playback after tab switch; recording permission races; SPA links
escaping policy; authentication popup cleanup and profile isolation; loading/error
states while no playable video exists. Do not change unrelated workspace files.

## Verification
107 frontend tests and the production build pass. All 33 backend tests pass.
The Qt frontend test exercises actual native media through the restored controls:
play/pause, speed, relative seek, checkpoints, and pause on tab exit. Desktop tests
verify restricted navigation/authentication and late callbacks during shutdown.
Standalone media smoke test also passes. Independent review found no important
issues; its minor stale-status race was fixed.

A temporary-profile live probe loaded a real YouTube video (readyState 4) and
reached accounts.google.com through Sign in. No credentials were entered: successful
account authentication and persistence still need a user test. The probe exposed a
late Qt shutdown signal, fixed with closing guards and a regression check.
