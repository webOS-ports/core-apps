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

// Calendar: what a launch opens. Calendar loads MojoLoader and the Calendar
// library from /usr/palm/frameworks: needs LUNEOS_ROOT.
"use strict";

const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const {LUNEOS_ROOT} = require("../../../tests/harness/env");
const {usePage, plain} = require("../../../tests/harness/fixtures");

const needsRoot = LUNEOS_ROOT ? {} : {skip: "set LUNEOS_ROOT to a LuneOS root filesystem"};

describe("Calendar launch", needsRoot, () => {
	const page = usePage({app: "com.palm.app.calendar", now: "2026-11-03T10:00:00"});
	const main = () => page.env.windows.find((w) => w.name === "Calendar");
	const text = () => main().window.document.body.textContent.replace(/\s+/g, " ");

	it("opens its main card", async () => {
		page.env.launch({});
		await page.env.settle();

		assert.deepEqual(page.env.windows.map((w) => w.name + " " + w.type), ["Calendar card"]);
		assert.match(main().url, /\/com\.palm\.app\.calendar\/app\/calendar\.html$/);
	});

	it("shows today's day of the month on its launcher icon", async () => {
		page.env.launch({});
		await page.env.settle();

		const icon = page.env.luna.callsTo("luna://com.palm.applicationManager/updateLaunchPointIcon").pop();
		assert.deepEqual(plain(icon.payload), {icon: "images/launcher/icon-3.png", launchPointId: "com.palm.app.calendar_default"});
	});

	it("offers the device's calendar account types on first launch", async () => {
		page.env.launch({});
		await page.env.settle();

		assert.match(text(), /To get started, set up a Calendar account/);
		for (const name of ["C+DAV Connector", "Google C+DAV", "iCloud C+DAV", "Yahoo C+DAV"]) {
			assert.ok(text().includes(name), name);
		}
	});
});
