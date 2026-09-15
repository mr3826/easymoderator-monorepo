#!/usr/bin/env bash
# Bash equivalent of dev-env.ps1 (Phase 2, Lane 0 — mobile/p2-devenv). See docs/mobile/DEV_SETUP.md §1.
#
# Session-scoped only: exported variables live only in the shell that sources this file (never
# written to a profile, registry, or machine-wide env). Usage: from EasyMod-mobile/, run
# `source scripts/dev-env.sh` before any Android build/emulator command in a bash shell
# (e.g. Git Bash on the same Windows workstation described in docs/mobile/CURRENT_STATE.md §13).

JDK_PATH_WIN='C:\Program Files\Java\jdk-17'
JDK_PATH_POSIX='/c/Program Files/Java/jdk-17'
ANDROID_HOME_WIN='D:\Android\Sdk'
ANDROID_HOME_POSIX='/d/Android/Sdk'

if [ ! -d "$JDK_PATH_POSIX" ]; then
    echo "dev-env.sh: expected JDK 17 at '$JDK_PATH_POSIX' — see docs/mobile/CURRENT_STATE.md §13." >&2
    return 1 2>/dev/null || exit 1
fi
if [ ! -d "$ANDROID_HOME_POSIX" ]; then
    echo "dev-env.sh: expected Android SDK at '$ANDROID_HOME_POSIX' — see docs/mobile/CURRENT_STATE.md §13." >&2
    return 1 2>/dev/null || exit 1
fi

export JAVA_HOME="$JDK_PATH_WIN"
export ANDROID_HOME="$ANDROID_HOME_WIN"
export ANDROID_SDK_ROOT="$ANDROID_HOME_WIN"

export PATH="$JDK_PATH_POSIX/bin:$ANDROID_HOME_POSIX/platform-tools:$ANDROID_HOME_POSIX/emulator:$ANDROID_HOME_POSIX/cmdline-tools/latest/bin:$PATH"

# Opt-in local-build convenience (docs/mobile/DEV_SETUP.md §2, "Single-ABI local-build flag").
# Unset by default — never changes android/gradle.properties' own default of building all four
# ABIs, and CI/EAS never source this script, so this cannot affect a release or CI build matrix.
# To use: export EASYMOD_ANDROID_LOCAL_ABI=x86 (or your AVD/device's real ABI) BEFORE sourcing
# this script.
if [ -n "$EASYMOD_ANDROID_LOCAL_ABI" ]; then
    export ORG_GRADLE_PROJECT_reactNativeArchitectures="$EASYMOD_ANDROID_LOCAL_ABI"
    echo "dev-env.sh: EASYMOD_ANDROID_LOCAL_ABI set — gradlew will build only '$EASYMOD_ANDROID_LOCAL_ABI' (this shell only; android/gradle.properties' own default is untouched)."
fi

echo "dev-env.sh: JAVA_HOME=$JAVA_HOME ANDROID_HOME=$ANDROID_HOME (this shell only)"
