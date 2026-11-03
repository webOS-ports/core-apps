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

// AlarmEdit: the dialog for a new alarm or an existing one, used by tapping
// its controls.
"use strict";

const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const {usePage, alarmRecord} = require("../fixtures");

describe("AlarmEdit", () => {
	const page = usePage({now: "2026-11-03T16:00:00"});

	// A rendered dialog, with its Done event counted.
	function dialog() {
		const e = page.env.create({kind: "AlarmEdit"});
		e.renderInto(page.env.window.document.body);
		e.done = 0;
		e.doDone = () => e.done++;
		return e;
	}

	const scheduled = () => page.env.luna.activities.scheduled().map((a) => [a.activity.name, a.activity.schedule.start]);
	const stored = (key) => page.env.luna.db.get("key", key);
	const at = (h, m) => new page.env.window.Date(1990, 1, 1, h, m, 0, 0);

	describe("an existing alarm", () => {
		it("shows the stored alarm", async () => {
			page.env.luna.db.seed([alarmRecord({title: "Gym", occurs: "weekdays", hour: 6, minute: 30, alarmSoundTitle: "Birds"})]);
			const e = dialog();
			e.editAlarm("clockAlarm1");
			await page.env.settle();

			assert.equal(e.$.togEnabled.getState(), true);
			assert.equal(e.$.txtTitle.getValue(), "Gym");
			assert.equal(e.$.lselOccurs.getValue(), "weekdays");
			assert.equal(e.$.tmpickAlarm.getValue().getHours(), 6);
			assert.equal(e.$.tmpickAlarm.getValue().getMinutes(), 30);
			assert.equal(e.$.lblSound.getContent(), "Birds");
		});

		it("switched off and saved, is stored off and taken off the schedule", async () => {
			page.env.luna.db.seed([alarmRecord()]);
			page.env.create({kind: "ActivityManager"}).setAlarmTimeout(alarmRecord(), page.env.enyo.application.utilities.dateGetNext(7, 5, "daily"));
			const e = dialog();
			e.editAlarm("clockAlarm1");
			await page.env.settle();
			assert.equal(scheduled().length, 1);

			page.env.tap(e.$.togEnabled);
			page.env.tap(e.$.btnDone);
			await page.env.settle();

			assert.equal(stored("clockAlarm1").enabled, false);
			assert.deepEqual(scheduled(), []);
			assert.equal(e.done, 1);
		});

		it("given a new time and saved, is stored and scheduled for it", async () => {
			page.env.luna.db.seed([alarmRecord()]);
			const e = dialog();
			e.editAlarm("clockAlarm1");
			await page.env.settle();

			e.$.tmpickAlarm.setValue(at(17, 45));
			page.env.tap(e.$.btnDone);
			await page.env.settle();

			assert.equal(stored("clockAlarm1").hour, 17);
			assert.equal(stored("clockAlarm1").minute, 45);
			assert.deepEqual(scheduled(), [["clockAlarm1", "2026-11-03 17:45:00"]]);
		});
	});

	describe("a new alarm", () => {
		it("is stored and scheduled when saved", async () => {
			const e = dialog();
			e.newAlarm();
			e.$.txtTitle.setValue("Tea");
			e.$.tmpickAlarm.setValue(at(16, 30));
			page.env.tap(e.$.btnDone);
			await page.env.settle();

			const all = page.env.luna.db.all("com.palm.clock.alarm:1");
			assert.equal(all.length, 1);
			assert.equal(all[0].title, "Tea");
			assert.equal(all[0].enabled, true);
			assert.match(all[0].key, /^clockAlarm\d+$/);
			assert.deepEqual(scheduled(), [[all[0].key, "2026-11-03 16:30:00"]]);
			assert.equal(e.done, 1);
		});

		it("is stored but not scheduled when saved switched off", async () => {
			const e = dialog();
			e.newAlarm();
			page.env.tap(e.$.togEnabled);
			page.env.tap(e.$.btnDone);
			await page.env.settle();

			assert.equal(page.env.luna.db.all("com.palm.clock.alarm:1")[0].enabled, false);
			assert.deepEqual(scheduled(), []);
		});
	});
});
