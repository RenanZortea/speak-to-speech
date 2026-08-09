"""Single source of truth for the app version.

Read by:
  - the runtime (shown in Settings, used for update checks)
  - build.ps1 (names the installer, stamps the EXE)
  - the GitHub release tag (vX.Y.Z)

Bump this, then build + tag a matching release.
"""
__version__ = "0.8.1"

# GitHub repo for update checks (owner/name).
GITHUB_REPO = "RenanZortea/speak-to-speech"
