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

// ActivityManager: scheduling an alarm with activitymanager and taking it off.
"use strict";

const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const {usePage, alarmRecord} = require("../fixtures");

describe("ActivityManager", () => {
	const page = usePage({now: "2026-11-03T16:00:00"});

	// An ActivityManager whose events are counted.
	function manager() {
		const events = {set: 0, clear: 0};
		const am = page.env.create({kind: "ActivityManager"});
		am.doSetAlarmTimeOut = () => events.set++;
		am.doClearAlarmTimeout = () => events.clear++;
		return {am, events};
	}

	const at = (s) => new page.env.window.Date(s);

	describe("setAlarmTimeout", () => {
		it("creates a persistent activity that launches Clock to ring the alarm", async () => {
			const {am, events} = manager();
			am.setAlarmTimeout(alarmRecord({title: "Wake"}), at("2026-11-04T07:05:00"));
			await page.env.settle();

			const calls = page.env.luna.callsTo("luna://com.palm.activitymanager/");
			assert.equal(calls.length, 1);
			assert.equal(calls[0].method, "create");
			assert.deepEqual(calls[0].payload, {
				activity: {
					name: "clockAlarm1",
					description: "com.palm.app.clock alarm: Wake",
					type: {foreground: true, persist: true},
					callback: {
						method: "palm://com.palm.applicationManager/launch",
						params: {id: "com.palm.app.clock", params: {action: "ring", key: "clockAlarm1", setTime: "2026-11-04 07:05:00"}}
					},
					schedule: {start: "2026-11-04 07:05:00", local: true}
				},
				start: true,
				replace: true
			});
			assert.equal(page.env.luna.activities.get("clockAlarm1").state, "unsatisfied");
			assert.equal(events.set, 1);
		});

		it("replaces the alarm's earlier activity", async () => {
			const {am} = manager();
			am.setAlarmTimeout(alarmRecord(), at("2026-11-04T07:05:00"));
			am.setAlarmTimeout(alarmRecord(), at("2026-11-03T16:10:00"));
			await page.env.settle();

			const scheduled = page.env.luna.activities.scheduled();
			assert.equal(scheduled.length, 1);
			assert.equal(scheduled[0].activity.schedule.start, "2026-11-03 16:10:00");
		});
	});

	describe("clearAlarmTimeout", () => {
		it("takes an alarm that has yet to ring off the schedule", async () => {
			// activitymanager will not "complete" an activity still waiting
			// for its time; Clock used that, and switched-off alarms rang.
			const {am, events} = manager();
			am.setAlarmTimeout(alarmRecord(), at("2026-11-04T07:05:00"));
			await page.env.settle();

			am.clearAlarmTimeout(alarmRecord());
			await page.env.settle();

			assert.equal(page.env.luna.activities.get("clockAlarm1"), undefined);
			assert.deepEqual(page.env.luna.calls.at(-1).payload, {activityName: "clockAlarm1"});
			assert.equal(events.clear, 1);
		});

		it("takes off an alarm that has already rung", async () => {
			const {am, events} = manager();
			am.setAlarmTimeout(alarmRecord(), at("2026-11-03T16:00:00"));
			await page.env.settle();
			page.env.luna.activities.fire("clockAlarm1");

			am.clearAlarmTimeout(alarmRecord());
			await page.env.settle();

			assert.equal(page.env.luna.activities.get("clockAlarm1"), undefined);
			assert.equal(events.clear, 1);
		});

		it("reports the alarm cleared when there was nothing to take off", async () => {
			// What follows a clear (saving the alarm, closing its popup) must
			// still happen.
			const {am, events} = manager();
			am.clearAlarmTimeout(alarmRecord({key: "clockAlarmGone"}));
			await page.env.settle();

			assert.equal(events.clear, 1);
		});

		it("leaves other alarms scheduled", async () => {
			const {am} = manager();
			am.setAlarmTimeout(alarmRecord({key: "clockAlarm1"}), at("2026-11-04T07:05:00"));
			am.setAlarmTimeout(alarmRecord({key: "clockAlarm2"}), at("2026-11-04T08:00:00"));
			await page.env.settle();

			am.clearAlarmTimeout(alarmRecord({key: "clockAlarm1"}));
			await page.env.settle();

			assert.deepEqual(page.env.luna.activities.scheduled().map((a) => a.activity.name), ["clockAlarm2"]);
		});
	});
});
