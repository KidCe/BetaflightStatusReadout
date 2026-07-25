# Alpha hardware testing

Thank you for testing `v0.1.0-alpha.1`.

## Safety

- Remove all propellers.
- Use the tool only on a secured bench.
- Do not rely on its alarms while flying.
- Close Betaflight Configurator before connecting.

## Minimum test flow

1. Open the GitHub Pages build in current Chrome or Edge.
2. Enable audio and preview all five sound types.
3. Connect the flight controller.
4. Confirm firmware identifier, MSP API version and RC channel movement.
5. Turn the transmitter off and record the RXLOSS detection delay.
6. Turn the transmitter on and confirm recovery.
7. Disconnect USB and confirm the disconnect sound.
8. Reconnect USB and confirm automatic reconnect plus its sound.
9. Lower the Demo-mode RSSI value to test the warning threshold.
10. Leave the page running for at least ten minutes and note any MSP timeouts.

## Requested hardware coverage

- Receiver protocol: CRSF/ExpressLRS, Ghost, SBUS, FPort or other
- Flight-controller MCU and target
- Betaflight version and MSP API version
- USB interface/driver
- Operating system
- Browser and browser version

## Feedback checklist

Include:

- exact steps;
- expected and observed result;
- timestamped entries from the event log;
- whether the issue reproduces in Demo mode;
- whether Betaflight Configurator works with the same cable and port;
- screenshots when the UI state matters.

Never upload private device data or unrelated browser information.
