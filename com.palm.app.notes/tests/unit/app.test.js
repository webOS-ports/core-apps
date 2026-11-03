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

// Notes: the memo grid it shows on launch, searching it, and deleting a memo.
"use strict";

const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const {usePage, plain} = require("../../../tests/harness/fixtures");

// Notes' desktop mock data (mock/find.json): two memos.
const memos = require("../../mock/find.json").results;

describe("Notes", () => {
	const page = usePage({app: "com.palm.app.notes"});
	const grid = () => page.env.window.app.appView.$.grid;
	const titles = () => plain(grid().agent.getMemos().map((m) => m.title));
	const launch = async (stored = memos) => {
		page.env.luna.db.seed(stored);
		page.env.launch({});
		await page.env.settle();
	};

	it("shows the stored memos in position order, with their count", async () => {
		// Stored out of order: positions are "m" and "g".
		await launch(memos.slice().reverse());

		assert.deepEqual(titles(), ["Test Note 1", "Test Note 2"]);
		assert.equal(grid().$.memoCount.getContent(), "2 memos");
		assert.equal(grid().$.edit.getDisabled(), false);
	});

	it("says so, and disables editing, when there are no memos", async () => {
		await launch([]);

		assert.deepEqual(titles(), []);
		assert.equal(grid().$.memoCount.getContent(), "no memos");
		assert.equal(grid().$.edit.getDisabled(), true);
	});

	it("searches the memos' text, and highlights what matched", async () => {
		await launch();
		grid().agent.populateGrid("note 2");
		await page.env.settle();

		const search = page.env.luna.callsTo("luna://com.palm.db/search")[0];
		assert.deepEqual(plain(search.payload.query.where), [{prop: "text", op: "?", val: "note 2", collate: "primary", tokenize: "all"}]);
		assert.deepEqual(titles(), ["Test Note 2"]);
		assert.equal(grid().$.memoCount.getContent(), "1 search result");
		assert.equal(grid().agent.getMemos()[0].displayText, 'Test <span class="string-highlight">Note 2</span> for use on desktop');
	});

	it("escapes HTML in a memo's text and title", async () => {
		await launch([Object.assign({}, memos[0], {text: "<b>bold</b>", title: "<b>bold</b>"})]);

		assert.equal(grid().agent.getMemos()[0].title, "&lt;b&gt;bold&lt;/b&gt;");
	});

	it("deletes a memo from the database and the grid once the delete is confirmed", async () => {
		await launch();
		grid().deleteMemo(null, grid().agent.getMemos()[0]);
		grid().$.confirmDeletePopup.agent.deleteMemo();
		await page.env.settle();

		assert.deepEqual(plain(page.env.luna.db.all("com.palm.note:1").map((m) => m.title)), ["Test Note 2"]);
		assert.deepEqual(titles(), ["Test Note 2"]);
	});
});
