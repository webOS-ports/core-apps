// @@@LICENSE
//
//      Copyright (c) 2026 Herman van Hazendonk <github.com@herrie.org>
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// LICENSE@@@

// A ringing alarm, end to end: its activity's time comes, activitymanager
// launches Clock (cold, or relaunching it), and the Alarm rings, then is
// dismissed or snoozed from its popup.
"use strict";

const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const {usePage, alarmRecord, popups} = require("../fixtures");

describe("Alarm", () => {
	// A cold page: prefs are loaded from the database, as on a device.
	const page = usePage({now: "2026-11-04T06:00:00", prefs: null});

	// Stores the alarms and schedules each one as Clock does.
	async function schedule(...records) {
		const env = page.env;
		env.luna.db.seed(records);
		const am = env.create({kind: "ActivityManager"});
		for (const r of records) {
			am.setAlarmTimeout(r, env.enyo.application.utilities.dateGetNext(r.hour, r.minute, r.occurs));
		}
		await env.settle();
	}

	// The alarm's time comes (now is set to it, plus late seconds).
	async function ring(key, late = 0) {
		const env = page.env;
		const a = env.luna.activities.get(key);
		const start = new env.window.Date(a.activity.schedule.start.replace(" ", "T"));
		env.setNow(new env.window.Date(start.getTime() + late * 1000));
		env.fireActivity(key);
		await env.settle();
	}

	// What the popup's Dismiss and Snooze buttons do (dashAlarm.js sendCommand).
	async function press(action, key) {
		const env = page.env;
		env.enyo.windows.setWindowParams(env.enyo.windows.getRootWindow(), {action, key});
		await env.settle();
	}

	const plays = () => page.env.audio.filter((a) => a.op === "play");
	const dbAlarm = (key) => page.env.luna.db.get("key", key);
	const scheduledAt = (key) => {
		const a = page.env.luna.activities.get(key);
		return a && a.state === "unsatisfied" ? a.activity.schedule.start : undefined;
	};

	describe("ringing", () => {
		it("plays the alarm's sound and opens its popup", async () => {
			await schedule(alarmRecord({alarmSoundFile: "/media/internal/ringtones/Birds.mp3"}));
			await ring("clockAlarm1");

			assert.deepEqual(plays().map((a) => a.src), ["file:///media/internal/ringtones/Birds.mp3"]);
			assert.equal(popups(page.env).length, 1);
			assert.equal(popups(page.env)[0].name, "com.palm.app.clock.alarm.clockAlarm1");
			assert.match(popups(page.env)[0].url, /^file:\/\/\/.*\/com\.palm\.app\.clock\/dashAlarm\.html$/);
			assert.deepEqual(popups(page.env)[0].attributes, {clickableWhenLocked: true, window: "popupalert"});
			assert.equal(popups(page.env)[0].info, "height=110");
		});

		it("keeps the screen on and listens to the power and volume keys", async () => {
			await schedule(alarmRecord());
			await ring("clockAlarm1");

			const display = page.env.luna.callsTo("luna://com.palm.display/control/setProperty");
			assert.deepEqual(display.map((c) => c.payload), [{requestBlock: true, client: "com.palm.app.clock", subscribe: true}]);
			assert.equal(page.env.luna.callsTo("luna://com.palm.keys/switches/status").length, 1);
			assert.equal(page.env.luna.callsTo("luna://com.palm.keys/audio/status").length, 1);
		});

		it("plays the default sound when the alarm names none", async () => {
			await schedule(alarmRecord({alarmSoundFile: undefined}));
			await ring("clockAlarm1");

			assert.deepEqual(plays().map((a) => a.src), ["file:///usr/palm/sounds/alert.wav"]);
		});

		it("still rings when activitymanager runs it up to two minutes late", async () => {
			await schedule(alarmRecord());
			await ring("clockAlarm1", 110);

			assert.equal(plays().length, 1);
			assert.equal(popups(page.env).length, 1);
		});

		it("does not ring later than that, and is scheduled for its next time", async () => {
			// After the device was off at alarm time, say.
			await schedule(alarmRecord());
			await ring("clockAlarm1", 600);

			assert.equal(plays().length, 0);
			assert.equal(popups(page.env).length, 0);
			assert.equal(scheduledAt("clockAlarm1"), "2026-11-05 07:05:00");
		});

		it("rings silently with the ringer switch off when sound is muted for it", async () => {
			page.env.luna.db.seed([{_kind: "com.palm.clock.prefs:1", RingerSwitchOff: "mute", SnoozeDuration: 10}]);
			page.env.luna.on("luna://com.palm.audio/system/status", () => ({returnValue: true, "ringer switch": false}));
			await schedule(alarmRecord());
			await ring("clockAlarm1");

			assert.equal(plays().length, 0);
			assert.equal(popups(page.env).length, 1);
		});

		it("plays with the ringer switch off when the prefs say to", async () => {
			page.env.luna.on("luna://com.palm.audio/system/status", () => ({returnValue: true, "ringer switch": false}));
			await schedule(alarmRecord());
			await ring("clockAlarm1");

			assert.equal(plays().length, 1);
		});
	});

	describe("switched off", () => {
		it("does not ring when its activity was left scheduled, and takes the activity off", async () => {
			// Builds before 2026-11 could not take a switched-off alarm off the
			// schedule, so devices carry such activities.
			await schedule(alarmRecord());
			page.env.luna.db.get("key", "clockAlarm1").enabled = false;
			await ring("clockAlarm1");

			assert.equal(plays().length, 0);
			assert.equal(popups(page.env).length, 0);
			assert.equal(page.env.luna.activities.get("clockAlarm1"), undefined);
			assert.equal(dbAlarm("clockAlarm1").enabled, false);
		});
	});

	describe("dismissed", () => {
		it("stops the sound, closes the popup and schedules the next day", async () => {
			await schedule(alarmRecord());
			await ring("clockAlarm1");
			await press("dismiss", "clockAlarm1");

			assert.equal(page.env.audio.at(-1).op, "pause");
			assert.equal(popups(page.env)[0].closed, true);
			assert.equal(scheduledAt("clockAlarm1"), "2026-11-05 07:05:00");
		});

		it("schedules a weekday alarm rung on Friday for Monday", async () => {
			page.env.setNow("2026-11-06T06:00:00");
			await schedule(alarmRecord({occurs: "weekdays"}));
			await ring("clockAlarm1");
			await press("dismiss", "clockAlarm1");

			assert.equal(scheduledAt("clockAlarm1"), "2026-11-09 07:05:00");
		});

		it("switches a one-time alarm off", async () => {
			await schedule(alarmRecord({occurs: "once"}));
			await ring("clockAlarm1");
			await press("dismiss", "clockAlarm1");

			assert.equal(page.env.luna.activities.get("clockAlarm1"), undefined);
			assert.equal(dbAlarm("clockAlarm1").enabled, false);
			assert.equal(popups(page.env)[0].closed, true);
		});

		it("lets the screen turn off again", async () => {
			await schedule(alarmRecord());
			await ring("clockAlarm1");
			await press("dismiss", "clockAlarm1");

			const open = page.env.luna.subscriptions.filter((s) => s.uri === "luna://com.palm.display/control/setProperty");
			assert.equal(open.length, 0);
		});
	});

	describe("snoozed", () => {
		it("stops the sound, closes the popup and rings again after the snooze time", async () => {
			page.env.luna.db.seed([{_kind: "com.palm.clock.prefs:1", RingerSwitchOff: "play", SnoozeDuration: 5}]);
			await schedule(alarmRecord());
			await ring("clockAlarm1");
			await press("snooze", "clockAlarm1");

			assert.equal(page.env.audio.at(-1).op, "pause");
			assert.equal(popups(page.env)[0].closed, true);
			assert.equal(scheduledAt("clockAlarm1"), "2026-11-04 07:10:00");
		});

		it("snoozes when a power or volume key is pressed", async () => {
			await schedule(alarmRecord());
			await ring("clockAlarm1");
			page.env.luna.push("luna://com.palm.keys/audio/status", {returnValue: true, key: "volume_up", state: "down"});
			await page.env.settle();

			assert.equal(popups(page.env)[0].closed, true);
			assert.equal(scheduledAt("clockAlarm1"), "2026-11-04 07:15:00");
		});
	});

	describe("with the app already running", () => {
		it("rings a relaunched alarm once", async () => {
			page.env.launch({});
			await page.env.settle();
			await schedule(alarmRecord());
			await ring("clockAlarm1");

			assert.equal(plays().length, 1);
			assert.equal(popups(page.env).length, 1);
		});

		it("dismisses only the alarm whose popup was used", async () => {
			await schedule(alarmRecord({key: "clockAlarm1"}), alarmRecord({key: "clockAlarm2"}));
			await ring("clockAlarm1");
			await ring("clockAlarm2");
			assert.equal(popups(page.env).length, 2);

			await press("dismiss", "clockAlarm2");

			assert.deepEqual(popups(page.env).map((p) => [p.name, p.closed]), [
				["com.palm.app.clock.alarm.clockAlarm1", false],
				["com.palm.app.clock.alarm.clockAlarm2", true]
			]);
		});
	});
});
