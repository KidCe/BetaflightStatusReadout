# Betaflight communication for extensible RX monitoring

Date: 2026-07-25

## Research scope

This research uses the following source revisions:

- Betaflight Configurator, branch `2026.6-maintenance`, commit
  [`c235c7a`](https://github.com/betaflight/betaflight-configurator/tree/c235c7ace271c0b45ccff4266d4689234a34178e)
- Betaflight firmware, branch `2026.6-maintenance`, commit
  [`65379f4`](https://github.com/betaflight/betaflight/tree/65379f4a8634088710b7cc3a558e3ad19a60ba6c)
- The official generated
  [MSP protocol reference](https://betaflight.com/docs/development/MSP-Protocol-Reference-Dev)

## Summary

A focused RX monitor can reuse the architectural ideas and protocol behavior
of Betaflight Configurator. The Configurator has mature transport and MSP
layers, but those modules are coupled to global UI and application state.
For a fast independent web alpha, a small read-only MSP implementation is
easier to validate. A future Configurator-derived desktop application should
remain GPL-compatible.

An unmodified flight controller immediately exposes:

- **RXLOSS:** `MSP_STATUS_EX`, specifically bit 2 of
  `armingDisableFlags`
- **Failsafe states:** bits 1, 2 and 4 of the same mask
- **RSSI:** `MSP_ANALOG`, range 0–1023
- **RC channels:** `MSP_RC`

The major limitation is **Link Quality**. Firmware calculates numeric LQ
internally but does not expose a general live numeric LQ value through the
normal MSP 1.48 read API. A clean long-term solution is a new read-only MSPv2
RX-link-statistics command.

## Reusable communication architecture

### Transport facade

`src/js/serial.js` provides the Configurator's shared `Serial` facade. It
registers Web Serial, Tauri Native Serial, Android/Capacitor, Bluetooth,
TCP/WebSocket and virtual-FC transports. It delegates connect, disconnect,
receive, send and device-list operations to the selected transport. This is
the correct boundary between UI and physical transport
([`serial.js`](https://github.com/betaflight/betaflight-configurator/blob/c235c7ace271c0b45ccff4266d4689234a34178e/src/js/serial.js#L1-L53)).

The browser `WebSerial` implementation:

- lists authorized ports with `navigator.serial.getPorts()`;
- requests permission with `navigator.serial.requestPort()`;
- opens a port at 115200 baud by default;
- reads the asynchronous byte stream;
- forwards receive events;
- handles hot-plug and disconnect behavior.

See
[`WebSerial.js`](https://github.com/betaflight/betaflight-configurator/blob/c235c7ace271c0b45ccff4266d4689234a34178e/src/js/protocols/WebSerial.js#L35-L82).

The desktop Configurator uses Vue 3, Pinia, Vite and Tauri 2
([`package.json`](https://github.com/betaflight/betaflight-configurator/blob/c235c7ace271c0b45ccff4266d4689234a34178e/package.json#L51-L89)).
`TauriSerial` calls `tauri-plugin-serialplugin` through Tauri commands
([`TauriSerial.js`](https://github.com/betaflight/betaflight-configurator/blob/c235c7ace271c0b45ccff4266d4689234a34178e/src/js/protocols/TauriSerial.js#L44-L45)).

Tauri is the stronger long-term desktop delivery option. Web Serial remains
well suited to browser prototypes and a hosted PWA-style tool.

### MSP codec and request queue

`src/js/msp.js` implements:

- MSP v1 and v2 framing;
- parser states and CRC validation;
- response listeners and callback matching;
- Promise-based requests;
- serialization or deduplication of matching requests;
- one-second timeout handling with up to three attempts.

See the
[`decoder`](https://github.com/betaflight/betaflight-configurator/blob/c235c7ace271c0b45ccff4266d4689234a34178e/src/js/msp.js#L6-L100)
and
[`send_message()` / `promise()`](https://github.com/betaflight/betaflight-configurator/blob/c235c7ace271c0b45ccff4266d4689234a34178e/src/js/msp.js#L499-L671).
Message IDs are centralized in
[`MSPCodes.js`](https://github.com/betaflight/betaflight-configurator/blob/c235c7ace271c0b45ccff4266d4689234a34178e/src/js/msp/MSPCodes.js#L1-L130).

### Why the Configurator modules are not a standalone SDK

The MSP layer is coupled to the application:

- `msp.js` imports `GUI`, `CONFIGURATOR` and the global serial instance.
- `MSPHelper.js` imports localization, GUI, OSD, tab management and
  `serial_backend`.
- `serial_backend.js` combines transport, handshake, stores, dialogs,
  navigation and analytics and documents a circular dependency.

See the source beginnings for
[`msp.js`](https://github.com/betaflight/betaflight-configurator/blob/c235c7ace271c0b45ccff4266d4689234a34178e/src/js/msp.js#L1-L5),
[`MSPHelper.js`](https://github.com/betaflight/betaflight-configurator/blob/c235c7ace271c0b45ccff4266d4689234a34178e/src/js/msp/MSPHelper.js#L1-L20)
and
[`serial_backend.js`](https://github.com/betaflight/betaflight-configurator/blob/c235c7ace271c0b45ccff4266d4689234a34178e/src/js/serial_backend.js#L1-L33).

## MSP uses polling, not telemetry subscriptions

The RX and status values examined here are actively requested. The
Configurator listens for response bytes but the FC does not subscribe a
client to continuous LQ, RSSI or status pushes.

- The Receiver tab requests `MSP_RC` every 33 ms for its model preview and
  uses an additional configurable plot poll
  ([`ReceiverTab.vue`](https://github.com/betaflight/betaflight-configurator/blob/c235c7ace271c0b45ccff4266d4689234a34178e/src/components/tabs/ReceiverTab.vue#L1241-L1277)).
- Global live status sequentially requests `MSP_ANALOG`, battery data, box
  names and `MSP_STATUS_EX` every 250 ms
  ([`serial_backend.js`](https://github.com/betaflight/betaflight-configurator/blob/c235c7ace271c0b45ccff4266d4689234a34178e/src/js/serial_backend.js#L1267-L1318)).

The source warns that overlapping asynchronous polling cycles can queue
requests on slow FCs and fill the serial buffer until the FC hangs
([`serial_backend.js`](https://github.com/betaflight/betaflight-configurator/blob/c235c7ace271c0b45ccff4266d4689234a34178e/src/js/serial_backend.js#L39-L45)).

### Recommended polling model

One scheduler should own the MSP request queue:

1. Permit at most one poll request at a time per transport.
2. Use priority groups instead of independent intervals:
   - critical status: `MSP_STATUS_EX`, about 10 Hz;
   - link values: `MSP_ANALOG`, about 5–10 Hz;
   - RC channels: only while visible, about 20–30 Hz;
   - metadata: once during connection.
3. Start the next request only after response, timeout or cancellation.
4. Add `receivedAt` to normalized samples so missing data becomes `STALE`.
5. Treat timeouts, CRC errors, USB disconnects and RXLOSS as separate events.

`MSP_MULTIPLE_MSP` may later bundle several MSP-v1 reads into one round trip.
The firmware defines it in
[`msp_protocol.h`](https://github.com/betaflight/betaflight/blob/65379f4a8634088710b7cc3a558e3ad19a60ba6c/src/main/msp/msp_protocol.h#L262-L264),
and the Configurator already parses it in
[`MSPHelper.js`](https://github.com/betaflight/betaflight-configurator/blob/c235c7ace271c0b45ccff4266d4689234a34178e/src/js/msp/MSPHelper.js#L1755-L1791).

## RX, RSSI, LQ and failsafe data

### RXLOSS and failsafe

After the flight-mode flags, `MSP_STATUS_EX` contains the arming-disable flag
count and a 32-bit `armingDisableFlags` mask
([firmware `msp.c`](https://github.com/betaflight/betaflight/blob/65379f4a8634088710b7cc3a558e3ad19a60ba6c/src/main/msp/msp.c#L1131-L1169)).
The Configurator decodes this into `FC.CONFIG.armingDisableFlags`
([`MSPHelper.js`](https://github.com/betaflight/betaflight-configurator/blob/c235c7ace271c0b45ccff4266d4689234a34178e/src/js/msp/MSPHelper.js#L231-L250)).

Relevant bits:

| Bit | Mask | Meaning |
|---:|---:|---|
| 1 | `1 << 1` | `ARMING_DISABLED_FAILSAFE` |
| 2 | `1 << 2` | `ARMING_DISABLED_RX_FAILSAFE`, displayed as RXLOSS |
| 4 | `1 << 4` | `ARMING_DISABLED_BOXFAILSAFE` |

Definitions are in
[`runtime_config.h`](https://github.com/betaflight/betaflight/blob/65379f4a8634088710b7cc3a558e3ad19a60ba6c/src/main/fc/runtime_config.h#L38-L75).
The display label is in
[`runtime_config.c`](https://github.com/betaflight/betaflight/blob/65379f4a8634088710b7cc3a558e3ad19a60ba6c/src/main/fc/runtime_config.c#L36-L44).

A pure RXLOSS alarm must test
`(armingDisableFlags & (1 << 2)) !== 0`, mask `0x00000004`. It must not treat
the broader "any failsafe state" getter as semantically identical to RXLOSS.

Firmware sets RXLOSS after 150 ms without a valid RX frame and then checks in
50 ms intervals
([`rx.c`](https://github.com/betaflight/betaflight/blob/65379f4a8634088710b7cc3a558e3ad19a60ba6c/src/main/rx/rx.c#L615-L630)).
The flag clears only after a stable recovery period
([`failsafe.c`](https://github.com/betaflight/betaflight/blob/65379f4a8634088710b7cc3a558e3ad19a60ba6c/src/main/flight/failsafe.c#L181-L220)).

### RSSI

`MSP_ANALOG` contains legacy voltage, consumed mAh, RSSI as `uint16`, current
and extended voltage. Firmware sends `getRssi()`
([`msp.c`](https://github.com/betaflight/betaflight/blob/65379f4a8634088710b7cc3a558e3ad19a60ba6c/src/main/msp/msp.c#L786-L792)).
The Configurator decodes RSSI as 0–1023
([`MSPHelper.js`](https://github.com/betaflight/betaflight-configurator/blob/c235c7ace271c0b45ccff4266d4689234a34178e/src/js/msp/MSPHelper.js#L350-L356)).

The UI may normalize this value to percent but should preserve the raw source.
RSSI percent, RSSI dBm and LQ are not interchangeable.

### RC channels

`MSP_RC` returns one `uint16` value for each active channel
([firmware `msp.c`](https://github.com/betaflight/betaflight/blob/65379f4a8634088710b7cc3a558e3ad19a60ba6c/src/main/msp/msp.c#L1358-L1362)).
This is useful for channel movement and failsafe values, but it is not an
explicit receiver-link status.

### The LQ gap

Firmware provides `rxGetLinkQualityPercent()` internally
([`rx.c`](https://github.com/betaflight/betaflight/blob/65379f4a8634088710b7cc3a558e3ad19a60ba6c/src/main/rx/rx.c#L1064-L1080)).
Neither `MSP_ANALOG` nor `MSP_RC` includes that value, and the normal MSP
command list has no dedicated general RX-link read
([`msp_protocol.h`](https://github.com/betaflight/betaflight/blob/65379f4a8634088710b7cc3a558e3ad19a60ba6c/src/main/msp/msp_protocol.h#L94-L278)).

Possible approaches:

1. **Opt-in debug workaround:** Debug mode `RX_TIMING` places LQ percent in
   `debug[6]` and RX state in `debug[7]`
   ([`fc/rc.c`](https://github.com/betaflight/betaflight/blob/65379f4a8634088710b7cc3a558e3ad19a60ba6c/src/main/fc/rc.c#L319-L327)).
   This conflicts with Blackbox and other debug uses, so a tool would have to
   preserve and restore the previous debug mode.
2. **OSD warning fallback:** `MSP2_GET_OSD_WARNINGS` can return a rendered
   `LINK QUALITY` warning, but it depends on the OSD build and configuration
   and does not supply a freely selectable numeric threshold
   ([OSD warning logic](https://github.com/betaflight/betaflight/blob/65379f4a8634088710b7cc3a558e3ad19a60ba6c/src/main/osd/osd_warnings.c#L337-L345)).
3. **Long-term solution:** Add a read-only MSPv2 command such as
   `MSP2_BETAFLIGHT_RX_LINK_STATS` returning LQ %, RSSI %, RSSI dBm, RF mode,
   `rxSignalPresent` and failsafe phase. Clients should query
   `MSP_API_VERSION` and handle unsupported commands cleanly
   ([MSP guidance](https://github.com/betaflight/betaflight/blob/65379f4a8634088710b7cc3a558e3ad19a60ba6c/src/main/msp/msp_protocol.h#L21-L53)).

An honest MVP should omit numeric LQ and show a short explanatory note unless
a compatible explicit read command exists.

## Browser and safety constraints

Normal USB MSP uses a serial connection, usually USB CDC or a virtual COM
port. WebUSB in Configurator is used for DFU/flashing paths, not normal MSP
runtime transport.

Web Serial requires a secure context, is not supported by every browser and
requires a user gesture for `requestPort()`. See the
[Web Serial specification](https://wicg.github.io/serial/) and
[MDN reference](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API).
The app therefore needs HTTPS or localhost plus an explicit Connect button.

Browser autoplay rules may block audio. The UI needs a user-triggered
AudioContext activation and sound-preview controls
([Chromium autoplay policy](https://www.chromium.org/audio-video/autoplay/)).

A serial port can normally be opened by only one application. Configurator
and monitor cannot reliably use the same FC simultaneously.

Configurator disables arming after connecting and re-enables it on a clean
disconnect
([connection flow](https://github.com/betaflight/betaflight-configurator/blob/c235c7ace271c0b45ccff4266d4689234a34178e/src/js/serial_backend.js#L1066-L1076)).
The current independent web alpha does not write this lock, so it must remain
a propellers-off bench tool.

## License implications

Betaflight Configurator is GPL-3.0
([`package.json`](https://github.com/betaflight/betaflight-configurator/blob/c235c7ace271c0b45ccff4266d4689234a34178e/package.json#L42-L49)).
A distributed derivative fork must retain the GPL terms, change notices and
corresponding-source obligations described in
[GPLv3 sections 5 and 6](https://github.com/betaflight/betaflight-configurator/blob/c235c7ace271c0b45ccff4266d4689234a34178e/LICENSE#L208-L286).

This repository's independent transport and parser implementation is
MIT-licensed. It should not copy or import Configurator implementation code
without a separate GPL compatibility review. This is a technical summary, not
legal advice.

## Target architecture

```text
UI: dashboard / metric cards / alarm editor / event log
                            |
                            v
Application: RxMonitorStore + AlarmEngine + SessionRecorder
                            |
                            v
Domain: MetricDefinition + Sample + StatusEvent + AlarmRule
                            |
                            v
Betaflight adapter: capability discovery + PollScheduler + decoders
                            |
                            v
MSP core: request queue + v1/v2 codec + CRC + timeout
                            |
                            v
Transport: Tauri Serial | Web Serial | future BLE/TCP/Virtual
```

Important interfaces:

- `Transport`: list devices, connect, send bytes and emit lifecycle events.
- `MspClient`: `request(code, payload, timeout)` and clean cancellation.
- `MetricProvider`: MSP code, poll rate, decoder, unit and availability.
- `CapabilityRegistry`: decide support from API version and optional commands.
- `AlarmEngine`: evaluate normalized samples rather than raw MSP objects.
- `AudioService`: own activation, volume, cooldown and sound previews.

## Recommended alarm model

Each rule should contain:

- metric ID;
- comparison and threshold;
- minimum trigger duration;
- hysteresis or a separate recovery threshold;
- cooldown/repeat interval;
- sound and volume;
- behavior for stale data, USB disconnect and recovery.

Recommended defaults:

- `RXLOSS == true`: immediate critical alarm with cooldown-based repetition.
- `RSSI < threshold`: short minimum duration and recovery hysteresis.
- `FC data stale`: separate critical alarm.

## Suggested implementation path

1. Validate the independent browser alpha across multiple FCs and receivers.
2. Keep all requests behind a central single-flight scheduler.
3. Expand capability discovery and normalized metric providers.
4. Add persistent settings and session export after the alarm model stabilizes.
5. Propose a generic read-only MSPv2 RX-link-statistics command upstream.
6. Test at minimum ELRS/CRSF, Ghost, SBUS/FPort and USB reconnect behavior.
7. Evaluate a Tauri desktop shell after the web behavior is validated.
