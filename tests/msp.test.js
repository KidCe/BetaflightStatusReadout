import assert from "node:assert/strict";
import test from "node:test";

import {
  encodeMspV1Request,
  MspV1Parser,
  WebSerialTransport,
} from "../public/msp.js";

test("encodes an empty MSP v1 request", () => {
  assert.deepEqual([...encodeMspV1Request(150)], [36, 77, 60, 0, 150, 150]);
});

test("parses a response split across serial chunks", () => {
  let parsed = null;
  const parser = new MspV1Parser((frame) => {
    parsed = frame;
  });

  parser.push(new Uint8Array([36, 77, 62, 2]));
  parser.push(new Uint8Array([105, 220, 5, 178]));

  assert.equal(parsed.code, 105);
  assert.deepEqual([...parsed.payload], [220, 5]);
  assert.equal(parser.crcErrors, 0);
});

test("rejects a frame with a bad checksum", () => {
  let parsed = false;
  const parser = new MspV1Parser(() => {
    parsed = true;
  });

  parser.push(new Uint8Array([36, 77, 62, 0, 150, 0]));

  assert.equal(parsed, false);
  assert.equal(parser.crcErrors, 1);
});

test("reopens an authorized port and detects an ended stream", async () => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      serial: {
        requestPort: async () => {
          throw new Error("requestPort must not be used for reconnect");
        },
      },
    },
  });

  let opened = 0;
  let closed = 0;
  let disconnects = 0;
  const reader = {
    read: async () => ({ done: true }),
    releaseLock() {},
  };
  const rememberedPort = {
    open: async ({ baudRate }) => {
      assert.equal(baudRate, 115200);
      opened += 1;
    },
    close: async () => {
      closed += 1;
    },
    getInfo: () => ({ usbVendorId: 1155, usbProductId: 22336 }),
    readable: { getReader: () => reader },
    writable: {},
  };

  const transport = new WebSerialTransport();
  transport.onDisconnect = () => {
    disconnects += 1;
  };
  await transport.connect({ port: rememberedPort });
  await transport.readTask;

  assert.equal(transport.port, rememberedPort);
  assert.deepEqual(transport.getPortInfo(), {
    usbVendorId: 1155,
    usbProductId: 22336,
  });
  assert.equal(opened, 1);
  assert.equal(disconnects, 1);

  await transport.disconnect();
  assert.equal(closed, 1);
});
