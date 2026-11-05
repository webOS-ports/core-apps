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

// Accounts: the list of accounts it shows on launch.
"use strict";

const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const {boot} = require("../../../tests/harness/env");
const {usePage} = require("../../../tests/harness/fixtures");
const templates = require("../../../tests/harness/device/accountTemplates.json");

// An account record as the accounts service stores it, with its template's
// icon and capabilities.
function account(id, templateId, username, extra = {}) {
	const t = templates.find((x) => x.templateId === templateId);
	return Object.assign({_kind: "com.palm.account:1", _id: id, templateId, username, alias: t.loc_name, beingDeleted: false,
		icon: t.icon, capabilityProviders: t.capabilityProviders.map((c) => ({capability: c.capability, id: c.id}))}, extra);
}
// Every LuneOS device has the local profile account.
const PROFILE = account("profile", "com.palm.palmprofile", "user@example.org");

const text = (control) => control.hasNode().textContent.replace(/\s+/g, " ").trim();

describe("Accounts", () => {
	const page = usePage({app: "com.palm.app.accounts"});
	const manager = () => page.env.enyo.$.accountManager;
	const launch = async (...accounts) => {
		page.env.luna.db.seed([PROFILE, ...accounts]);
		page.env.launch({});
		await page.env.settle();
	};

	it("shows the profile account's user name in the Local Account group", async () => {
		await launch();

		assert.equal(text(manager().$.palmProfileName), "user@example.org");
		assert.match(manager().$.profileIcon.src, /\/usr\/palm\/public\/accounts\/com\.palm\.palmprofile\/images\//);
	});

	it("keeps the profile editor disabled, as LuneOS has no profile service", async () => {
		await launch();

		assert.equal(page.env.luna.callsTo("luna://com.palm.accountservices/getAccountToken").length, 1);
		assert.equal(manager().$.palmProfileItem.getDisabled(), true);
	});

	it("lists the other accounts, and hides the SIM group when there is no SIM account", async () => {
		await launch(account("mail", "com.palm.imap", "me@example.org"));

		assert.match(text(manager().$.accountsList), /me@example\.org/);
		assert.doesNotMatch(text(manager().$.accountsList), /user@example\.org/);
		assert.equal(manager().$.simAccountGroup.getShowing(), false);
	});

	it("shows SIM accounts in their own group", async () => {
		await launch(account("sim", "com.palm.sim", "SIM card"));

		// A SIM account is listed by its template's name and capabilities.
		assert.equal(manager().$.simAccountGroup.getShowing(), true);
		assert.equal(text(manager().$.SIMAccountsList), "SIMContacts");
		assert.doesNotMatch(text(manager().$.accountsList), /SIM/);
	});

	// Messaging (and other apps) open Accounts with {capability, launchType: "add"} from their
	// "Add account" buttons, expecting the Add Account list rather than the accounts list.
	it("opens the Add Account list when launched to add an account", async () => {
		page.env.luna.db.seed([PROFILE]);
		page.env.launch({capability: "MESSAGING", launchType: "add"});
		await page.env.settle();

		assert.equal(manager().getViewName(), "AccountsView");
		assert.match(text(manager().$.AccountsView), /Telegram/);
	});

	it("opens the Add Account list when it is already running", async () => {
		await launch();
		assert.equal(manager().getViewName(), "prefsAndAccounts");

		page.env.launch({capability: "MESSAGING", launchType: "add"});
		await page.env.settle();

		assert.equal(manager().getViewName(), "AccountsView");
		assert.match(text(manager().$.AccountsView), /Telegram/);
	});

	it("comes back to the accounts list from an Add Account launch", async () => {
		page.env.luna.db.seed([PROFILE]);
		page.env.launch({launchType: "add"});
		await page.env.settle();

		manager().accountsDone();
		await page.env.settle();

		assert.equal(manager().getViewName(), "prefsAndAccounts");
		assert.equal(manager().$.getAccountsSpinner.getShowing(), false);
	});

	it("opens an account's settings when it is already running and asked to modify one", async () => {
		await launch(account("mail", "com.palm.imap", "me@example.org"));

		page.env.launch({launchType: "modifyAccount", accountId: "mail"});
		await page.env.settle();

		assert.equal(manager().getViewName(), "AccountsModify");
	});

	it("leaves out accounts that are being deleted", async () => {
		await launch(account("gone", "com.palm.imap", "gone@example.org", {beingDeleted: true}));

		assert.doesNotMatch(text(manager().$.accountsList), /gone@example\.org/);
	});
});

describe("Accounts without a profile account", () => {
	it("launches", {todo: "onAccountsAvailable reads palmProfileAccount.username without checking there is one (source/AccountManager.js:238); every device has one"}, async () => {
		const env = boot({app: "com.palm.app.accounts"});
		env.launch({});
		await env.settle();
		const errors = env.errors.slice();
		env.close();
		assert.deepEqual(errors, []);
	});
});
