# Security Policy

## Supported version

Only the most recent VigilAlpha release receives security fixes. Development builds are not public
release guarantees.

## Credentials

Use the VigilAlpha inline setup card. Its app-only credential tool validates Trading 212 read access
before saving the key and secret to macOS Keychain. The model cannot invoke that tool, and secrets
must never be pasted into chat, committed to Git, added to screenshots or included in logs.

The Terminal setup command exists only as a compatibility fallback during development.

## Local data

In local mode, configuration, normalized cache and derived snapshots stay on the host running VigilAlpha. VigilAlpha repairs its state
directories to mode `0700` and private data files to mode `0600`. Cloud sync and telemetry are
disabled by default. If an optional cloud transport is explicitly configured, derived data may leave
the host; review its payload and destination separately. These controls reduce exposure but do not
prove absolute security or verify the user's Mac deployment. Upstream API response bodies are not copied into error messages.

## Read-only boundary

The Trading 212 client accepts GET requests only. VigilAlpha has no order-placement, modification,
cancellation or Pie-write tool. Never add a write endpoint to the default package.

## Reporting a vulnerability

Use GitHub's private security-reporting channel when it is available, or contact the repository
owner privately. Do not open a public issue containing a key, secret, account identifier, holdings,
transactions or private diagnostic output. Revoke an exposed Trading 212 key immediately in
Trading 212 `Settings > API`.
