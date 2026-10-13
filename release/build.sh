#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

VERSION=$(grep -m1 '"version"' manifest.json | sed -E 's/.*"version": "([^"]+)".*/\1/')
ZIP_NAME="polyglot-page-translator-v${VERSION}.zip"
XPI_NAME="polyglot-page-translator.xpi"

# Remove prior zip archives to keep folder clean
rm -f polyglot-page-translator-v*.zip polyglot-page-translator*.xpi

# Package clean archive for AMO upload
zip -r -FS "$ZIP_NAME" manifest.json background.js lib/ content/ popup/ options/ icons/
cp "$ZIP_NAME" "$XPI_NAME"

echo "AMO Release Package ready: $DIR/$ZIP_NAME"
echo "Local XPI ready: $DIR/$XPI_NAME"
