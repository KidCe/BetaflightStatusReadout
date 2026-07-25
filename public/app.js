import { AlarmEngine, AudioService } from "./alarm.js";
import { MspClient, WebSerialTransport } from "./msp.js";
import { PollScheduler } from "./monitor.js";

const elements = Object.fromEntries(
  [
    "connectionBadge",
    "connectButton",
    "disconnectButton",
    "demoButton",
    "autoReconnect",
    "demoPanel",
    "rxCard",
    "rxDot",
    "rxValue",
    "rxDetail",
    "rssiCard",
    "rssiValue",
    "rssiBar",
    "rssiDetail",
    "dataCard",
    "dataValue",
    "dataDetail",
    "audioButton",
    "previewCritical",
    "previewWarning",
    "previewDisconnect",
    "previewReconnect",
    "previewRecovery",
    "volume",
    "rxlossEnabled",
    "rssiEnabled",
    "rssiThreshold",
    "rssiThresholdValue",
    "staleEnabled",
    "channelList",
    "channelCount",
    "demoRssi",
    "demoRssiValue",
    "demoRxloss",
    "eventLog",
    "clearLogButton",
    "fcInfo",
  ].map((id) => [id, document.getElementById(id)]),
);

const state = {
  mode: "idle",
  connectionStatus: "idle",
  rxLoss: null,
  failsafe: false,
  boxFailsafe: false,
  rssiRaw: null,
  rssiPercent: null,
  channels: [],
  lastStatusAt: null,
  lastAnyAt: null,
  pollErrors: 0,
  fcInfo: null,
};

let transport = null;
let client = null;
let scheduler = null;
let demoTimer = null;
let disconnectInProgress = false;
let rememberedPort = null;
let rememberedPortInfo = null;
let reconnectGeneration = 0;

const audio = new AudioService();
const alarmEngine = new AlarmEngine({
  onAlarm: (rule) => {
    const played = audio.play(rule.severity === "danger" ? "critical" : "warning");
    addEvent(rule.severity, rule.label, played ? "Alarm sound played" : "Audio is not enabled");
  },
  onRecovery: (rule) => {
    audio.play("recovery");
    addEvent("good", `${rule.label} cleared`, "Value returned to the normal range");
  },
});

