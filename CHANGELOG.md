# Changelog

All notable changes to the Project Studios fork are recorded here.

The original upstream repository contains the pre-fork release history. This fork began from upstream commit `65bfdb57da16f9963ac63d34c6b4098dc3535d17` at upstream version `1.8.8`.

## 1.8.8-ps.1 - 2026-09-17

### Added

- Project Studios package identity: `@shaunpalmer/dsh-cost-tracker`.
- Hardened host wrapper (`index.safe.js`).
- Project Studios hardening documentation and regression checks.

### Security and privacy

- Prevent the upstream nav-icon routine from locating and modifying installed DSH UI files when this fork is loaded through its package entrypoint.
- Keep cloud sync disabled by default.
- Hash session identifiers by default if cloud sync is deliberately enabled.
- Require explicit opt-in before project/purpose metadata is uploaded.
- Write local cost records with owner-only file permissions and create their storage directory as owner-only on POSIX systems.

### Changed

- Replaced the large upstream browser client with a compact English `client.js`.
- The primary README now documents the hardened fork in English.
- The optional upstream settings-schema surface is suppressed by the hardened wrapper to avoid duplicate configuration surfaces while the fork is reduced.

### Preserved

- Upstream pricing, accounting, persistence format, token normalization, cloud engine, and host API logic remain based on the audited upstream `1.8.8` baseline unless explicitly changed above.
