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

// Email: what a launch starts and which card it opens. The launcher page has
// no window of its own; it opens mail, compose and emailviewer cards.
"use strict";

const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const {LUNEOS_ROOT} = require("../../../tests/harness/env");
const {usePage, imapAccount, plain} = require("../fixtures");

const needsRoot = LUNEOS_ROOT ? {} : {skip: "set LUNEOS_ROOT to a LuneOS root filesystem"};

const cards = (env) => env.windows.filter((w) => w.type === "card");
const cardNames = (env) => cards(env).map((w) => w.name);

describe("Email launch", () => {
	const page = usePage({stubWindows: true});

	it("loads accounts, then prefs, then folders, and starts its processors", async () => {
		page.env.launch({});
		await page.env.settle();

		const app = page.env.enyo.application;
		for (const part of ["accounts", "prefs", "folderProcessor", "emailProcessor", "dashboardManager"]) {
			assert.ok(app[part], part);
		}
		const prefs = page.env.luna.db.all("com.palm.app.email.prefs:1");
		assert.equal(prefs.length, 1);
		assert.equal(prefs[0].showAllInboxes, true);
		assert.equal(prefs[0].confirmDeleteOnSwipe, true);
	});

	it("asks the accounts service for MAIL templates and keeps the device's three", async () => {
		page.env.launch({});
		await page.env.settle();

		const call = page.env.luna.callsTo("luna://com.palm.service.accounts/listAccountTemplates")[0];
		assert.deepEqual(plain(call.payload), {capability: "MAIL"});
		assert.deepEqual(Object.keys(page.env.enyo.application.accounts.accountTemplates).sort(),
			["com.palm.imap", "com.palm.othermail", "com.palm.pop"]);
	});

	it("opens the mail card when there are no accounts, whatever it is launched with", async () => {
		page.env.launch({newEmail: {summary: "hi"}});
		await page.env.settle();

		assert.deepEqual(cardNames(page.env), ["mail"]);
		assert.match(cards(page.env)[0].url, /\/com\.palm\.app\.email\/+mail\/index\.html$/);
	});

	it("does nothing for a launch at boot", async () => {
		page.env.launch({launchedAtBoot: true});
		await page.env.settle();

		assert.deepEqual(page.env.windows, []);
	});

	describe("with an account", () => {
		const seed = () => page.env.luna.db.seed(imapAccount("acct1", "Work"));

		it("loads the account and makes it the default", async () => {
			seed();
			page.env.launch({});
			await page.env.settle();

			const accounts = page.env.enyo.application.accounts;
			assert.equal(accounts.getAccounts().length, 1);
			assert.equal(accounts.getAccount("acct1").getAlias(), "Work");
			assert.equal(accounts.getDefaultAccountId(), "acct1");
			assert.equal(page.env.luna.db.all("com.palm.app.email.prefs:1")[0].defaultAccountId, "acct1");
		});

		it("leaves out accounts that are being deleted or have no MAIL capability", async () => {
			seed();
			page.env.luna.db.seed(imapAccount("gone", "Gone").slice(0, 1).map((a) => Object.assign(a, {beingDeleted: true})));
			page.env.luna.db.seed([{_kind: "com.palm.account:1", _id: "cal", alias: "Calendar only", beingDeleted: false,
				templateId: "org.webosports.cdav.account", capabilityProviders: [{capability: "CALENDAR"}]}]);
			page.env.launch({});
			await page.env.settle();

			assert.deepEqual(plain(page.env.enyo.application.accounts.getAccounts().map((a) => a.getId())), ["acct1"]);
		});

		it("opens the mail card for a plain launch", async () => {
			seed();
			page.env.launch({});
			await page.env.settle();

			assert.deepEqual(cardNames(page.env), ["mail"]);
		});

		it("opens compose for a newEmail launch, passing the new email on", async () => {
			seed();
			page.env.launch({newEmail: {summary: "Hello", text: "Body"}, accountId: "acct1"});
			await page.env.settle();

			assert.deepEqual(cardNames(page.env), ["compose-0"]);
			assert.match(cards(page.env)[0].url, /\/compose\/index\.html$/);
			assert.deepEqual(plain(cards(page.env)[0].window.enyo.windowParams),
				{externalLaunchParams: {summary: "Hello", text: "Body"}, accountId: "acct1"});
		});

		it("opens compose for a mailto: target, and a new compose card each time", async () => {
			seed();
			page.env.launch({});
			await page.env.settle();
			page.env.launch({target: "mailto:someone@example.org"});
			page.env.launch({target: "MAILTO:other@example.org"});
			await page.env.settle();

			assert.deepEqual(cardNames(page.env), ["mail", "compose-0", "compose-1"]);
		});

		it("opens compose for the legacy launch API", async () => {
			seed();
			page.env.launch({recipients: [], summary: "Old style"});
			await page.env.settle();

			assert.deepEqual(cardNames(page.env), ["compose-0"]);
		});

		it("opens the email viewer for a file: target", async () => {
			seed();
			page.env.launch({target: "file:///media/internal/message.eml"});
			await page.env.settle();

			assert.deepEqual(cardNames(page.env), ["emailviewer-0"]);
			assert.match(cards(page.env)[0].url, /\/emailviewer\/index\.html$/);
		});
	});
});

describe("Email mail card", needsRoot, () => {
	// The mail card is a real page here.
	const page = usePage();
	const SET_REDIRECTS = /TypeError: this\.\$\.body\.setRedirects is not a function/;
	// Mail.checkList logs these when the mail list has no height, which in
	// jsdom (no layout) it never has.
	const NO_LAYOUT = /^(Detected 0-size list component: .*|   mailList height: 0|Scheduling recovery\.|Clearing pending recovery attempt\.)$/;
	// The page errors besides the setRedirects one (see the todo below) and
	// the layout ones.
	const otherErrors = () => page.env.errors.splice(0).filter((e) => !SET_REDIRECTS.test(e) && !NO_LAYOUT.test(e));

	it("shows an account's error in the error popup", async () => {
		page.env.luna.db.seed(imapAccount("acct1", "Work", {error: {errorCode: 43000, errorText: "Server unreachable"}}));
		page.env.luna.db.seed([{_kind: "com.palm.folder:1", _id: "acct1-inbox", accountId: "acct1", displayName: "Inbox", favorite: true}]);
		page.env.launch({});
		await page.env.settle();

		// Tap the inbox in the folder list, then the error indicator.
		const app = page.env.enyo.application;
		app.mailApp.folderChosen(null, app.folderProcessor.getFolder("acct1-inbox"));
		await page.env.settle();
		const mail = app.mailApp.$.mail;
		mail.errorClick();
		await page.env.settle();
		const popup = mail.$.folderErrorPopup;
		assert.equal(popup.getShowing(), true);
		assert.equal(popup.caption, "Error");
		assert.match(popup.items[0].components[0].content, /Server unreachable/);
		assert.deepEqual(otherErrors(), []);
	});

	it("renders with no errors", {todo: "MessageDisplay.rendered calls this.$.body.setRedirects, but body is a DivHtmlView, which has no redirects (mail/source/MessageDisplay.js:906)"}, async () => {
		page.env.luna.db.seed(imapAccount("acct1", "Work"));
		page.env.launch({});
		await page.env.settle();
		const errors = page.env.errors.splice(0);

		assert.deepEqual(errors, []);
	});
});