function addEvent(kind, title, detail = "") {
  const item = document.createElement("li");
  item.className = "event-item";
  const time = new Date().toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  item.innerHTML = `
    <span class="event-time">${time}</span>
    <span class="event-kind ${kind}">${kind.toUpperCase()}</span>
    <span><strong>${escapeHtml(title)}</strong>${detail ? ` · ${escapeHtml(detail)}` : ""}</span>
  `;
  elements.eventLog.prepend(item);
  while (elements.eventLog.children.length > 60) {
    elements.eventLog.lastElementChild.remove();
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function resetSamples() {
  Object.assign(state, {
    rxLoss: null,
    failsafe: false,
    boxFailsafe: false,
    rssiRaw: null,
    rssiPercent: null,
    channels: [],
    lastStatusAt: null,
    lastAnyAt: null,
    pollErrors: 0,
    fcInfo: null,
  });
}

function updateRules() {
  const rssiThreshold = Number(elements.rssiThreshold.value);
  alarmEngine.setRules([
    {
      id: "rxloss",
      label: "RXLOSS",
      severity: "danger",
      enabled: elements.rxlossEnabled.checked,
      minDurationMs: 0,
      cooldownMs: 4000,
      isTriggered: (snapshot) => snapshot.rxLoss === true,
    },
    {
      id: "rssi-low",
      label: `RSSI below ${rssiThreshold}%`,
      severity: "warning",
      enabled: elements.rssiEnabled.checked,
      minDurationMs: 700,
      cooldownMs: 6000,
      isTriggered: (snapshot, active) =>
        snapshot.rssiPercent !== null &&
        snapshot.rssiPercent < rssiThreshold + (active ? 5 : 0),
    },
    {
      id: "stale",
      label: "MSP data stale",
      severity: "danger",
      enabled: elements.staleEnabled.checked && state.mode === "hardware",
      minDurationMs: 0,
      cooldownMs: 5000,
      isTriggered: (snapshot, _active, now) =>
        snapshot.lastStatusAt !== null && now - snapshot.lastStatusAt > 1200,
    },
  ]);
}

function barColor(value, warningAt) {
  if (value === null) return "#52635f";
  if (value < warningAt) return "#ff5f6d";
  if (value < warningAt + 15) return "#ffb84d";
  return "#55e09b";
}

function setBar(element, value, warningAt) {
  element.style.width = `${value ?? 0}%`;
  element.style.background = barColor(value, warningAt);
}

function render() {
  const now = Date.now();
  const isHardware = state.mode === "hardware";
  const isDemo = state.mode === "demo";
  const isConnected = isHardware && state.connectionStatus === "connected";

  elements.connectButton.hidden = isHardware;
  elements.disconnectButton.hidden = !isHardware;
  elements.demoPanel.hidden = !isDemo;
  elements.demoButton.textContent = isDemo ? "Stop demo" : "Start demo";

  elements.connectionBadge.className = "badge neutral";
  if (isConnected) {
    elements.connectionBadge.textContent = "USB connected";
    elements.connectionBadge.className = "badge good";
  } else if (state.connectionStatus === "reconnecting") {
    elements.connectionBadge.textContent = "Waiting for USB …";
    elements.connectionBadge.className = "badge warning";
  } else if (state.connectionStatus === "connecting") {
    elements.connectionBadge.textContent = "Connecting …";
  } else if (isDemo) {
    elements.connectionBadge.textContent = "Simulation";
    elements.connectionBadge.className = "badge demo";
  } else {
    elements.connectionBadge.textContent = "Disconnected";
  }

  elements.rxCard.classList.toggle("alert", state.rxLoss === true);
  elements.rxDot.className = "status-dot neutral";
  if (state.rxLoss === false) {
    elements.rxDot.className = "status-dot good";
    elements.rxValue.textContent = "Signal OK";
    elements.rxDetail.textContent = state.failsafe ? "FAILSAFE flag active" : "No RXLOSS flag";
  } else if (state.rxLoss === true) {
    elements.rxDot.className = "status-dot danger";
    elements.rxValue.textContent = "RXLOSS";
    elements.rxDetail.textContent = state.boxFailsafe
      ? "RX and BOXFAILSAFE flags active"
      : "ARMING_DISABLED_RX_FAILSAFE active";
  } else {
    elements.rxValue.textContent = "–";
    elements.rxDetail.textContent = "Waiting for flight controller";
  }

  elements.rssiValue.textContent = state.rssiPercent === null ? "–" : `${state.rssiPercent} %`;
  elements.rssiDetail.textContent =
    state.rssiRaw === null ? "Raw value 0–1023" : `Raw value ${state.rssiRaw} / 1023`;
  elements.rssiCard.classList.toggle(
    "alert",
    state.rssiPercent !== null && state.rssiPercent < Number(elements.rssiThreshold.value),
  );
  setBar(elements.rssiBar, state.rssiPercent, Number(elements.rssiThreshold.value));

  const age = state.lastStatusAt === null ? null : now - state.lastStatusAt;
  const stale = isHardware && age !== null && age > 1200;
  elements.dataCard.classList.toggle("alert", stale);
  if (isDemo) {
    elements.dataValue.textContent = "Demo";
    elements.dataDetail.textContent = "Local values, no MSP connection";
  } else if (isConnected && age !== null) {
    elements.dataValue.textContent = stale ? "STALE" : "Live";
    elements.dataDetail.textContent = `${age} ms since status · ${state.pollErrors} poll errors`;
  } else {
    elements.dataValue.textContent = "Idle";
    elements.dataDetail.textContent = "No data";
  }

  renderChannels();
  elements.fcInfo.textContent = state.fcInfo
    ? `${state.fcInfo.variant} ${state.fcInfo.version} · MSP API ${state.fcInfo.apiVersion}`
    : isDemo
      ? "Simulated flight controller"
      : "No flight controller detected";

  elements.rssiThresholdValue.value = `${elements.rssiThreshold.value} %`;
  elements.demoRssiValue.value = `${elements.demoRssi.value} %`;

  updateRules();
  alarmEngine.evaluate(state, now);
}

function renderChannels() {
  elements.channelCount.textContent = `${state.channels.length} channels`;
  if (state.channels.length === 0) {
    elements.channelList.innerHTML =
      '<p class="empty-state">Active RC channels will appear here after connecting.</p>';
    return;
  }

  elements.channelList.innerHTML = state.channels
    .slice(0, 16)
    .map((value, index) => {
      const percent = Math.min(100, Math.max(0, ((value - 900) / 1200) * 100));
      return `
        <div class="channel">
          <span>CH ${index + 1}</span>
          <div class="channel-track"><div class="channel-fill" style="width:${percent}%"></div></div>
          <span class="channel-value">${value}</span>
        </div>
      `;
    })
    .join("");
}

function onSample(sample) {
  state.lastAnyAt = sample.receivedAt;
  state.pollErrors = 0;
  switch (sample.id) {
    case "rx.status":
      Object.assign(state, sample.value);
      state.lastStatusAt = sample.receivedAt;
      break;
    case "rx.rssi":
      Object.assign(state, sample.value);
      break;
    case "rx.channels":
      state.channels = sample.value;
      break;
  }
}

async function connectHardware({ port = null, reconnecting = false, reconnectToken = null } = {}) {
  if (!reconnecting) {
    reconnectGeneration += 1;
  }
  const connectionToken = reconnecting ? reconnectToken : reconnectGeneration;
  if (state.mode === "demo" && !reconnecting) {
    stopDemo();
  }
  state.mode = "hardware";
  state.connectionStatus = reconnecting ? "reconnecting" : "connecting";
  if (!reconnecting) {
    resetSamples();
  }
  render();

  try {
    transport = new WebSerialTransport();
    transport.onDisconnect = (error) => {
      if (!disconnectInProgress) {
        void handleUnexpectedDisconnect(error);
      }
    };
    await transport.connect({ port });
    if (connectionToken !== reconnectGeneration) {
      throw new Error("Connection attempt was cancelled.");
    }
    rememberedPort = transport.port;
    rememberedPortInfo = transport.getPortInfo();
    client = new MspClient(transport);
    scheduler = new PollScheduler(client, {
      onSample,
      onError: (metricId, error) => {
        state.pollErrors += 1;
        if (state.pollErrors === 1 || state.pollErrors % 10 === 0) {
          addEvent("warning", `Polling error: ${metricId}`, error.message);
        }
      },
    });
    state.fcInfo = await scheduler.readFlightControllerInfo();
    if (connectionToken !== reconnectGeneration) {
      throw new Error("Connection attempt was cancelled.");
    }
    state.connectionStatus = "connected";
    scheduler.start();
    addEvent(
      "good",
      reconnecting ? "USB automatically reconnected" : "Flight controller connected",
      `${state.fcInfo.variant} ${state.fcInfo.version}, API ${state.fcInfo.apiVersion}`,
    );
    if (reconnecting) {
      audio.play("reconnect");
    }
  } catch (error) {
    await cleanupActiveConnection();
    if (connectionToken !== reconnectGeneration) {
      return;
    }
    if (reconnecting) {
      throw error;
    }
    addEvent("danger", "Connection failed", error.message);
    state.mode = "idle";
    state.connectionStatus = "idle";
    resetSamples();
    render();
  }
}

async function cleanupActiveConnection() {
  if (disconnectInProgress) {
    return;
  }
  disconnectInProgress = true;
  scheduler?.stop();
  client?.cancelAll();
  const activeTransport = transport;
  scheduler = null;
  client = null;
  transport = null;
  try {
    await activeTransport?.disconnect();
  } catch (error) {
    addEvent("warning", "Port could not be closed cleanly", error.message);
  }
  disconnectInProgress = false;
}

async function disconnectHardware(logEvent = true) {
  reconnectGeneration += 1;
  await cleanupActiveConnection();
  state.mode = "idle";
  state.connectionStatus = "idle";
  resetSamples();
  if (logEvent) {
    addEvent("good", "Flight controller disconnected");
  }
  render();
}

async function handleUnexpectedDisconnect(error) {
  if (disconnectInProgress || state.mode !== "hardware") {
    return;
  }
  audio.play("disconnect");
  addEvent("danger", "USB connection interrupted", error.message);
  await cleanupActiveConnection();
  resetSamples();

  if (!elements.autoReconnect.checked) {
    state.mode = "idle";
    state.connectionStatus = "idle";
    render();
    return;
  }

  state.mode = "hardware";
  state.connectionStatus = "reconnecting";
  addEvent("warning", "Auto-reconnect active", "Waiting for the same USB port");
  render();
  void reconnectLoop();
}

function portMatches(port, expected) {
  if (!expected) {
    return false;
  }
  if (expected.usbVendorId === undefined && expected.usbProductId === undefined) {
    return false;
  }
  const candidate = port.getInfo?.() ?? {};
  const vendorMatches =
    expected.usbVendorId === undefined || candidate.usbVendorId === expected.usbVendorId;
  const productMatches =
    expected.usbProductId === undefined || candidate.usbProductId === expected.usbProductId;
  return vendorMatches && productMatches;
}

async function findReconnectPort() {
  const ports = await navigator.serial.getPorts();
  if (rememberedPort && ports.includes(rememberedPort)) {
    return rememberedPort;
  }
  const matchingPort = ports.find((port) => portMatches(port, rememberedPortInfo));
  if (matchingPort) {
    return matchingPort;
  }
  return ports.length === 1 ? ports[0] : null;
}

async function reconnectLoop() {
  const generation = ++reconnectGeneration;
  let attempt = 0;
  while (
    generation === reconnectGeneration &&
    state.connectionStatus === "reconnecting" &&
    elements.autoReconnect.checked
  ) {
    await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 800 : 1500));
    if (generation !== reconnectGeneration || !elements.autoReconnect.checked) {
      return;
    }

    attempt += 1;
    try {
      const port = await findReconnectPort();
      if (!port) {
        continue;
      }
      await connectHardware({ port, reconnecting: true, reconnectToken: generation });
      return;
    } catch (error) {
      if (generation !== reconnectGeneration) {
        return;
      }
      state.mode = "hardware";
      state.connectionStatus = "reconnecting";
      if (attempt === 1 || attempt % 5 === 0) {
        addEvent("warning", `Reconnect attempt ${attempt} failed`, error.message);
      }
      render();
    }
  }
}

