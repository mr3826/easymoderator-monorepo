#!/usr/bin/env bash
# Signs a Gradle-built release APK and AAB with the Android upload key (ADR M-013).
#
#   scripts/sign-android-release.sh <in.apk> <in.aab> <out-dir>
#
# Runs as its own CI step after the build, so the key never exists while npm or Gradle
# (and every third-party script they execute) are running. Required environment, all
# provided only to this step from the `mobile-release` GitHub environment:
#
#   ANDROID_UPLOAD_KEYSTORE_BASE64    PKCS12 keystore, base64
#   ANDROID_UPLOAD_KEYSTORE_PASSWORD  store and key password (PKCS12 uses one)
#   ANDROID_UPLOAD_KEY_ALIAS          key alias (release-signing.json)
#
# Fails closed: a missing value stops the run; nothing is ever left debug-signed and
# called a release. The APK keeps Gradle's zip alignment (16 KB native-library pages) and
# gets exactly one signer (v2 + v3; minSdk 24 needs no v1). The AAB loses the Gradle
# debug JAR signature before it is signed once with jarsigner, so it too has one signer.
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 <in.apk> <in.aab> <out-dir>" >&2
  exit 2
fi
in_apk=$1
in_aab=$2
out_dir=$3

for name in ANDROID_UPLOAD_KEYSTORE_BASE64 ANDROID_UPLOAD_KEYSTORE_PASSWORD ANDROID_UPLOAD_KEY_ALIAS; do
  if [ -z "${!name:-}" ]; then
    echo "::error::$name is not set. Refusing to produce a release artifact (there is no debug-signing fallback)." >&2
    exit 1
  fi
done
for file in "$in_apk" "$in_aab"; do
  [ -f "$file" ] || { echo "::error::missing build output $file" >&2; exit 1; }
done

sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
[ -n "$sdk" ] || { echo "::error::ANDROID_HOME is not set" >&2; exit 1; }
build_tools=$(ls -1 "$sdk/build-tools" | sort -V | tail -n 1)
apksigner_jar="$sdk/build-tools/$build_tools/lib/apksigner.jar"
[ -f "$apksigner_jar" ] || { echo "::error::apksigner.jar not found in build-tools $build_tools" >&2; exit 1; }
python=$(command -v python3 || command -v python)

umask 077
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
keystore="$work/upload.p12"
printf '%s' "$ANDROID_UPLOAD_KEYSTORE_BASE64" | base64 --decode > "$keystore"

mkdir -p "$out_dir"
signed_apk="$out_dir/app-release.apk"
signed_aab="$out_dir/app-release.aab"

java -jar "$apksigner_jar" sign \
  --ks "$keystore" --ks-type PKCS12 --ks-key-alias "$ANDROID_UPLOAD_KEY_ALIAS" \
  --ks-pass env:ANDROID_UPLOAD_KEYSTORE_PASSWORD --key-pass env:ANDROID_UPLOAD_KEYSTORE_PASSWORD \
  --v1-signing-enabled false --v2-signing-enabled true --v3-signing-enabled true --v4-signing-enabled false \
  --alignment-preserved true \
  --out "$signed_apk" "$in_apk"

# Copy every entry except the existing JAR signature (keeping each entry's compression).
"$python" - "$in_aab" "$work/unsigned.aab" <<'PY'
import sys
import zipfile

SIGNATURE_SUFFIXES = ('.SF', '.RSA', '.DSA', '.EC')

def is_signature(name):
    upper = name.upper()
    return upper.startswith('META-INF/') and (upper == 'META-INF/MANIFEST.MF' or upper.endswith(SIGNATURE_SUFFIXES))

with zipfile.ZipFile(sys.argv[1]) as source, zipfile.ZipFile(sys.argv[2], 'w') as target:
    for info in source.infolist():
        if not is_signature(info.filename):
            target.writestr(info, source.read(info.filename))
PY

jarsigner -keystore "$keystore" -storetype PKCS12 \
  -storepass:env ANDROID_UPLOAD_KEYSTORE_PASSWORD -keypass:env ANDROID_UPLOAD_KEYSTORE_PASSWORD \
  -sigalg SHA256withRSA -digestalg SHA-256 \
  -signedjar "$signed_aab" "$work/unsigned.aab" "$ANDROID_UPLOAD_KEY_ALIAS" > /dev/null

echo "Signed $signed_apk and $signed_aab with the upload key (alias $ANDROID_UPLOAD_KEY_ALIAS)."
