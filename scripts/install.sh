#!/usr/bin/env bash
# Build and install the current working tree using the local Arch package.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./scripts/install.sh [--check]

Install SpeakToSpeech on Arch Linux using pacman and the local PKGBUILD.
Run as your normal user; sudo is requested for system package installation.
Downloads Python/frontend dependencies and CUDA libraries (several GB).
Re-run to update the installed app from the current working tree.

  --check  Check prerequisites without installing or building anything.
  --help   Show this help.
EOF
}
check_only=false
case "${1:-}" in
  '') ;;
  --check) check_only=true ;;
  --help|-h) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac
[[ $# -le 1 ]] || { usage >&2; exit 2; }

fail() { echo "Error: $*" >&2; exit 1; }
[[ $(uname -s) == Linux ]] || fail 'This installer is for Arch Linux.'
[[ -r /etc/arch-release ]] || fail 'This installer requires Arch Linux or an Arch-based distribution.'
[[ $(uname -m) == x86_64 ]] || fail 'The app package requires x86_64.'
(( EUID != 0 )) || fail 'Run as your normal user, without sudo; makepkg must not run as root.'
command -v pacman >/dev/null || fail 'pacman is required.'
command -v sudo >/dev/null || fail 'sudo is required for package installation.'

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
package_dir="$project_dir/packaging/arch"
[[ -f "$package_dir/PKGBUILD" ]] || fail "Missing $package_dir/PKGBUILD"

missing=()
for package in base-devel git; do
  if ! pacman -Q "$package" >/dev/null 2>&1; then missing+=("$package"); fi
done
python_missing=false
pacman -Q python311 >/dev/null 2>&1 || python_missing=true
aur_helper=''
for candidate in paru yay; do
  if command -v "$candidate" >/dev/null; then aur_helper=$candidate; break; fi
done

if "$check_only"; then
  echo "Package source: $project_dir"
  if ((${#missing[@]})); then echo "Missing system prerequisites: ${missing[*]}"; fi
  if "$python_missing"; then
    echo "Missing python311 (AUR). Available helper: ${aur_helper:-none}"
  fi
  echo 'Other build/runtime dependencies are resolved by makepkg --syncdeps.'
  if ((${#missing[@]})) || "$python_missing"; then exit 1; fi
  echo 'Prerequisites ready. Run ./scripts/install.sh to build and install.'
  exit 0
fi

if "$python_missing" && [[ -z "$aur_helper" ]]; then
  fail 'Install python311 from the AUR first, or install paru/yay and rerun this script.'
fi
if ((${#missing[@]})); then
  sudo pacman -S --needed "${missing[@]}"
fi
if "$python_missing"; then
  "$aur_helper" -S --needed python311
fi
command -v makepkg >/dev/null || fail 'makepkg is missing; install base-devel.'
command -v python3.11 >/dev/null || fail 'python311 did not provide python3.11.'
git -C "$project_dir" rev-parse --show-toplevel >/dev/null \
  || fail 'Run this installer from a Git checkout of SpeakToSpeech.'

echo 'Building and installing SpeakToSpeech, including local uncommitted changes...'
cd "$package_dir"
# Force a fresh build so reruns install edits even when the version is unchanged.
# Keep package-manager prompts visible; do not launch the GUI under sudo.
makepkg --syncdeps --install --force --cleanbuild
echo 'Installed. Open SpeakToSpeech from your application menu, or run: speaktospeech'
echo 'Download a transcription model inside the app on first launch.'
