# Betaflight RX Monitor

> **Pre-release `v0.1.0-alpha.1`:** This is a read-only bench-testing tool for
> early hardware feedback. Remove all propellers before connecting a flight
> controller. Do not use it as an in-flight telemetry system.

Betaflight RX Monitor connects to a Betaflight flight controller through Web
Serial and presents a focused receiver-debugging dashboard. It monitors
RXLOSS, RSSI, RC channels and the MSP data connection, then produces
configurable browser audio alarms.

This project is independent and is not affiliated with or endorsed by the
Betaflight project.

## Try it

### Hosted version

The easiest option for testers is the GitHub Pages link shown in the
repository description:

1. Open the Pages URL in Chrome or Edge.
2. Remove propellers and close Betaflight Configurator.
3. Enable audio and preview the alarm sounds.
4. Select **Connect flight controller** and choose the serial port.
5. Switch the transmitter off and on to test RXLOSS and recovery.

Web Serial requires a secure context and a user gesture. A GitHub Pages site
provides HTTPS; the serial data stays in the browser and is not uploaded by
this application.

### Run locally

Requires Node.js 20 or newer:

```sh
npm ci
npm start
```

Then open `http://127.0.0.1:4173` in Chrome or Edge.

## Included in this alpha

- Read-only MSP v1 transport over Web Serial
- Betaflight firmware/API identification
- RXLOSS, FAILSAFE and BOXFAILSAFE flags from `MSP_STATUS_EX`
- RSSI from `MSP_ANALOG`
- Live RC channels from `MSP_RC`
- Single-flight polling without overlapping MSP requests
- Stale-data detection
- Configurable RXLOSS and RSSI alarm thresholds
- Individual audio previews for every alarm and recovery sound
- USB disconnect and successful reconnect sounds
- Automatic reconnect to the previously authorized USB port
- Demo mode for testing alarms without hardware
- In-memory event log

## Known limitations

- Link Quality is intentionally not shown because Betaflight MSP API 1.48
  does not expose a general numeric live-LQ value.
- Web Serial is intended for Chromium-based browsers. Chrome and Edge are the
  supported test targets for this alpha.
- The application does not set an arming lock. It is strictly a propellers-off
  bench tool.
- A serial port can normally be opened by only one program. Close Betaflight
  Configurator before connecting.
- Auto-reconnect identifies the previous device by browser port object and
  USB vendor/product ID. Verify the selected device when several identical
  flight controllers are connected.
- Settings and event history are not persisted.

## Testing and feedback

See [docs/TESTING.md](docs/TESTING.md) for the hardware test matrix and the
information to include with feedback. GitHub issue forms are included for bug
reports and hardware test reports.

Before submitting a change:

```sh
npm run verify
```

## Troubleshooting

- **Connect button disabled:** open the app in current Chrome or Edge.
- **No serial port listed:** reconnect the USB cable and confirm that
  Betaflight Configurator can see the same device.
- **Port already in use:** close Betaflight Configurator and other serial
  applications.
- **No alarm sound:** select **Enable audio** or preview a sound once to
  satisfy browser autoplay rules.
- **Auto-reconnect does not resume:** keep the page open, reconnect the same
  device and confirm that Auto-Reconnect is enabled.

## Privacy

The app has no analytics or application backend. MSP data, RC values and
event-log entries remain in browser memory and are not uploaded by the app.
Reloading the page clears the session.

## AI-assisted development

This project was designed and implemented collaboratively with OpenAI Codex
under human direction and review. Codex assisted with architecture,
implementation, tests, documentation and repository preparation. Hardware
behavior and release decisions remain subject to human testing and approval.

## Technical notes

Metric providers in `public/monitor.js` define an MSP code, polling interval
and decoder. `PollScheduler` serializes all requests. Alarm rules consume
normalized state rather than raw MSP payloads.

The source research and Betaflight references are documented in
[docs/research/betaflight-communication-rx-monitoring.md](docs/research/betaflight-communication-rx-monitoring.md).

## Contributing and license

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before
opening a pull request.

This independent implementation is available under the
[MIT License](LICENSE). Betaflight Configurator itself uses GPL-3.0; do not
copy Configurator implementation code into this repository without a separate
license review.

See [docs/RELEASING.md](docs/RELEASING.md) and the
[alpha release notes](docs/RELEASE_NOTES_v0.1.0-alpha.1.md).
