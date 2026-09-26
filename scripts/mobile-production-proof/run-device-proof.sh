#!/usr/bin/env bash
# Signed-release device proof against production (docs/deployment/MOBILE_API_ACTIVATION_RUNBOOK.md).
#
# Runs inside reactivecircus/android-emulator-runner, which executes its `script:`
# one line at a time, so the whole device step lives here.
#
#   run-device-proof.sh <signed apk> <output dir>
#
# Maestro reads MAESTRO_PROOF_EMAIL / MAESTRO_PROOF_PASSWORD (and the optional
# MAESTRO_PROOF_ORDER_ID / MAESTRO_PROOF_CONVERSATION_ID / MAESTRO_PROOF_MISSING_ID)
# straight from the environment. Nothing here uses `set -x` or puts a credential on a
# command line. Only screenshots, JUnit reports and the summary are kept, and the
# workflow scans them for the password before upload.
set -euo pipefail

apk="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
mkdir -p "$2"
out="$(cd "$2" && pwd)"
package=tech.easymod.merchant.preview
flows="$(cd "$(dirname "$0")" && pwd)/flows"

: "${MAESTRO_PROOF_EMAIL:?}"
: "${MAESTRO_PROOF_PASSWORD:?}"
: "${MAESTRO_PROOF_MISSING_ID:?}"

mkdir -p "$out/junit" "$out/screenshots"
summary="$out/summary.txt"
: > "$summary"

adb wait-for-device
# Emulator-only hygiene, as in EasyMod-mobile/e2e/run-maestro.js: a launcher ANR dialog
# must not fail a flow, and the password field must never echo its last character.
adb shell settings put global hide_error_dialogs 1 || true
adb shell settings put system show_password 0 || true
adb install -r "$apk"
adb shell pm list packages | grep -qx "package:$package"
adb logcat -c || true

failed=0
run_flow() {
  local name="$1"
  mkdir -p "$out/screenshots/$name"
  # Run from the flow's own output directory so screenshots land there whether
  # Maestro writes them to --test-output-dir or to the working directory.
  if (cd "$out/screenshots/$name" && maestro test --no-ansi --format=junit \
      --output="$out/junit/$name.xml" \
      --test-output-dir="$out/screenshots/$name" \
      "$flows/$name.yaml"); then
    echo "$name=PASS" >> "$summary"
  else
    echo "$name=FAIL" >> "$summary"
    failed=1
  fi
  # Maestro also writes debug files here (commands-*.json holds every resolved
  # inputText, i.e. the password). Keep screenshots only.
  find "$out/screenshots/$name" -type f ! -name '*.png' -delete
}

skip_flow() {
  echo "$1=SKIP ($2)" >> "$summary"
}

run_flow 01-journey
if [ -n "${MAESTRO_PROOF_ORDER_ID:-}" ]; then
  run_flow 02-deeplink-order
else
  skip_flow 02-deeplink-order 'no order on production Home'
fi
if [ -n "${MAESTRO_PROOF_CONVERSATION_ID:-}" ]; then
  run_flow 03-deeplink-conversation
else
  skip_flow 03-deeplink-conversation 'no conversation on production Home'
fi
if [ -n "${MAESTRO_PROOF_ORDER_ID:-}" ]; then
  export MAESTRO_PROOF_COLD_LINK="order/$MAESTRO_PROOF_ORDER_ID"
elif [ -n "${MAESTRO_PROOF_CONVERSATION_ID:-}" ]; then
  export MAESTRO_PROOF_COLD_LINK="conversation/$MAESTRO_PROOF_CONVERSATION_ID"
fi
if [ -n "${MAESTRO_PROOF_COLD_LINK:-}" ]; then
  run_flow 04-deeplink-cold
  echo "04-deeplink-cold.entity=${MAESTRO_PROOF_COLD_LINK%%/*}" >> "$summary"
else
  skip_flow 04-deeplink-cold 'no order or conversation on production Home'
fi
run_flow 05-logout-relogin

# A crash of the signed app anywhere in the run fails the proof. Count only; the
# crash buffer is not uploaded.
crashes=$(adb logcat -d -b crash 2>/dev/null | grep -c "Process: $package" || true)
echo "app-crashes=$crashes" >> "$summary"
[ "$crashes" -eq 0 ] || failed=1

cat "$summary"
exit "$failed"
