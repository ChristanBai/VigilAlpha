#!/bin/bash
set -euo pipefail
umask 077

# Use a permanent release copy: removing Downloads must not break the plugin.
release_root="$(cd "$(dirname "$0")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
previous_marketplace_source=""
marketplace_replaced=0

fail() { printf '\n安装未完成：%s\n' "$1" >&2; exit 1; }
on_error() {
  set +e
  if [[ "$marketplace_replaced" == "1" && -n "$previous_marketplace_source" ]]; then
    codex plugin marketplace remove vigilalpha >/dev/null 2>&1
    codex plugin marketplace add "$previous_marketplace_source" >/dev/null 2>&1
    printf '\n已尝试恢复原 VigilAlpha marketplace：%s\n' "$previous_marketplace_source" >&2
  fi
  printf '\n安装中止。已有账户数据和钥匙串未由此脚本修改。请保留终端中的错误信息。\n' >&2
}
trap on_error ERR

[[ "$(uname -s)" == "Darwin" ]] || fail '必须在你的 Mac 上运行；云端 Linux 不能代替 Mac 安装。'
command -v node >/dev/null || fail '缺少 Node.js 22 或更新版本。'
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) process.exit(1)' || fail 'Node.js 版本低于 22。'
command -v codex >/dev/null || fail '未找到 codex 命令。请在已安装 Codex CLI 的 Mac 终端运行。'
codex plugin add --help >/dev/null || fail '当前 Codex CLI 不支持 plugin add。'
[[ -f "$release_root/release-files.sha256" ]] || fail '缺少安装包校验清单，请使用完整发布包。'
(cd "$release_root" && shasum -a 256 -c release-files.sha256 >/dev/null) || fail '安装包文件校验失败。'

release_version="$(node -p 'require(process.argv[1]).version' "$release_root/plugins/vesper-codex/package.json")"
[[ "$release_version" == "0.1.0-dev.18" ]] || fail '此安装入口只接受 dev.18。'
release_digest="$(shasum -a 256 "$release_root/release-files.sha256" | cut -c1-12)"
release_parent="$HOME/Library/Application Support/VigilAlpha/releases"
release_destination="$release_parent/$release_version-$release_digest"

if [[ -e "$release_destination" ]]; then
  (cd "$release_destination" && shasum -a 256 -c release-files.sha256 >/dev/null) || fail '已有目标目录内容不完整；保留现场，请检查后重试。'
else
  mkdir -p "$release_parent"
  release_stage="$(mktemp -d "$release_parent/.install-XXXXXX")"
  cp -R "$release_root/." "$release_stage/"
  (cd "$release_stage" && shasum -a 256 -c release-files.sha256 >/dev/null)
  mv "$release_stage" "$release_destination"
fi

printf '正在验证 dev.18 并注册本地插件……\n'
(cd "$release_destination/plugins/vesper-codex" && npm run check && npm test)
marketplace_list="$(mktemp "${TMPDIR:-/tmp}/vigilalpha-marketplaces-XXXXXX")"
codex plugin marketplace list --json > "$marketplace_list"
previous_marketplace_source="$(node --input-type=module - "$marketplace_list" <<'NODE'
import { readFileSync } from 'node:fs';
const data = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const existing = data.marketplaces?.find(item => item.name === 'vigilalpha');
process.stdout.write(existing?.marketplaceSource?.source || existing?.root || '');
NODE
)"
rm -f "$marketplace_list"
if [[ -n "$previous_marketplace_source" && "$previous_marketplace_source" != "$release_destination" ]]; then
  marketplace_replaced=1
  codex plugin marketplace remove vigilalpha --json >/dev/null
fi
if [[ "$previous_marketplace_source" != "$release_destination" ]]; then
  codex plugin marketplace add "$release_destination"
fi
install_receipt="$(mktemp "${TMPDIR:-/tmp}/vigilalpha-install-XXXXXX")"
codex plugin add vigilalpha-codex@vigilalpha --json > "$install_receipt"
node --input-type=module - "$install_receipt" "$release_destination/plugins/vesper-codex" <<'NODE'
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const receipt = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (receipt.name !== 'vigilalpha-codex' || receipt.version !== '0.1.0-dev.18' || !receipt.installedPath) {
  throw new Error('CLI 未返回可核验的 dev.18 安装记录。');
}
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
function verify(relative = '') {
  for (const entry of readdirSync(join(process.argv[3], relative), { withFileTypes: true })) {
    const child = join(relative, entry.name);
    if (entry.isDirectory()) verify(child);
    else if (!entry.isFile() || digest(join(process.argv[3], child)) !== digest(join(receipt.installedPath, child))) {
      throw new Error(`已安装文件与本次发布包不同：${child}`);
    }
  }
}
verify();
console.log(`已核验插件文件：${receipt.installedPath}`);
NODE
rm -f "$install_receipt"
marketplace_replaced=0
codex plugin list

printf '\n安装命令执行完成，源版本：%s\n位置：%s\n' "$release_version" "$release_destination"
printf '请在插件列表中核对 VigilAlpha，再重启桌面应用并开启新任务核验加载版本。\n'
printf '此版本为只读研究工具；安装成功不表示已连接 Practice 或已提交模拟订单。\n'
printf 'Kronos 模型权重和 Python 实验环境需要另行配置。\n'
