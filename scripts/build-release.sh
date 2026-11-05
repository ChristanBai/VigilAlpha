#!/bin/bash
set -euo pipefail

repository_root="$(cd "$(dirname "$0")/.." && pwd)"
plugin_root="$repository_root/plugins/vesper-codex"
version="$(cd "$plugin_root" && node -p "require('./package.json').version")"
artifact_name="vigilalpha-codex-$version"
temporary_root="$(mktemp -d)"
stage_root="$temporary_root/$artifact_name"
distribution_root="$repository_root/dist"

cleanup() {
  rm -rf "$temporary_root"
}
trap cleanup EXIT

mkdir -p "$stage_root/.agents/plugins" "$stage_root/plugins" "$stage_root/docs" "$distribution_root"

cp "$repository_root/.agents/plugins/marketplace.json" "$stage_root/.agents/plugins/marketplace.json"
cp -R "$plugin_root" "$stage_root/plugins/vesper-codex"
cp "$repository_root/README.md" "$stage_root/README.md"
cp "$repository_root/README.zh-CN.md" "$stage_root/README.zh-CN.md"
cp "$repository_root/RELEASE_CHECKLIST.md" "$stage_root/RELEASE_CHECKLIST.md"
cp "$repository_root/LICENSE" "$stage_root/LICENSE"
cp "$repository_root/SECURITY.md" "$stage_root/SECURITY.md"
cp "$repository_root/CONTRIBUTING.md" "$stage_root/CONTRIBUTING.md"
cp "$repository_root/CHANGELOG.md" "$stage_root/CHANGELOG.md"
cp "$repository_root/Install-on-Mac.command" "$stage_root/Install-on-Mac.command"
cp "$repository_root/docs/INSTALL.md" "$stage_root/docs/INSTALL.md"
cp "$repository_root/docs/INSTALL_DEV18_ZH.md" "$stage_root/docs/INSTALL_DEV18_ZH.md"
cp "$repository_root/docs/INVEST_PRACTICE.md" "$stage_root/docs/INVEST_PRACTICE.md"
cp "$repository_root/docs/OPEN_SOURCE_REVIEW.md" "$stage_root/docs/OPEN_SOURCE_REVIEW.md"
cp "$repository_root/docs/PRODUCT_GOALS.md" "$stage_root/docs/PRODUCT_GOALS.md"
cp "$repository_root/docs/RESEARCH_VALIDATION.md" "$stage_root/docs/RESEARCH_VALIDATION.md"
cp "$repository_root/docs/EXPERIMENT_INTEGRATION.md" "$stage_root/docs/EXPERIMENT_INTEGRATION.md"
cp "$repository_root/docs/RESEARCH_FRAMEWORK.md" "$stage_root/docs/RESEARCH_FRAMEWORK.md"
cp "$repository_root/docs/UX_ACCEPTANCE.md" "$stage_root/docs/UX_ACCEPTANCE.md"
cp -R "$repository_root/docs/images" "$stage_root/docs/images"

find "$stage_root" -name ".DS_Store" -delete
find "$stage_root" -type d -name "__pycache__" -prune -exec rm -rf {} +
find "$stage_root" -type f -name "*.pyc" -delete
(
  cd "$stage_root"
  find . -type f ! -name "release-files.sha256" -print | LC_ALL=C sort | while IFS= read -r file; do
    shasum -a 256 "$file"
  done > release-files.sha256
)

archive="$distribution_root/$artifact_name.zip"
checksum="$archive.sha256"
rm -f "$archive" "$checksum"
(
  cd "$temporary_root"
  /usr/bin/zip -X -q -r "$archive" "$artifact_name"
)
(
  cd "$distribution_root"
  shasum -a 256 "$(basename "$archive")" > "$(basename "$checksum")"
)

printf '%s\n' "$archive" "$checksum"
