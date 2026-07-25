# Security and safety

## Safety scope

Betaflight RX Monitor is a read-only, propellers-off bench diagnostic tool.
It does not set an arming lock and must not be treated as a safety system or
as in-flight telemetry.

Before connecting:

1. Remove all propellers.
2. Secure the aircraft.
3. Close other programs using the serial port.
4. Confirm that the selected USB device is the intended flight controller.

## Reporting a vulnerability

Do not publish security-sensitive details in a public issue. Contact the
repository owner privately through their GitHub profile and include:

- affected version;
- reproduction steps;
- expected and observed impact;
- browser and operating system;
- whether a flight controller or only Demo mode is required.

This alpha has no server-side application component. Serial data is processed
locally in the browser.
