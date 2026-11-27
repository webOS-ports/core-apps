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

// ClockApp: what a launch of Clock opens.
"use strict";

const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const {usePage, alarmRecord, popups} = require("../fixtures");

describe("ClockApp", () => {
	const page = usePage({now: "2026-11-03T16:00:00", prefs: null});
	const cards = () => page.env.windows.filter((w) => w.type === "card");

	it("opens the main window when launched from the launcher", async () => {
		page.env.launch({});
		await page.env.settle();

		assert.deepEqual(cards().map((w) => w.name), ["com.palm.app.clock.main"]);
		assert.match(cards()[0].url, /\/com\.palm\.app\.clock\/main\.html$/);
		assert.equal(popups(page.env).length, 0);
	});

	it("stores default prefs on first launch", async () => {
		page.env.launch({});
		await page.env.settle();

		const prefs = page.env.luna.db.all("com.palm.clock.prefs:1");
		assert.equal(prefs.length, 1);
		assert.equal(prefs[0].RingerSwitchOff, "play");
		assert.equal(prefs[0].SnoozeDuration, 10);
	});

	it("uses the stored prefs when there are some", async () => {
		page.env.luna.db.seed([{_kind: "com.palm.clock.prefs:1", RingerSwitchOff: "mute", SnoozeDuration: 20}]);
		page.env.launch({});
		await page.env.settle();

		assert.equal(page.env.luna.db.all("com.palm.clock.prefs:1").length, 1);
		assert.equal(page.env.enyo.application.prefs.SnoozeDuration, 20);
	});

	it("only rings, without opening the main window, when launched by an alarm", async () => {
		page.env.luna.db.seed([alarmRecord()]);
		page.env.launch({action: "ring", key: "clockAlarm1", setTime: "2026-11-03 16:00:00"});
		await page.env.settle();

		assert.equal(popups(page.env).length, 1);
		assert.deepEqual(cards(), []);
	});

	// What the app asked Enyo's window manager to bring up, by window name.
	function spyActivations() {
		const names = [], w = page.env.enyo.windows, activate = w.activate;
		w.activate = function (url, name) {
			names.push(name);
			return activate.apply(this, arguments);
		};
		return names;
	}

	// A launch is handled once, not again when the prefs it reloads come in.
	// Handled twice, it activated the main window twice in a row, and on a
	// device, where Enyo knows a window by name only once its page has loaded,
	// that opened two main cards.
	it("activates the main window once when relaunched while running", async () => {
		page.env.launch({});
		await page.env.settle();
		const activated = spyActivations();
		page.env.launch({});
		await page.env.settle();

		assert.deepEqual(activated, ["com.palm.app.clock.main"]);
	});

	it("only rings, without bringing up the main window, when an alarm rings while it runs", async () => {
		page.env.luna.db.seed([alarmRecord()]);
		page.env.launch({action: "update"});
		await page.env.settle();
		const activated = spyActivations();
		page.env.launch({action: "ring", key: "clockAlarm1", setTime: "2026-11-03 16:00:00"});
		await page.env.settle();

		assert.equal(popups(page.env).length, 1);
		assert.equal(activated.includes("com.palm.app.clock.main"), false);
	});

	it("ignores an 'update' launch", async () => {
		page.env.launch({action: "update"});
		await page.env.settle();

		assert.deepEqual(page.env.windows, []);
	});
});
