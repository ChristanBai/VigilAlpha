# VigilAlpha Development Installation

## Requirements

- macOS 14 or later
- Node.js 22 or later
- Codex with plugin support
- Trading 212 Invest or Stocks ISA account

## Install the plugin

For the dev.18 release ZIP, extract it on the target Mac and run
`Install-on-Mac.command` (or `bash /path/to/Install-on-Mac.command` from Terminal).
The installer requires an existing Node.js 22+ and a Codex CLI with plugin support.
It verifies the packaged files, copies the release into
`~/Library/Application Support/VigilAlpha/releases/`, runs the checks, and calls
the CLI marketplace and plugin installation commands. Previous release directories
are retained. It does not update your source checkout or handle account credentials.
If a CLI command fails, installation is incomplete; retain the error output.
Verify the plugin list, restart the desktop app, and check the loaded version in a
new task. Preparing a ZIP on another computer is not installation on your Mac.

The plugin remains read-only. Practice orders require a separately connected,
authenticated broker UI or a separately implemented Demo execution adapter.
Kronos weights and its Python runtime are not included in the ZIP.

For a source checkout:

```bash
git clone https://github.com/ChristanBai/VigilAlpha.git
cd VigilAlpha
codex plugin marketplace add "$PWD"
codex plugin add vigilalpha-codex@vigilalpha
```

Open a new Codex task after installation.

## Configure Trading 212

In Trading 212, open `Settings > API (Beta) > Permissions`.

Enable read-only permissions:

- Account data
- Portfolio
- Pies - Read
- History - Orders
- History - Transactions
- History - Dividends
- Orders - Read
- Metadata

Do not enable `Orders - Execute` or `Pies - Write`.

## Store credentials securely

Restart Codex, open a new conversation and enable `VigilAlpha` from `+` → More/Plugins or by typing
`@VigilAlpha`. Ask it to check setup. The inline setup card sends the API key and secret directly to
the local MCP app-only tool, validates read access, then stores them in macOS Keychain.

Do not paste credentials into a Codex prompt, GitHub issue, screenshot or log. The old Terminal
setup command remains available only as a compatibility fallback during development.

## Start

In the new Codex conversation, say:

```text
检查我的 Trading 212 组合风险
```

VigilAlpha checks configuration, refreshes read-only account facts and returns the review inside the
conversation. The old `start_vesper` browser path is deprecated compatibility behavior.

## Optional Twelve Data

For broader intraday coverage, add an optional supported market-data key in the setup card. Without
one, account risk review remains available and market-dependent evidence degrades explicitly.

## Verify installation

```bash
codex plugin list
```

The plugin should be listed as `vigilalpha-codex@vigilalpha`. A newly installed plugin does not
hot-load into an already-running conversation.

This development guide has not yet passed the clean-macOS release gate. Do not call it a `v1.0`
installation until that gate is recorded as passed.
