# Betaflight RX Monitor v0.1.0-alpha.1

This first public alpha validates whether a focused receiver diagnostics tool
is useful across different Betaflight flight controllers and receiver
protocols.

## Highlights

- Connect directly from Chrome or Edge through Web Serial.
- Detect RXLOSS and related failsafe flags.
- Monitor RSSI and RC channels.
- Configure and preview receiver-related audio alarms.
- Hear distinct USB disconnect and reconnect sounds.
- Automatically reconnect after a cable or USB interruption.
- Exercise alarm behavior without hardware in Demo mode.

## Important limitation

Numeric live Link Quality is not exposed by the normal Betaflight MSP 1.48
read API. The monitor therefore omits LQ and displays only a short explanatory
note.

## Safety

This release does not prevent arming. Remove all propellers and use it only on
a secured bench.

## Feedback wanted

The most valuable reports include the FC target, Betaflight version, receiver
protocol, operating system, browser version and the relevant event-log lines.
Use the included **Hardware test report** issue form.

## Distribution

The alpha is a dependency-free static web application. Testers can use the
GitHub Pages deployment directly in Chrome or Edge. Developers can run the
same files locally with Node.js 20 or newer and `npm start`.

The independent implementation is released under the MIT License.
