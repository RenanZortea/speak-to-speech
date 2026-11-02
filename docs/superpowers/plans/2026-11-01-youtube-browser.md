# YouTube Browser Implementation Plan

**Goal:** Deliver the existing native browser as a YouTube-only first release.
**Architecture:** React launches the Qt website view; Qt owns navigation and playback.
**Tech stack:** React, TypeScript, PySide6/Qt WebEngine.
**Spec:** ../specs/2026-11-01-youtube-browser-design.md

## Constraints
Preserve existing uncommitted work. No new dependencies. No iframe in the active
Media flow. HTTPS YouTube launch URLs only; allow remote HTTPS login navigation
without exposing the application bridge.

## Review focus
- Home, search, channel and timestamp URLs must retain their meaning.
- Reject deceptive hosts, credentials, non-HTTPS schemes and nondefault ports.
- Failed launch must leave a retryable UI.
- Switching tabs must preserve the browser and pause hidden media.
- Default native navigation must remain usable; video-only mode is reversible.

## Tasks
- [x] Add failing URL-policy tests and native-browser default assertions.
- [x] Implement YouTube URL normalization and simplify MediaWidget to native browsing
  with external fallback; keep errors visible and launches disabled during recording.
- [x] Limit native launch hosts/bookmarks to YouTube, show navigation by default,
  keep video-only opt-in and expose current-page external fallback.
- [x] Update README and synthetic Qt tests to exercise the YouTube flow.
- [x] Run frontend tests/build, backend media/server tests, Qt desktop/frontend smoke
  tests; review changes and report real-site verification limits.

## Verification record

- New URL tests failed before implementation; 17 now pass.
- Native default-navigation assertion failed before implementation and now passes.
- Frontend: 107 tests pass; TypeScript/Vite production build passes.
- Backend: all 30 unittest tests pass.
- All three Qt smoke scripts pass using temporary profiles and synthetic media.
- Independent review found no important issues in this scoped change.
- Existing npm/Node compatibility, bundle-size, and HTTPError cleanup warnings remain.
- Live playback, account login/restart persistence and actual audio capture still need
  target-machine testing. No existing account profiles were accessed.

Execution stayed in the existing workspace to preserve the substantial uncommitted
browser implementation. No commits, deployment, or account changes were performed.

Live probe: the public YouTube homepage loaded successfully in Qt with title
“YouTube” using a temporary profile. The one-off probe then hit a temporary-profile
cleanup race (Qt still writing storage); this does not establish playback or login.
