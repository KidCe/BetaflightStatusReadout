# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and versions follow Semantic
Versioning.

## [0.1.0-alpha.1] - 2026-07-25

### Added

- Read-only Web Serial and MSP v1 communication
- Flight-controller handshake and capability information
- RXLOSS, FAILSAFE, RSSI and RC-channel monitoring
- Configurable audio alarms with distinct preview sounds
- USB disconnect and automatic reconnect sounds
- Automatic reconnect to an already authorized serial port
- Stale MSP data detection and event log
- Demo mode for alarm testing without hardware
- GitHub Pages deployment and CI workflows
- Automated protocol, decoder, alarm and reconnect tests

### Changed

- Standardized the entire repository and UI on English
- Removed unsupported Link Quality fields, simulation and alarm behavior
- Added a concise note explaining the Betaflight MSP 1.48 LQ limitation
- Hardened the local static-file server against path traversal
- Added MIT licensing and contributor guidance
