#!/bin/bash
# DayBoard installer for macOS (Apple silicon, macOS 14 or later).
#
#   curl -fsSL https://getdayboard.com/install.sh | bash
#
# It downloads the DayBoard disk image from the official GitHub release, checks it against the
# SHA-256 below, checks that Apple notarized it and that DayBoard's Developer ID team signed it,
# then copies DayBoard.app into /Applications. It never asks for a password and never uses sudo.
#
# To install somewhere else:
#   curl -fsSL https://getdayboard.com/install.sh | DAYBOARD_INSTALL_DIR="$HOME/Applications" bash
#
# VERSION and DMG_SHA256 name one published release. Update both together when a release ships
# (tests/website-version.test.mjs checks VERSION against the download page).

set -euo pipefail

VERSION="1.3.0"
DMG_SHA256="74b3a1f22f946d79f0d70a8bd58f88d5ced639516a67dd38901e35a90eb8664b"
TEAM_ID="LGJS5APK9X"

DMG_NAME="DayBoard-${VERSION}-arm64.dmg"
DMG_URL="https://github.com/miles-chu10/DayBoard/releases/download/v${VERSION}/${DMG_NAME}"
APP_NAME="DayBoard.app"

# Only Apple's own tools, whatever the caller's PATH holds.
PATH="/usr/bin:/bin:/usr/sbin:/sbin"
export PATH

WORK=""
MOUNT=""
STAGE=""

say() { printf '%s\n' "$*"; }
fail() {
  printf 'DayBoard was not installed: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [ -n "$MOUNT" ] && [ -d "$MOUNT" ]; then
    hdiutil detach "$MOUNT" -quiet 2>/dev/null || hdiutil detach "$MOUNT" -force -quiet 2>/dev/null || true
  fi
  if [ -n "$STAGE" ]; then rm -rf "$STAGE"; fi
  if [ -n "$WORK" ]; then rm -rf "$WORK"; fi
}

# Fails unless the item is signed by DayBoard's Developer ID team.
require_team() {
  local details
  details="$(codesign --display --verbose=4 "$1" 2>&1)" || fail "$2 is not signed."
  printf '%s\n' "$details" | grep -q "^TeamIdentifier=${TEAM_ID}\$" ||
    fail "$2 is not signed by DayBoard's Apple Developer ID team."
}

# Fails unless Gatekeeper accepts the item as notarized Developer ID software.
require_notarized() {
  local kind="$1" item="$2" label="$3" assessment
  if [ "$kind" = "open" ]; then
    assessment="$(spctl --assess --type open --context context:primary-signature --verbose=2 "$item" 2>&1)" ||
      fail "macOS did not accept $label."
  else
    assessment="$(spctl --assess --type execute --verbose=2 "$item" 2>&1)" ||
      fail "macOS did not accept $label."
  fi
  printf '%s\n' "$assessment" | grep -q '^source=Notarized Developer ID$' ||
    fail "$label is not notarized by Apple."
}

main() {
  [ "$(uname -s)" = "Darwin" ] || fail "DayBoard is a Mac app."
  [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ] ||
    fail "DayBoard needs a Mac with Apple silicon (M1 or later)."
  local macos
  macos="$(sw_vers -productVersion)"
  [ "${macos%%.*}" -ge 14 ] 2>/dev/null ||
    fail "DayBoard needs macOS 14 Sonoma or later. This Mac runs macOS ${macos}."

  local dest="${DAYBOARD_INSTALL_DIR:-/Applications}"
  [ -d "$dest" ] || fail "$dest does not exist."
  [ -w "$dest" ] || fail "you can't write to $dest. Install for just your account instead:
  mkdir -p \"\$HOME/Applications\"
  curl -fsSL https://getdayboard.com/install.sh | DAYBOARD_INSTALL_DIR=\"\$HOME/Applications\" bash"
  local target="$dest/$APP_NAME"
  if [ -e "$target" ] && pgrep -x DayBoard >/dev/null 2>&1; then
    fail "DayBoard is open. Quit it (DayBoard → Quit DayBoard), then run this again."
  fi

  trap cleanup EXIT
  WORK="$(mktemp -d "${TMPDIR:-/tmp}/dayboard-install.XXXXXX")"
  local dmg="$WORK/$DMG_NAME"

  say "Downloading DayBoard ${VERSION}…"
  curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 --retry 2 \
    --progress-bar --output "$dmg" "$DMG_URL" || fail "the download failed. Check your connection and try again."

  say "Checking the download…"
  local actual
  actual="$(shasum -a 256 "$dmg" | awk '{print $1}')"
  [ "$actual" = "$DMG_SHA256" ] ||
    fail "the download's SHA-256 is $actual, not the published $DMG_SHA256."
  require_team "$dmg" "The disk image"
  require_notarized open "$dmg" "the disk image"

  MOUNT="$WORK/mount"
  mkdir "$MOUNT"
  # hdiutil's own messages are shown only if the image fails to open (newer macOS prints a
  # deprecation notice on every attach).
  local attach_log
  attach_log="$(hdiutil attach -nobrowse -readonly -noautoopen -mountpoint "$MOUNT" "$dmg" 2>&1 >/dev/null)" ||
    fail "the disk image would not open. ${attach_log}"
  [ -d "$MOUNT/$APP_NAME" ] || fail "the disk image does not contain $APP_NAME."

  # Copy next to the destination first, check that copy, then swap it into place.
  STAGE="$(mktemp -d "$dest/.dayboard-install.XXXXXX")"
  ditto "$MOUNT/$APP_NAME" "$STAGE/$APP_NAME" || fail "copying DayBoard failed."
  codesign --verify --deep --strict "$STAGE/$APP_NAME" 2>/dev/null ||
    fail "DayBoard's signature is not valid."
  require_team "$STAGE/$APP_NAME" "DayBoard"
  require_notarized execute "$STAGE/$APP_NAME" "DayBoard"

  say "Installing to ${target}…"
  if [ -e "$target" ]; then
    mv "$target" "$STAGE/previous.app"
    if ! mv "$STAGE/$APP_NAME" "$target"; then
      mv "$STAGE/previous.app" "$target"
      fail "the old copy could not be replaced."
    fi
  else
    mv "$STAGE/$APP_NAME" "$target" || fail "DayBoard could not be moved into $dest."
  fi

  say ""
  say "DayBoard ${VERSION} is installed. Your DayBoard data was not changed."
  say "Open it from Applications, or run:  open \"$target\""
}

# Nothing runs until the whole script has arrived.
main "$@"
