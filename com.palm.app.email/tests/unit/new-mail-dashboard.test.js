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

// Email: the dashboard for mail that comes in while the app runs headless.
// mojomail stores the message; EmailProcessor, watching the email kind, gives
// it an initialRev once its body is in; DashboardManager, watching for a
// higher initialRev, shows the dashboard.
"use strict";

const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const {usePage, imapAccount, plain} = require("../fixtures");

const INBOX = "acct1-inbox";

// A message as mojomail stores it: unread, in the inbox, body downloaded.
function message(id, subject, extra = {}) {
	return Object.assign({_kind: "com.palm.email:1", _id: id, folderId: INBOX, subject,
		from: {name: "Sender", addr: "sender@example.org"}, timestamp: Date.now(),
		flags: {read: false, flagged: false, replied: false},
		parts: [{type: "body", mimeType: "text/plain", path: "/tmp/" + id + ".txt"}]}, extra);
}

// With "show all inboxes" on (the default), new mail of every account goes
// to the one unified dashboard.
const UNIFIED = "-unified";
const pending = (env) => env.enyo.application.dashboardManager.pending[UNIFIED] || [];

const dashboards = (env) => env.windows.filter((w) => w.type === "dashboard" && !w.closed);

describe("Email's new-mail dashboard", () => {
	const page = usePage({stubWindows: true});

	async function startHeadless() {
		const {luna} = page.env;
		// Notifications on, without a sound, as on the Q25 (25 Nov 2026).
		luna.db.seed(imapAccount("acct1", "Work", {notifications: {enabled: true, type: "mute"}}));
		luna.db.seed([{_kind: "com.palm.folder:1", _id: INBOX, accountId: "acct1", displayName: "Inbox"}]);
		// Mail that was there before: read, and already seen by EmailProcessor.
		luna.db.seed([message("old", "Earlier", {flags: {read: true}, initialRev: 1})]);
		page.env.launch({launchedAtBoot: true});
		await page.env.settle();
		assert.deepEqual(dashboards(page.env), [], "nothing to show at boot");
	}

	// mojomail is another service: its write is not an answer to the page.
	async function arrives(msg) {
		page.env.luna.db.handle("put", {objects: [msg]});
		await page.env.settle();
	}

	it("shows a dashboard for a message that arrives after launch", async () => {
		await startHeadless();

		await arrives(message("new1", "Hello"));

		const stored = page.env.luna.db.get("_id", "new1");
		assert.ok(stored.initialRev > 0, "EmailProcessor saw the new message");
		assert.equal(pending(page.env).length, 1, "DashboardManager saw it");
		assert.equal(dashboards(page.env).length, 1);
	});

	it("keeps watching after the first message", async () => {
		await startHeadless();

		await arrives(message("new1", "Hello"));
		await arrives(message("new2", "Again"));

		assert.deepEqual(plain(pending(page.env).map((m) => m.emailId)), ["new1", "new2"]);
		assert.equal(dashboards(page.env).length, 1, "both on the one dashboard");
	});
});
