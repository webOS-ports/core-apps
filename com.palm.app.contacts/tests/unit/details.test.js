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

// Contacts: the app loads, and its details view shows a stored person. The
// Contacts library comes from /usr/palm/frameworks: needs LUNEOS_ROOT.
"use strict";

const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const {boot, LUNEOS_ROOT} = require("../../../tests/harness/env");

const people = require("../../mock/contactsApp_splitPane_contacts_list_getPersons.json").results;
const needsRoot = LUNEOS_ROOT ? {} : {skip: "set LUNEOS_ROOT to a LuneOS root filesystem"};

// Script files depends.js names that are not in the tree. Loading Contacts
// reports them, as a device's console does.
const MISSING = ["app/Ringtones.js", "app/dialogs/NameDetails.js"];

describe("Contacts", needsRoot, () => {
	it("loads every script its depends.js names", {todo: MISSING.join(" and ") + " are missing"}, async () => {
		const env = boot({app: "com.palm.app.contacts", launch: {}});
		await env.settle();
		const errors = env.errors.slice();
		env.close();
		assert.deepEqual(errors, []);
	});

	it("launches with no errors besides the missing scripts", async () => {
		const env = boot({app: "com.palm.app.contacts", launch: {}});
		env.luna.db.seed(people);
		await env.settle();
		const errors = env.errors.filter((e) => !MISSING.some((m) => e === "Error loading script " + env.app + "/" + m));
		env.close();
		assert.deepEqual(errors, []);
	});

	it("loads, shows and watches the person whose id the details view is given", async () => {
		const env = boot({app: "com.palm.app.contacts"});
		env.luna.db.seed(people);
		const details = env.create({kind: "pseudoDetailsInApp"});
		details.renderInto(env.window.document.body);

		details.setPersonId("++HLXsjI6hw0gHm7");
		await env.settle();

		assert.equal(details.currentPersonLoadedId, "++HLXsjI6hw0gHm7");
		assert.equal(details.personWatch, true);
		assert.equal(details.$.AllDetails.getShowing(), true);
		const watch = env.luna.callsTo("luna://com.palm.db/find").find((c) => c.payload.watch);
		assert.deepEqual(watch.payload.query.where, [{prop: "_id", op: "=", val: "++HLXsjI6hw0gHm7"}]);
		env.close();
	});

	it("shows the 'select a contact' screen when given no person", async () => {
		const env = boot({app: "com.palm.app.contacts"});
		const details = env.create({kind: "pseudoDetailsInApp"});
		details.renderInto(env.window.document.body);

		details.setPersonId("++HLXsjI6hw0gHm7");
		await env.settle();
		details.setPersonId(null);
		await env.settle();

		assert.equal(details.$.SelectAContact.getShowing(), true);
		assert.equal(details.$.AllDetails.getShowing(), false);
		env.close();
	});
});
