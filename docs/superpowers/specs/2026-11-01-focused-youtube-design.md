# Focused YouTube practice

The user wants the browser retained underneath a focused player, the previous app
control UI restored, and a styled sign-in button kept visible. No exposed browser
navigation or routes into other sites during practice.

Use the existing native child view as a video surface, with app-owned React controls
for play/pause, relative seeking, speed, checkpoints, and play-and-record. A video
URL is required. Hide page chrome and native browser toolbars; lock top-level page
navigation to the selected video, suppress popups/context menus, and prevent page
link interactions (including SPA routes). Main-page consent redirects may open the
restricted authentication window. A separate Sign in action opens the real YouTube/
Google authentication UI in the same profile. Allow only exact authentication hosts
and YouTube authentication paths, and close/return to the selected video on completion.
Never restyle credential forms or expose the app bridge to websites.

The existing Qt approach is retained; iframe embedding and a general-purpose browser
are unsuitable for the user's selected presentation. Authentication remains subject
to Google's embedded-browser policies. No promise of successful login based on mocks.

Implementation decisions: reuse existing icon/CSS vocabulary; native control RPC
returns media status asynchronously. Poll only while active, ignore stale responses,
and do not resume after recording permission if the tab/video has changed. Failures
remain visible and retryable. Existing uncommitted work stays in place.
