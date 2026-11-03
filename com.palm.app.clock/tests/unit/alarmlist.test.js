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

// AlarmList: an alarm's On/Off switch and deleting it.
//
// jsdom does no layout, so the list's VirtualList draws no rows to tap. The
// tests call the handlers the row's switch and swipe-delete call, with the row
// they would have been called for; everything after that is the app's.
"use strict";

const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const {usePage, alarmRecord, plain} = require("../fixtures");

describe("AlarmList", () => {
	const page = usePage({now: "2026-11-03T16:00:00"});

	// A rendered list showing the stored alarms.
	async function list(...records) {
		page.env.luna.db.seed(records);
		const l = page.env.create({kind: "AlarmList"});
		l.renderInto(page.env.window.document.body);
		l.getAlarms();
		await page.env.settle();
		return l;
	}

	// The row's switch is flipped (onchange_togEnabled is its onChange).
	async function flip(l, key, state) {
		const row = l.arAlarms.findIndex((a) => a.key === key);
		assert.ok(row >= 0, "no row for " + key);
		l.$.listAlarms.fetchRowIndex = () => row;
		l.onchange_togEnabled(l.$.togAlarmOn, state);
		await page.env.settle();
	}

	const scheduled = () => page.env.luna.activities.scheduled().map((a) => [a.activity.name, a.activity.schedule.start]);
	const stored = (key) => page.env.luna.db.get("key", key);

	it("lists the stored alarms", async () => {
		const l = await list(alarmRecord({key: "clockAlarm1"}), alarmRecord({key: "clockAlarm2"}));
		assert.deepEqual(plain(l.arAlarms.map((a) => a.key)), ["clockAlarm1", "clockAlarm2"]);
		assert.equal(l.$.lblEmpty.showing, false);
	});

	it("says there are no alarms when there are none", async () => {
		const l = await list();
		assert.equal(l.$.lblEmpty.showing, true);
	});

	describe("switching an alarm off", () => {
		it("stores it switched off and takes it off the schedule", async () => {
			const l = await list(alarmRecord({key: "clockAlarm1", enabled: true}));
			await flip(l, "clockAlarm1", true);
			assert.deepEqual(scheduled(), [["clockAlarm1", "2026-11-04 07:05:00"]]);

			await flip(l, "clockAlarm1", false);

			assert.equal(stored("clockAlarm1").enabled, false);
			assert.deepEqual(scheduled(), []);
		});

		it("does not ring it at its time afterwards", async () => {
			const l = await list(alarmRecord({key: "clockAlarm1", enabled: true}));
			await flip(l, "clockAlarm1", true);
			await flip(l, "clockAlarm1", false);

			assert.equal(page.env.luna.activities.get("clockAlarm1"), undefined, "nothing left to fire");
			assert.equal(page.env.audio.length, 0);
		});

		it("leaves the other alarms scheduled", async () => {
			const l = await list(alarmRecord({key: "clockAlarm1"}), alarmRecord({key: "clockAlarm2", hour: 9, minute: 30}));
			await flip(l, "clockAlarm1", true);
			await flip(l, "clockAlarm2", true);

			await flip(l, "clockAlarm1", false);

			assert.deepEqual(scheduled(), [["clockAlarm2", "2026-11-04 09:30:00"]]);
		});
	});

	describe("switching an alarm on", () => {
		it("stores it switched on and schedules its next time", async () => {
			const l = await list(alarmRecord({key: "clockAlarm1", enabled: false, hour: 18, minute: 0}));

			await flip(l, "clockAlarm1", true);

			assert.equal(stored("clockAlarm1").enabled, true);
			assert.deepEqual(scheduled(), [["clockAlarm1", "2026-11-03 18:00:00"]]);
		});
	});

	describe("deleting an alarm", () => {
		it("removes it and takes it off the schedule", async () => {
			const l = await list(alarmRecord({key: "clockAlarm1"}));
			await flip(l, "clockAlarm1", true);

			l.onConfirmDelete_itemAlarm(l.$.itemAlarm, 0);
			await page.env.settle();

			assert.equal(stored("clockAlarm1"), undefined);
			assert.deepEqual(scheduled(), []);
			assert.deepEqual(plain(l.arAlarms), []);
		});
	});
});
