import { MSP_CODES } from "./msp.js";

function requireLength(payload, expected, label) {
  if (payload.byteLength < expected) {
    throw new Error(`${label}: payload is too short (${payload.byteLength}/${expected}).`);
  }
}

export function decodeApiVersion(payload) {
  requireLength(payload, 3, "MSP_API_VERSION");
  return {
    protocol: payload[0],
    apiVersion: `${payload[1]}.${payload[2]}`,
  };
}

export function decodeAscii(payload, maxLength = payload.length) {
  return String.fromCharCode(...payload.slice(0, maxLength)).replace(/\0+$/, "");
}

export function decodeFcVersion(payload) {
  requireLength(payload, 3, "MSP_FC_VERSION");
  if (payload[0] < 10) {
    return `${payload[0]}.${payload[1]}.${payload[2]}`;
  }
  return decodeAscii(payload.slice(3));
}

export function decodeStatusEx(payload) {
  requireLength(payload, 17, "MSP_STATUS_EX");
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const flightModeByteCount = payload[15];
  const flagsOffset = 17 + flightModeByteCount;
  requireLength(payload, flagsOffset + 4, "MSP_STATUS_EX arming flags");

  const armingDisableFlags = view.getUint32(flagsOffset, true);
  return {
    cycleTime: view.getUint16(0, true),
    cpuLoadPercent: view.getUint16(11, true) / 10,
    armingDisableFlags,
    failsafe: (armingDisableFlags & (1 << 1)) !== 0,
    rxLoss: (armingDisableFlags & (1 << 2)) !== 0,
    boxFailsafe: (armingDisableFlags & (1 << 4)) !== 0,
  };
}

export function decodeAnalog(payload) {
  requireLength(payload, 9, "MSP_ANALOG");
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const rssiRaw = view.getUint16(3, true);
  return {
    voltage: view.getUint16(7, true) / 100,
    rssiRaw,
    rssiPercent: Math.min(100, Math.max(0, Math.round((rssiRaw / 1023) * 100))),
  };
}

export function decodeRc(payload) {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const channels = [];
  for (let offset = 0; offset + 1 < payload.byteLength; offset += 2) {
    channels.push(view.getUint16(offset, true));
  }
  return channels;
}

const METRIC_PROVIDERS = Object.freeze([
  {
    id: "rx.status",
    code: MSP_CODES.STATUS_EX,
    intervalMs: 100,
    decode: decodeStatusEx,
  },
  {
    id: "rx.rssi",
    code: MSP_CODES.ANALOG,
    intervalMs: 250,
    decode: decodeAnalog,
  },
  {
    id: "rx.channels",
    code: MSP_CODES.RC,
    intervalMs: 100,
    decode: decodeRc,
  },
]);

export class PollScheduler {
  constructor(client, { onSample, onError }) {
    this.client = client;
    this.onSample = onSample;
    this.onError = onError;
    this.running = false;
    this.providers = METRIC_PROVIDERS.map((provider) => ({ ...provider, nextAt: 0 }));
  }

  async readFlightControllerInfo() {
    const api = decodeApiVersion(await this.client.request(MSP_CODES.API_VERSION));
    const variant = decodeAscii(await this.client.request(MSP_CODES.FC_VARIANT), 4);
    const version = decodeFcVersion(await this.client.request(MSP_CODES.FC_VERSION));
    return { ...api, variant, version };
  }

  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    this.providers.forEach((provider) => {
      provider.nextAt = 0;
    });
    void this.run();
  }

  stop() {
    this.running = false;
  }

  async run() {
    while (this.running) {
      const now = performance.now();
      const provider = this.providers.reduce((next, candidate) =>
        candidate.nextAt < next.nextAt ? candidate : next,
      );
      const waitMs = provider.nextAt - now;
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 50)));
        continue;
      }

      try {
        const payload = await this.client.request(provider.code);
        const receivedAt = Date.now();
        this.onSample({
          id: provider.id,
          value: provider.decode(payload),
          receivedAt,
        });
      } catch (error) {
        if (this.running) {
          this.onError(provider.id, error);
        }
      } finally {
        provider.nextAt = performance.now() + provider.intervalMs;
      }
    }
  }
}
