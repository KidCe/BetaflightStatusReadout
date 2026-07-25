# Contributing

Thank you for helping test and improve Betaflight RX Monitor.

## Before contributing

- Use English for code, documentation, commits and issue reports.
- Remove all propellers before testing with a flight controller.
- Keep the application read-only unless a proposed write operation has an
  explicit safety design and review.
- Do not commit credentials, local paths, device identifiers or private data.
- Do not copy Betaflight Configurator implementation code into this
  independently licensed repository without a separate license review.

## Development setup

Requires Node.js 20 or newer:

```sh
npm ci
npm start
```

Open `http://127.0.0.1:4173` in current Chrome or Edge.

## Verification

Run the complete local verification before opening a pull request:

```sh
npm run verify
```

Hardware-affecting changes should also complete the checklist in
[`docs/TESTING.md`](docs/TESTING.md).

## Pull requests

Keep pull requests focused. Describe:

- the problem being solved;
- the approach taken;
- automated tests performed;
- flight controller, receiver, browser and operating system used;
- any remaining risks or limitations.

New metrics should be implemented as normalized metric providers rather than
adding transport-specific logic to the UI.
