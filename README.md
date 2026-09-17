# DSH Cost Tracker - Project Studios Fork

A hardened, English-first fork of `Angelyeye/dsh-cost-tracker` for DeepSeek Harness (DSH).

This fork keeps the upstream accounting engine and pricing logic, while narrowing the active UI and integration surface for a local-first installation.

## What this fork changes

- Uses the package identity `@shaunpalmer/dsh-cost-tracker`.
- Loads through `index.safe.js`, which prevents the upstream nav-icon routine from modifying installed DSH UI files.
- Replaces the upstream browser UI with a compact English `client.js`.
- Presents the numbers that matter: today, month, all-time spend, requests, tokens, balance, recent records, CSV export, and current conversation cost.
- Keeps cloud sync disabled by default.
- Hashes session ids by default if cloud sync is manually enabled.
- Does not upload project/purpose metadata unless explicitly opted in.
- Writes the local cost store with owner-only permissions on POSIX systems.
- Pins the fork baseline to upstream commit `65bfdb57da16f9963ac63d34c6b4098dc3535d17`.

## Installation target

The intended installation is the `web` DSH profile from this GitHub repository rather than the upstream npm package.

```bash
dsh plugin --profile web add github:shaunpalmer/dsh-cost-tracker
```

Do not install this hardened fork alongside the upstream package. Both use the stable DSH loader id `dsh-cost-tracker` to prevent duplicate route and slot registration.

## Local data

The upstream accounting engine stores detailed cost records under the DSH storage directory, normally:

```text
~/.dsh/storages/cost-tracker-records.json
```

The Project Studios storage layer writes replacement files with owner-only permissions (`0600`) and creates the storage directory as owner-only (`0700`) where the operating system supports POSIX modes.

## Cloud sync

Cloud sync is not required for normal local cost tracking and remains disabled by default. If it is deliberately enabled later, review the destination URL and token first. The hardened defaults hash session ids and leave project/purpose metadata out of uploads unless explicitly enabled.

## Development

Run the test suite with:

```bash
npm test
```

The Project Studios hardening test checks package identity, browser bundle identity, privacy defaults, storage permissions, and English-only active fork surfaces.

## Upstream

Original project: `Angelyeye/dsh-cost-tracker`.

Upstream version at fork baseline: `1.8.8`.

Detailed upstream English documentation is retained in `README.en.md` while the remaining source-English conversion is completed.

## Licence

MIT. The original licence and attribution remain in `LICENSE`.
