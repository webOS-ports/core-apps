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

// Email's account wizard: which servers it asks the transports to validate
// for an address at a well-known domain. The wizard is loaded by the mail card.
"use strict";

const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const {LUNEOS_ROOT} = require("../../../tests/harness/env");
const {usePage, plain} = require("../fixtures");

const needsRoot = LUNEOS_ROOT ? {} : {skip: "set LUNEOS_ROOT to a LuneOS root filesystem"};

// A MAIL account template as listAccountTemplates returns it.
const template = (id, validator) => ({
	templateId: id,
	validator: {address: validator},
	capabilityProviders: [{capability: "MAIL", id: id + ".mail"}]
});

// The mail templates a LuneOS device has: no com.palm.google among them.
const DEVICE_TEMPLATES = [
	template("com.palm.imap", "palm://com.palm.imap/validateAccount"),
	template("com.palm.pop", "palm://com.palm.pop/validateAccount")
];

const GOOGLE_TEMPLATE = template("com.palm.google", "palm://com.palm.imap/validateGoogleAccount");

async function mailWindow(page) {
	page.env.launch({});
	await page.env.settle();
	return page.env.windows.find((w) => w.name === "mail").window;
}

// Runs the wizard's well-known-domain step and returns the validation
// requests it sent: [uri, config] for each.
async function wellKnownDomain(page, templateList, address, mxServer) {
	const win = await mailWindow(page);
	// Only the requests matter here: leave them unanswered.
	for (const transport of ["imap", "pop", "smtp"]) {
		page.env.luna.on("luna://com.palm." + transport + "/", () => undefined);
	}
	const before = page.env.luna.calls.length;
	const wizard = new win.AccountWizard({templateList});
	const domain = address.substring(address.indexOf("@") + 1);
	wizard._attemptWellKnownDomain(address, "app-password", domain, mxServer);
	const sent = page.env.luna.calls.slice(before)
		.filter((c) => /validate/.test(c.uri))
		.map((c) => [c.uri, plain(c.payload).config]);
	await page.env.settle();
	return {wizard, sent};
}

// A validation request's config. SMTP's has no domain.
const config = (server, port, email, domain) =>
	Object.assign({username: email, email, server, port, encryption: "ssl"}, domain ? {domain} : {});

describe("Email account wizard", needsRoot, () => {
	const page = usePage({stubWindows: false});

	it("validates a gmail.com address as IMAP and SMTP when there is no Google template", async () => {
		const {sent} = await wellKnownDomain(page, DEVICE_TEMPLATES, "someone@gmail.com", null);
		assert.deepEqual(sent, [
			["luna://com.palm.imap/validateAccount", config("imap.gmail.com", 993, "someone@gmail.com", "Gmail")],
			["luna://com.palm.smtp/validateAccount", config("smtp.gmail.com", 465, "someone@gmail.com", undefined)]
		]);
	});

	it("does the same for googlemail.com", async () => {
		const {sent} = await wellKnownDomain(page, DEVICE_TEMPLATES, "someone@googlemail.com", null);
		assert.deepEqual(sent.map(([uri, c]) => [uri, c.server, c.port]), [
			["luna://com.palm.imap/validateAccount", "imap.gmail.com", 993],
			["luna://com.palm.smtp/validateAccount", "smtp.gmail.com", 465]
		]);
	});

	it("finds Gmail for a Google Workspace domain from its MX server", async () => {
		const {sent} = await wellKnownDomain(page, DEVICE_TEMPLATES, "someone@example.org", "aspmx.l.google.com");
		// google.com's MX is taken as gmail.com, so only the gmail.com row matches.
		assert.deepEqual(sent.map(([uri, c]) => [uri, c.server, c.username]), [
			["luna://com.palm.imap/validateAccount", "imap.gmail.com", "someone@example.org"],
			["luna://com.palm.smtp/validateAccount", "smtp.gmail.com", "someone@example.org"]
		]);
	});

	it("keeps using a Google template's own validator when there is one", async () => {
		const {sent} = await wellKnownDomain(page, DEVICE_TEMPLATES.concat(GOOGLE_TEMPLATE), "someone@gmail.com", null);
		assert.deepEqual(sent.map(([uri]) => uri), [
			"luna://com.palm.imap/validateGoogleAccount",
			"luna://com.palm.smtp/validateAccount"
		]);
	});

	it("leaves other predefined domains alone", async () => {
		const {sent} = await wellKnownDomain(page, DEVICE_TEMPLATES, "someone@aol.com", null);
		assert.deepEqual(sent.map(([uri, c]) => [uri, c.server]), [
			["luna://com.palm.imap/validateAccount", "imap.aol.com"],
			["luna://com.palm.smtp/validateAccount", "smtp.aol.com"]
		]);
	});
});
