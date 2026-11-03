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

// Clock's test setup on top of the shared harness (tests/harness).
"use strict";

const {boot} = require("../../tests/harness/env");
const shared = require("../../tests/harness/fixtures");

// Boots Clock's index.html. Components tested on their own expect what
// ClockApp sets up at startup: enyo.application.utilities, and the prefs
// (options.prefs, merged into the defaults). prefs: null leaves them to be
// loaded from the database, as a cold launch does.
function bootClock(options = {}) {
	const env = boot(Object.assign({app: "com.palm.app.clock"}, options));
	const app = env.enyo.application;
	if (!app.utilities) {
		app.utilities = new env.window.Utilities();
	}
	if (options.prefs !== null) {
		app.prefs = Object.assign({RingerSwitchOff: "play", SnoozeDuration: 10}, options.prefs);
	}
	// What a device answered (mindphone, 2026-11-03).
	env.luna.on("luna://com.palm.audio/system/status", () =>
		({returnValue: true, action: "changed", muted: false, "ringer switch": true, volume: 100}));
	return env;
}

// A fresh Clock page for each test; see the shared usePage().
function usePage(options) {
	return shared.usePage(options, bootClock);
}

// An alarm record as AlarmDbManager stores it.
function alarmRecord(overrides) {
	return Object.assign({
		_kind: "com.palm.clock.alarm:1",
		key: "clockAlarm1",
		title: "Alarm",
		occurs: "daily",
		hour: 7,
		minute: 5,
		enabled: true,
		alarmSoundFile: "/usr/palm/sounds/alert.wav",
		alarmSoundTitle: "Alert",
		snoozed: false,
		hideSnoozeTime: false
	}, overrides);
}

// The ringing-alarm popups the app opened.
function popups(env) {
	return env.windows.filter((w) => w.type === "popupalert");
}

module.exports = {bootClock, usePage, alarmRecord, popups, local: shared.local, plain: shared.plain};
