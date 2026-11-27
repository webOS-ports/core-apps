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

// The screens of each app that are laid out and checked. A view:
//
//   app          the app's directory
//   name         a short name, for the report and the screenshot
//   launch       launch params (PalmSystem.launchParams), or a function
//                giving them when the view runs
//   setup(luna)  seeds the fake bus before the app starts (tests/harness/luna.js),
//                after the profile account every device has
//   steps        JavaScript run in the card, in order, each followed by a
//                settle: how the user gets to the screen
//   needsRootfs  the app loads libraries only a LuneOS rootfs has
//
// Every app in the repository gets a "start" view, its first screen, unless
// it lists one of its own.
"use strict";

const fs = require("fs");
const path = require("path");
const templates = require("../harness/device/accountTemplates.json");

// Every LuneOS device has the local profile account; without it Accounts and
// Calendar wait on "Loading Accounts..." for good.
function profileAccount() {
	const t = templates.find((x) => x.templateId === "com.palm.palmprofile");
	return {_kind: "com.palm.account:1", _id: "profile", templateId: t.templateId, username: "user@example.org",
		alias: t.loc_name, beingDeleted: false, icon: t.icon,
		capabilityProviders: t.capabilityProviders.map((c) => ({capability: c.capability, id: c.id}))};
}

const ALARM = {_kind: "com.palm.clock.alarm:1", key: "clockAlarm1", title: "Wake up", occurs: "weekdays",
	hour: 7, minute: 0, niceTime: "7:00", niceDay: "Weekdays", enabled: true,
	alarmSoundFile: "/usr/palm/sounds/alert.wav", alarmSoundTitle: "Alert", snoozed: false, hideSnoozeTime: false};

const EXTRA = [
	{app: "com.palm.app.clock", name: "alarms", launch: {action: "alarms"}},
	{app: "com.palm.app.clock", name: "alarms-one",
		setup: (luna) => luna.db.seed([ALARM]),
		launch: {action: "alarms"}},
	{app: "com.palm.app.clock", name: "alarms-many",
		setup: (luna) => luna.db.seed(Array.from({length: 8}, (_, i) =>
			Object.assign({}, ALARM, {key: "clockAlarm" + (i + 1), title: "Alarm " + (i + 1), hour: 6 + i}))),
		launch: {action: "alarms"}},
	// The alarm going off: what the activity launches the app with, and the
	// popup alert it opens (utility/alarm.js, openPopup at 110).
	{app: "com.palm.app.clock", name: "ring",
		setup: (luna) => luna.db.seed([ALARM]),
		// set for now: the app ignores an alarm more than two minutes late
		launch: () => {
			const d = new Date(), p = (n) => String(n).padStart(2, "0");
			return {action: "ring", key: "clockAlarm1", setTime: d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" +
				p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds())};
		},
		window: "dashAlarm\\.html"},
	// More memos than any screen holds: the grid has to bring the last ones
	// into reach.
	{app: "com.palm.app.notes", name: "many",
		setup: (luna) => luna.db.seed(Array.from({length: 20}, (_, i) => ({_kind: "com.palm.note:1",
			_id: "memo" + (i + 1), color: ["yellow", "pink", "blue", "green"][i % 4], position: String.fromCharCode(97 + i),
			title: "Memo " + (i + 1), text: "Memo " + (i + 1), displayText: "Memo " + (i + 1)})))}
];

const NEEDS_ROOTFS = ["com.palm.app.calendar", "com.palm.app.contacts"];

function views(repo) {
	const apps = fs.readdirSync(repo).filter((d) => /^com\.palm\.app\./.test(d) &&
		fs.existsSync(path.join(repo, d, "appinfo.json"))).sort();
	const out = [];
	for (const app of apps) {
		const own = EXTRA.filter((v) => v.app === app);
		if (!own.some((v) => v.name === "start")) {
			out.push({app, name: "start"});
		}
		out.push(...own);
	}
	for (const v of out) {
		v.needsRootfs = v.needsRootfs || NEEDS_ROOTFS.includes(v.app);
		const own = v.setup;
		v.setup = (luna) => {
			luna.db.seed([profileAccount()]);
			if (own) {
				own(luna);
			}
		};
	}
	return out;
}

module.exports = {views};
