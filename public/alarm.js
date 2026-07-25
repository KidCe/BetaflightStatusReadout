export class AlarmEngine {
  constructor({ onAlarm, onRecovery }) {
    this.onAlarm = onAlarm;
    this.onRecovery = onRecovery;
    this.rules = new Map();
  }

  setRules(rules) {
    const previous = this.rules;
    this.rules = new Map(
      rules.map((rule) => [
        rule.id,
        {
          ...rule,
          active: previous.get(rule.id)?.active ?? false,
          pendingSince: previous.get(rule.id)?.pendingSince ?? null,
          lastAlarmAt: previous.get(rule.id)?.lastAlarmAt ?? 0,
        },
      ]),
    );
  }

  evaluate(snapshot, now = Date.now()) {
    for (const rule of this.rules.values()) {
      if (!rule.enabled) {
        rule.active = false;
        rule.pendingSince = null;
        continue;
      }

      const triggered = rule.isTriggered(snapshot, rule.active, now);
      if (!triggered) {
        if (rule.active) {
          rule.active = false;
          this.onRecovery(rule);
        }
        rule.pendingSince = null;
        continue;
      }

      if (rule.pendingSince === null) {
        rule.pendingSince = now;
      }
      if (now - rule.pendingSince < rule.minDurationMs) {
        continue;
      }

      if (!rule.active) {
        rule.active = true;
        rule.lastAlarmAt = now;
        this.onAlarm(rule);
      } else if (now - rule.lastAlarmAt >= rule.cooldownMs) {
        rule.lastAlarmAt = now;
        this.onAlarm(rule);
      }
    }
  }
}

export class AudioService {
  constructor() {
    this.context = null;
    this.enabled = false;
    this.volume = 0.65;
  }

  async enable() {
    this.context ??= new AudioContext();
    await this.context.resume();
    this.enabled = true;
  }

  setVolume(value) {
    this.volume = Math.min(1, Math.max(0, value));
  }

  play(kind = "warning") {
    if (!this.enabled || !this.context) {
      return false;
    }

    const patterns = {
      critical: [
        [0, 920, 0.16],
        [0.2, 540, 0.16],
        [0.4, 920, 0.22],
      ],
      warning: [
        [0, 760, 0.12],
        [0.18, 760, 0.12],
      ],
      disconnect: [
        [0, 880, 0.13],
        [0.15, 650, 0.15],
        [0.32, 420, 0.22],
      ],
      reconnect: [
        [0, 420, 0.11],
        [0.13, 620, 0.11],
        [0.26, 860, 0.18],
      ],
      recovery: [[0, 520, 0.1], [0.12, 720, 0.14]],
      test: [[0, 660, 0.12], [0.17, 880, 0.16]],
    };

    const start = this.context.currentTime + 0.02;
    for (const [offset, frequency, duration] of patterns[kind] ?? patterns.warning) {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type =
        kind === "critical" ? "square" : kind === "disconnect" ? "sawtooth" : "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(
        Math.max(0.0001, this.volume * 0.17),
        start + offset + 0.015,
      );
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + duration);
      oscillator.connect(gain).connect(this.context.destination);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + duration + 0.02);
    }
    return true;
  }
}
