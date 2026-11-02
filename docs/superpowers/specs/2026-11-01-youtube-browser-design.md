# YouTube browser first release

The user selected the existing full-site browser approach, scoped to YouTube first.
Reuse Qt WebEngine and its isolated persistent website profile. The Media panel
accepts YouTube browsing URLs (home, search, channels, playlists, videos and Shorts),
opens the website in the native child view, and keeps Source recording available.
Navigation is visible and video-only mode is opt-in. External-browser fallback uses
the current native page URL. Without the desktop bridge, offer external browsing
and explain that the in-app browser needs the desktop app.

Approaches: extend the existing Qt browser (selected); iframe players retain the
embedding limitations the user wants to remove; a different browser engine would
replace working infrastructure without evidence it is needed for YouTube.

No additional platforms, DRM work, or synchronized recording controls in this pass.
Keep previous experimental provider helpers dormant for future expansion. Do not
claim real account login or playback based on synthetic tests. Preserve in-progress
workspace changes; no unrelated commits or migrations.
