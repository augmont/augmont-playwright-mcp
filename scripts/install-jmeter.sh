#!/usr/bin/env bash
# Install Apache JMeter into ./tools for web-load CLI runs.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${JMETER_VERSION:-5.6.3}"
TOOLS="$ROOT/tools"
DIR="$TOOLS/apache-jmeter-$VERSION"
BIN="$DIR/bin/jmeter"

resolve_java_home() {
  if [[ -n "${JAVA_HOME:-}" ]]; then
    echo "$JAVA_HOME"
    return
  fi
  local candidates=(
    "/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home"
    "/opt/homebrew/opt/openjdk"
    "/usr/local/opt/openjdk/libexec/openjdk.jdk/Contents/Home"
    "/usr/local/opt/openjdk"
  )
  for c in "${candidates[@]}"; do
    if [[ -x "$c/bin/java" ]]; then
      echo "$c"
      return
    fi
  done
}

JAVA_HOME_RESOLVED="$(resolve_java_home || true)"
if [[ -n "$JAVA_HOME_RESOLVED" ]]; then
  export JAVA_HOME="$JAVA_HOME_RESOLVED"
  export JRE_HOME="$JAVA_HOME_RESOLVED"
  export PATH="$JAVA_HOME_RESOLVED/bin:$PATH"
fi

if [[ -x "$BIN" ]]; then
  echo "JMeter already at $BIN"
  "$BIN" -v | head -3 || true
  exit 0
fi

if command -v jmeter >/dev/null 2>&1; then
  echo "System jmeter found: $(command -v jmeter)"
  jmeter -v | head -3 || true
  exit 0
fi

if ! command -v java >/dev/null 2>&1; then
  echo "Java is required. On Mac: brew install openjdk"
  echo "Then add to ~/.zshrc:"
  echo '  export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"'
  exit 1
fi

mkdir -p "$TOOLS"
ARCHIVE="apache-jmeter-$VERSION.tgz"
URL="${JMETER_DOWNLOAD_URL:-https://archive.apache.org/dist/jmeter/binaries/$ARCHIVE}"
echo "Downloading $URL"
curl -fL "$URL" -o "$TOOLS/$ARCHIVE"
tar -xzf "$TOOLS/$ARCHIVE" -C "$TOOLS"
rm -f "$TOOLS/$ARCHIVE"
chmod +x "$BIN"
echo "Installed $BIN"
"$BIN" -v | head -3 || true
