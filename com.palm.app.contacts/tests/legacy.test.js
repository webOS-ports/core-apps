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

// The Jasmine specs that came with Contacts, run in its page. Contacts loads
// MojoLoader and the Contacts library from /usr/palm/frameworks, so these
// need LUNEOS_ROOT.
"use strict";

const {describe, it} = require("node:test");
const {legacySuite} = require("../../tests/harness/jasmine");
const {LUNEOS_ROOT} = require("../../tests/harness/env");

if (!LUNEOS_ROOT) {
	describe("Contacts legacy specs", () => {
		it("need LUNEOS_ROOT", {skip: "set LUNEOS_ROOT to a LuneOS root filesystem"}, () => {});
	});
} else {
	// The people of Contacts' desktop mock data (mock/), stored in the
	// database the Contacts library reads.
	const people = require("../mock/contactsApp_splitPane_contacts_list_getPersons.json").results;

	legacySuite({
		app: "com.palm.app.contacts",
		before: (env) => env.luna.db.seed(people),
		specs: [
			"tests/legacy/EditableGroup_spec.js",
			"tests/legacy/PseudoDetailsInApp_spec.js",
			"tests/legacy/SwipeableFancyInput_spec.js",
			"tests/legacy/BirthdayPicker_spec.js",
			"tests/legacy/editableField_spec.js",
			"tests/legacy/linkDetails_spec.js",
			"tests/legacy/TransactionManager_spec.js",
			"tests/legacy/ContactsAppSpecs.js"
		],
		skip: {
			"EditableField Render Editable Field Items":
				"its expectations run in a callback after the spec has ended (never checked under Jasmine), and expect edit.person, which nothing sets",
			"EditableField Update Editable Field Items":
				"its expectations run in a callback after the spec has ended (never checked under Jasmine), and expect edit.person, which nothing sets",
			"LinkDetails TapLinkedContactWithMoreThanOneContact":
				"its expectations run in a callback after the spec has ended (never checked under Jasmine)"
		}
	});
}