function startDemo() {
  if (state.mode === "hardware") {
    void disconnectHardware(false).then(startDemo);
    return;
  }
  resetSamples();
  state.mode = "demo";
  state.connectionStatus = "demo";
  state.fcInfo = { variant: "DEMO", version: "0.1", apiVersion: "1.48" };
  demoTimer = setInterval(() => {
    const now = Date.now();
    state.rssiPercent = Number(elements.demoRssi.value);
    state.rssiRaw = Math.round((state.rssiPercent / 100) * 1023);
    state.rxLoss = elements.demoRxloss.checked;
    state.lastStatusAt = now;
    state.lastAnyAt = now;
    const wave = Math.round(Math.sin(now / 700) * 420);
    state.channels = [1500 + wave, 1500 - wave, 1000, 1500, 1000, 1000, 1000, 1000];
  }, 80);
  addEvent("good", "Demo started", "RSSI and RXLOSS can be simulated");
}

function stopDemo() {
  clearInterval(demoTimer);
  demoTimer = null;
  state.mode = "idle";
  state.connectionStatus = "idle";
  resetSamples();
  addEvent("good", "Demo stopped");
}

async function enableAudio() {
  try {
    await audio.enable();
    elements.audioButton.textContent = "Audio enabled";
    elements.audioButton.className = "button primary";
    addEvent("good", "Audio enabled");
    return true;
  } catch (error) {
    addEvent("danger", "Audio could not be enabled", error.message);
    return false;
  }
}

