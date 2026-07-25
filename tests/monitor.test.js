import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeAnalog,
  decodeApiVersion,
  decodeRc,
  decodeStatusEx,
} from "../public/monitor.js";

test("decodes API version", () => {
  assert.deepEqual(decodeApiVersion(new Uint8Array([0, 1, 48])), {
    protocol: 0,
    apiVersion: "1.48",
  });
});

test("decodes RXLOSS and FAILSAFE flags with variable flight-mode bytes", () => {
  const payload = new Uint8Array(23);
  payload[15] = 2;
  payload[16] = 0xaa;
  payload[17] = 0x55;
  payload[18] = 32;
  new DataView(payload.buffer).setUint32(19, (1 << 1) | (1 << 2), true);

  const result = decodeStatusEx(payload);

  assert.equal(result.rxLoss, true);
  assert.equal(result.failsafe, true);
  assert.equal(result.boxFailsafe, false);
});

test("normalizes RSSI and reads voltage", () => {
  const payload = new Uint8Array(9);
  const view = new DataView(payload.buffer);
  view.setUint16(3, 512, true);
  view.setUint16(7, 1675, true);

  assert.deepEqual(decodeAnalog(payload), {
    voltage: 16.75,
    rssiRaw: 512,
    rssiPercent: 50,
  });
});

test("decodes RC channels", () => {
  assert.deepEqual(decodeRc(new Uint8Array([220, 5, 232, 3])), [1500, 1000]);
});
