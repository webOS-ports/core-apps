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

// Email's test setup.
"use strict";

const harness = require("../../tests/harness/fixtures");
const {boot} = require("../../tests/harness/env");

// DashboardManager logs this with enyo.error whenever there is no mail yet
// (source/DashboardManager.js beginMessageWatch), and carries on correctly.
const EMPTY_MAILBOX = "No results for beginMessageWatch";

// boot() for Email, with the empty-mailbox line not counted as a page error.
function bootEmail(options = {}) {
	const env = boot(Object.assign({app: "com.palm.app.email"}, options));
	const push = env.errors.push.bind(env.errors);
	env.errors.push = (...items) => push(...items.filter((e) => e !== EMPTY_MAILBOX));
	return env;
}

const usePage = (options) => harness.usePage(options, bootEmail);

// An IMAP account as the accounts service stores it, and its mail settings.
function imapAccount(id, alias, mailAccount = {}) {
	return [
		{_kind: "com.palm.account:1", _id: id, alias, username: id + "@example.org", templateId: "com.palm.imap",
			beingDeleted: false, capabilityProviders: [{_id: id + "-mail", capability: "MAIL", id: "com.palm.imap.mail"}]},
		Object.assign({_kind: "com.palm.mail.account:1", accountId: id, inboxFolderId: id + "-inbox"}, mailAccount)
	];
}

module.exports = {bootEmail, usePage, imapAccount, plain: harness.plain};
