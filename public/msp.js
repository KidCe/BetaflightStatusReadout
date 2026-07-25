export const MSP_CODES = Object.freeze({
  API_VERSION: 1,
  FC_VARIANT: 2,
  FC_VERSION: 3,
  RC: 105,
  ANALOG: 110,
  STATUS_EX: 150,
});

const ASCII = Object.freeze({
  DOLLAR: 36,
  M: 77,
  FROM_FC: 62,
  TO_FC: 60,
  UNSUPPORTED: 33,
});

export function encodeMspV1Request(code, payload = new Uint8Array()) {
  if (code > 254 || payload.length > 254) {
    throw new Error("This pre-release supports MSP v1 requests only.");
  }

  const frame = new Uint8Array(payload.length + 6);
  frame.set([ASCII.DOLLAR, ASCII.M, ASCII.TO_FC, payload.length, code], 0);

  let checksum = payload.length ^ code;
  payload.forEach((byte, index) => {
    frame[index + 5] = byte;
    checksum ^= byte;
  });
  frame[frame.length - 1] = checksum;
  return frame;
}

export class MspV1Parser {
  constructor(onFrame) {
    this.onFrame = onFrame;
    this.buffer = [];
    this.crcErrors = 0;
  }

  reset() {
    this.buffer = [];
    this.crcErrors = 0;
  }

  push(chunk) {
    this.buffer.push(...chunk);

    while (this.buffer.length >= 6) {
      const start = this.buffer.indexOf(ASCII.DOLLAR);
      if (start === -1) {
        this.buffer = [];
        return;
      }
      if (start > 0) {
        this.buffer.splice(0, start);
      }
      if (this.buffer.length < 6) {
        return;
      }
      if (this.buffer[1] !== ASCII.M) {
        this.buffer.shift();
        continue;
      }

      const payloadLength = this.buffer[3];
      if (payloadLength === 255) {
        this.buffer.shift();
        continue;
      }

      const frameLength = payloadLength + 6;
      if (this.buffer.length < frameLength) {
        return;
      }

      const frame = this.buffer.splice(0, frameLength);
      const direction = frame[2];
      const code = frame[4];
      const payload = new Uint8Array(frame.slice(5, 5 + payloadLength));
      let checksum = payloadLength ^ code;
      payload.forEach((byte) => {
        checksum ^= byte;
      });

      if (checksum !== frame[frame.length - 1]) {
        this.crcErrors += 1;
        continue;
      }

      this.onFrame({
        code,
        direction,
        payload,
        unsupported: direction === ASCII.UNSUPPORTED,
      });
    }
  }
}

export class MspClient {
  constructor(transport) {
    this.transport = transport;
    this.pending = new Map();
    this.parser = new MspV1Parser((frame) => this.handleFrame(frame));
    this.transport.onBytes = (bytes) => this.parser.push(bytes);
  }

  async request(code, { timeoutMs = 850 } = {}) {
    if (this.pending.has(code)) {
      throw new Error(`MSP ${code} is already in flight.`);
    }

    const response = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(code);
        reject(new Error(`MSP ${code} timed out`));
      }, timeoutMs);
      this.pending.set(code, { resolve, reject, timeoutId });
    });

    try {
      await this.transport.write(encodeMspV1Request(code));
    } catch (error) {
      const pending = this.pending.get(code);
      if (pending) {
        clearTimeout(pending.timeoutId);
        this.pending.delete(code);
        pending.reject(error);
      }
    }
    return response;
  }

  handleFrame(frame) {
    const pending = this.pending.get(frame.code);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeoutId);
    this.pending.delete(frame.code);
    if (frame.unsupported) {
      pending.reject(new Error(`MSP ${frame.code} is not supported.`));
    } else {
      pending.resolve(frame.payload);
    }
  }

  cancelAll(reason = "MSP connection ended") {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
    this.parser.reset();
  }
}

export class WebSerialTransport {
  constructor() {
    this.port = null;
    this.reader = null;
    this.readTask = null;
    this.disconnecting = false;
    this.onBytes = () => {};
    this.onDisconnect = () => {};
  }

  static get supported() {
    return "serial" in navigator;
  }

  async connect({ port = null, baudRate = 115200 } = {}) {
    if (!WebSerialTransport.supported) {
      throw new Error("Web Serial is unavailable in this browser. Use Chrome or Edge.");
    }
    this.port = port ?? (await navigator.serial.requestPort());
    await this.port.open({ baudRate });
    this.disconnecting = false;
    this.readTask = this.readLoop();
  }

  getPortInfo() {
    return this.port?.getInfo?.() ?? {};
  }

  async readLoop() {
    let disconnectError = null;
    try {
      while (this.port?.readable && !this.disconnecting) {
        this.reader = this.port.readable.getReader();
        try {
          while (!this.disconnecting) {
            const { value, done } = await this.reader.read();
            if (done) {
              return;
            }
            if (value?.length) {
              this.onBytes(value);
            }
          }
        } finally {
          this.reader.releaseLock();
          this.reader = null;
        }
      }
    } catch (error) {
      disconnectError = error;
    } finally {
      if (!this.disconnecting) {
        this.onDisconnect(disconnectError ?? new Error("The serial USB stream ended."));
      }
    }
  }

  async write(bytes) {
    if (!this.port?.writable) {
      throw new Error("The serial port is not writable.");
    }
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(bytes);
    } finally {
      writer.releaseLock();
    }
  }

  async disconnect() {
    this.disconnecting = true;
    try {
      await this.reader?.cancel();
    } catch {
      // A physical USB disconnect may already have cancelled the reader.
    }
    try {
      await this.readTask;
    } catch {
      // The UI already reports read errors through onDisconnect.
    }
    try {
      await this.port?.close();
    } finally {
      this.port = null;
      this.readTask = null;
      this.reader = null;
    }
  }
}
