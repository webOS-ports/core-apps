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

const fs = require("node:fs");
const path = require("node:path");
const harness = require("../../tests/harness/fixtures");
const {boot} = require("../../tests/harness/env");

// DashboardManager logs this with enyo.error whenever there is no mail yet
// (source/DashboardManager.js beginMessageWatch), and carries on correctly.
const EMPTY_MAILBOX = "No results for beginMessageWatch";

// The index defaults of the app's email kind. mojomail never writes
// flags.visible, and every query for visible mail relies on the default.
const EMAIL_KIND = JSON.parse(fs.readFileSync(path.join(__dirname, "../configuration/db/kinds/com.palm.email"), "utf8"));

// boot() for Email, with the empty-mailbox line not counted as a page error.
function bootEmail(options = {}) {
	const env = boot(Object.assign({app: "com.palm.app.email"}, options));
	const push = env.errors.push.bind(env.errors);
	env.errors.push = (...items) => push(...items.filter((e) => e !== EMPTY_MAILBOX));
	for (const index of EMAIL_KIND.indexes) {
		for (const prop of index.props.filter((p) => "default" in p)) {
			env.luna.db.indexDefault(EMAIL_KIND.id, prop.name, prop.default);
		}
	}
	// EmailProcessor watches EmailProcessorRev, which only DB8 writes.
	for (const r of EMAIL_KIND.revSets || []) {
		env.luna.db.revSet(EMAIL_KIND.id, r.name, r.props.map((p) => p.name));
	}
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