async function previewSound(kind, label) {
  if (!audio.enabled && !(await enableAudio())) {
    return;
  }
  audio.play(kind);
  addEvent("good", "Sound preview", label);
}

elements.connectButton.addEventListener("click", () => void connectHardware());
elements.disconnectButton.addEventListener("click", () => void disconnectHardware());
elements.demoButton.addEventListener("click", () => {
  if (state.mode === "demo") {
    stopDemo();
  } else {
    startDemo();
  }
  render();
});
elements.audioButton.addEventListener("click", () => void enableAudio());
elements.previewCritical.addEventListener("click", () =>
  void previewSound("critical", "RXLOSS / MSP failure"),
);
elements.previewWarning.addEventListener("click", () =>
  void previewSound("warning", "Low RSSI"),
);
elements.previewDisconnect.addEventListener("click", () =>
  void previewSound("disconnect", "USB connection lost"),
);
elements.previewReconnect.addEventListener("click", () =>
  void previewSound("reconnect", "USB automatically reconnected"),
);
elements.previewRecovery.addEventListener("click", () =>
  void previewSound("recovery", "Value back to normal"),
);
elements.autoReconnect.addEventListener("change", () => {
  if (!elements.autoReconnect.checked && state.connectionStatus === "reconnecting") {
    reconnectGeneration += 1;
    state.mode = "idle";
    state.connectionStatus = "idle";
    resetSamples();
    addEvent("warning", "Auto-reconnect cancelled");
    render();
  }
});
elements.volume.addEventListener("input", () => audio.setVolume(Number(elements.volume.value) / 100));
elements.clearLogButton.addEventListener("click", () => {
  elements.eventLog.innerHTML = "";
});

for (const input of [
  elements.rxlossEnabled,
  elements.rssiEnabled,
  elements.rssiThreshold,
  elements.staleEnabled,
  elements.demoRssi,
  elements.demoRxloss,
]) {
  input.addEventListener("input", render);
}

window.addEventListener("beforeunload", () => {
  scheduler?.stop();
  client?.cancelAll();
  void transport?.disconnect();
});

if (!WebSerialTransport.supported) {
  elements.connectButton.disabled = true;
  elements.connectButton.title = "Chrome or Edge required";
  addEvent("warning", "Web Serial unavailable", "Open the hardware test in Chrome or Edge");
}

addEvent("good", "Pre-release ready", "Start Demo mode or connect a flight controller");
audio.setVolume(Number(elements.volume.value) / 100);
setInterval(render, 100);
render();
