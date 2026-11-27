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
//   dir          where the app is on this host (filled in below)
//
// Every app in the repository gets a "start" view, its first screen, unless
// it lists one of its own. With image set, so does every Enyo web app the
// LuneOS image ships from elsewhere (the Enyo 2 apps: Memos, Calculator,
// Contacts, ...), served from the image as built.
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
	// The image's file manager lists a folder through its own service, which
	// the fake bus does not know; answered as com.palm.stark.files.service's
	// list does (files.js): {ok, path, entries: [{n, d, s, m}]}.
	{app: "com.palm.stark.files", name: "start",
		setup: (luna) => luna.on("luna://com.palm.stark.files.service/list", (p) => ({returnValue: true, ok: true,
			path: p.path, entries: ["Documents", "Downloads", "Music", "Pictures", "Videos"]
				.map((n) => ({n, d: 1, s: 0, m: Date.UTC(2026, 10, 1)}))
				.concat([{n: "notes.txt", d: 0, s: 2048, m: Date.UTC(2026, 10, 2)}])}))}
];

const NEEDS_ROOTFS = ["com.palm.app.calendar"];

// Apps LuneOS does not ship: meta-webos-ports' core-apps.bb deletes them
// from the image. org.webosports.app.memos and .calculator take the place
// of the first two, and an Enyo 2 app of the same id that of Contacts.
const NOT_SHIPPED = ["com.palm.app.notes", "com.palm.app.calculator", "com.palm.app.contacts"];

// What WebAppMgr looks for in an entry page to zoom it as a legacy app
// (wam, src/core/application_description.cc): the Enyo and Mojo apps.
const LEGACY_MARKERS = ["frameworks/mojo", "mojoloader.js", "frameworks/enyo", "enyo.js", "enyo.css",
	"enyo.min.js", "enyo.min.css", "hasownproperty(\"enyo\")", "hasownproperty('enyo')", "enyo-body-fit",
	"enyo-document-fit"];

function legacy(dir, main) {
	try {
		const head = fs.readFileSync(path.join(dir, main || "index.html")).subarray(0, 512 * 1024)
			.toString("latin1").toLowerCase();
		return LEGACY_MARKERS.some((m) => head.includes(m));
	} catch (e) {
		return false;
	}
}

// The image's Enyo web apps that are not this repository's: type "web", an
// entry page WebAppMgr takes for Enyo, and in the launcher. Those it hides
// (the system UI, an account's sign-in page, which Accounts opens with what
// it needs) are no card of their own.
function imageApps(root, own, installed) {
	const dirs = [installed, path.join(root, "usr/palm/applications")].filter(Boolean);
	const dir = (id) => dirs.map((d) => path.join(d, id)).find((d) => fs.existsSync(path.join(d, "appinfo.json")));
	const ids = new Set();
	dirs.forEach((d) => fs.readdirSync(d).forEach((id) => ids.add(id)));
	return [...ids].filter((id) => !own.includes(id)).filter((id) => {
		let info;
		try {
			info = JSON.parse(fs.readFileSync(path.join(dir(id), "appinfo.json"), "utf8"));
		} catch (e) {
			return false;
		}
		return info.type === "web" && info.visible !== false && /^index\.html?$/.test(info.main || "index.html") &&
			legacy(dir(id), info.main);
	}).sort().map((id) => ({id, dir: dir(id)}));
}

// The views to run: this repository's apps, and with image (a LuneOS rootfs)
// the image's other Enyo apps too, those in installed (a copy of a device's
// /usr/palm/applications) taken from there.
function views(repo, image, installed) {
	const own = fs.readdirSync(repo).filter((d) => /^com\.palm\.app\./.test(d) &&
		fs.existsSync(path.join(repo, d, "appinfo.json")) && !NOT_SHIPPED.includes(d)).sort();
	const apps = own.map((id) => ({id, dir: path.join(repo, id)}))
		.concat(image ? imageApps(image, own, installed) : []);
	const out = [];
	for (const {id: app, dir} of apps) {
		const mine = EXTRA.filter((v) => v.app === app);
		if (!mine.some((v) => v.name === "start")) {
			out.push({app, name: "start"});
		}
		out.push(...mine);
		for (const v of out.filter((x) => x.app === app)) {
			v.dir = dir;
			v.legacy = legacy(dir, JSON.parse(fs.readFileSync(path.join(dir, "appinfo.json"), "utf8")).main);
		}
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

// An app's id, short: the end a person types after --app.
const short = (id) => id.replace(/^(com\.palm|org\.webosports)\.app\./, "");

module.exports = {views, short, NOT_SHIPPED};
