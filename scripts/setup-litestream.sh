#!/usr/bin/env bash
set -euo pipefail

LITESTREAM_VERSION="0.3.13"
ARCH="linux-amd64"

if command -v litestream &>/dev/null; then
  echo "Litestream already installed: $(litestream version)"
  exit 0
fi

echo "Downloading Litestream v${LITESTREAM_VERSION}..."
curl -fsSL "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-${ARCH}.tar.gz" \
  | tar -xz

sudo mv litestream /usr/local/bin/litestream
echo "Litestream installed: $(litestream version)"