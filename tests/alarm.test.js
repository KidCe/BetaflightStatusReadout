import assert from "node:assert/strict";
import test from "node:test";

import { AlarmEngine, AudioService } from "../public/alarm.js";

test("fires, repeats after cooldown and recovers", () => {
  const events = [];
  const engine = new AlarmEngine({
    onAlarm: (rule) => events.push(`alarm:${rule.id}`),
    onRecovery: (rule) => events.push(`recovery:${rule.id}`),
  });
  engine.setRules([
    {
      id: "rxloss",
      enabled: true,
      minDurationMs: 100,
      cooldownMs: 500,
      isTriggered: (snapshot) => snapshot.rxLoss,
    },
  ]);

  engine.evaluate({ rxLoss: true }, 1000);
  engine.evaluate({ rxLoss: true }, 1099);
  engine.evaluate({ rxLoss: true }, 1100);
  engine.evaluate({ rxLoss: true }, 1600);
  engine.evaluate({ rxLoss: false }, 1700);

  assert.deepEqual(events, [
    "alarm:rxloss",
    "alarm:rxloss",
    "recovery:rxloss",
  ]);
});

test("USB disconnect and reconnect sounds are distinct", () => {
  const played = [];
  const context = {
    currentTime: 10,
    destination: {},
    createGain() {
      return {
        gain: {
          setValueAtTime() {},
          exponentialRampToValueAtTime() {},
        },
        connect(target) {
          return target;
        },
      };
    },
    createOscillator() {
      const oscillator = {
        type: "sine",
        frequency: { value: 0 },
        connect(target) {
          return target;
        },
        start() {
          played.push({
            type: oscillator.type,
            frequency: oscillator.frequency.value,
          });
        },
        stop() {},
      };
      return oscillator;
    },
  };

  const audio = new AudioService();
  audio.context = context;
  audio.enabled = true;

  audio.play("disconnect");
  assert.deepEqual(
    played.map((tone) => tone.frequency),
    [880, 650, 420],
  );
  assert.ok(played.every((tone) => tone.type === "sawtooth"));

  played.length = 0;
  audio.play("reconnect");
  assert.deepEqual(
    played.map((tone) => tone.frequency),
    [420, 620, 860],
  );
  assert.ok(played.every((tone) => tone.type === "sine"));
});
