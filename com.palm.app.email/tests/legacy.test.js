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

// The Jasmine unit specs that came with Email, run in its launch page.
"use strict";

const {describe, it} = require("node:test");
const {legacySuite} = require("../../tests/harness/jasmine");
const {LUNEOS_ROOT} = require("../../tests/harness/env");

// The mail window loads the Contacts library from /usr/palm/frameworks.
const needsRoot = LUNEOS_ROOT ? [] : ["tests/legacy/nowindow-spec.js + tests/legacy/Mail-spec.js"];
if (needsRoot.length) {
	describe(needsRoot[0], () => {
		it("needs LUNEOS_ROOT", {skip: "set LUNEOS_ROOT to a LuneOS root filesystem"}, () => {});
	});
}

legacySuite({
	app: "com.palm.app.email",
	specs: [
		"tests/legacy/CombinedAccountLoad-spec.js",
		"tests/legacy/AccountList-spec.js",
		// Mail-spec carries on from where nowindow-spec leaves the app.
		// mockingStubs answers the launcher page's service calls from its
		// own records; the mail window is a page of its own, so the same
		// records go into the database too.
		...(needsRoot.length ? [] : [{
			file: ["tests/legacy/nowindow-spec.js", "tests/legacy/Mail-spec.js"],
			helpers: ["tests/legacy/mockingStubs.js"],
			before: (env) => {
				const db = JSON.parse(JSON.stringify(env.window.db));
				// Account records on a device always have beingDeleted, and
				// Email asks for beingDeleted = false.
				db["com.palm.account:1"].current.forEach((a) => {
					a.beingDeleted = false;
				});
				for (const kind of Object.keys(db)) {
					env.luna.db.seed(db[kind].current.map((o) => Object.assign({_kind: kind}, o)));
				}
			}
		}]),
		"tests/legacy/CardLaunch-spec.js"
	],
	skip: needsRoot.length ? {} : {
		"EmailAppLaunch sets prefs defaultAccountId":
			"reads mockingStubs' own copy of the prefs, which the app's writes over the bus do not reach; unit/launch.test.js checks the stored prefs",
		"Mail displays transport errors":
			"writes the account error into mockingStubs' own copy of the database, which the mail window does not read; unit/launch.test.js checks the error popup",
		"Mail handles account data":
			"needs the mail list to have a height, and jsdom does no layout",
		"Mail can select a single item":
			"needs the mail list to render rows, and jsdom does no layout",
		"Mail can select two items":
			"needs the mail list to render rows, and jsdom does no layout"
	},
	todo: needsRoot.length ? {} : {
		"EmailAppLaunch launches":
			"MessageDisplay.rendered calls this.$.body.setRedirects, but body is a DivHtmlView, which has no redirects (mail/source/MessageDisplay.js:906)"
	}
});
