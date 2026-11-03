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

// Tasks: what a launch stores and shows. The UI itself is covered by the
// DevTools suite in ../run.js; these run without a browser.
"use strict";

const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const {usePage, plain} = require("../../../tests/harness/fixtures");

const LIST = {_kind: "com.palm.tasklist:1", _id: "groceries", name: "Groceries", position: 2000, visible: true, order: "position", show: "all"};
const task = (id, subject, extra = {}) => Object.assign({_kind: "com.palm.task:1", _id: id, subject, notes: "", completed: false,
	completedDate: null, priority: 2, dueDate: null, taskListId: "groceries"}, extra);

// Due today, on the clock the tests run at.
const NOW = "2026-11-03T10:00:00";
const TODAY = new Date("2026-11-03T09:00:00").getTime();

describe("Tasks launch", () => {
	const page = usePage({app: "com.palm.app.tasks", now: NOW});
	const main = () => page.env.windows.find((w) => w.name === "tasks");
	const text = () => main().window.document.body.textContent.replace(/\s+/g, " ");
	const lists = () => plain(page.env.luna.db.all("com.palm.tasklist:1").map((l) => l._kind + " " + l.name)).sort();

	it("opens its main card", async () => {
		page.env.launch({});
		await page.env.settle();

		assert.deepEqual(page.env.windows.map((w) => w.name), ["tasks"]);
		assert.match(main().url, /\/com\.palm\.app\.tasks\/main\.html$/);
	});

	it("creates the Unfiled and All Tasks lists on first launch, and only then", async () => {
		page.env.launch({});
		await page.env.settle();
		page.env.launch({});
		await page.env.settle();

		assert.deepEqual(lists(), ["com.palm.tasklist.alltasks:1 List all tasks", "com.palm.tasklist.unfiled:1 Unfiled"]);
	});

	// On boot, Tasks is launched with action createDefaultTasklists; it sets
	// up its lists and activities and counts the tasks due per list.
	const BOOT = {action: "createDefaultTasklists"};

	it("on boot, schedules its activities and counts the tasks due, leaving out undated and completed ones", async () => {
		page.env.luna.db.seed([LIST,
			task("t1", "Milk", {position: 1000, dueDate: TODAY}),
			task("t2", "Bread", {position: 2000, dueDate: TODAY}),
			task("t3", "Someday", {position: 3000}),
			task("t4", "Done", {position: 4000, dueDate: TODAY, completed: true})]);
		page.env.launch(BOOT);
		await page.env.settle();

		assert.deepEqual(plain(page.env.luna.activities.scheduled().map((a) => a.activity.name)).sort(),
			["TASKS_12AM_ACTIVITY", "TASKS_DB_CHANGED_ACTIVITY", "TASKS_TIME_CHANGED_ACTIVITY"].sort());
		assert.equal(page.env.luna.db.get("_id", "groceries").dueItemCount, 2);
		assert.equal(page.env.luna.db.all("com.palm.tasklist.alltasks:1")[0].dueItemCount, 2);
		assert.deepEqual(page.env.windows.map((w) => w.type), ["dashboard"]);
	});

	it("shows the lists with their counts when opened", async () => {
		page.env.luna.db.seed([LIST, task("t1", "Milk", {position: 1000, dueDate: TODAY})]);
		page.env.launch(BOOT);
		await page.env.settle();
		page.env.launch({});
		await page.env.settle();

		assert.match(text(), /List all tasks1/);
		assert.match(text(), /Groceries1/);
	});

	it("recounts when its database activity fires, and the open card shows it", async () => {
		page.env.luna.db.seed([LIST, task("t1", "Milk", {position: 1000, dueDate: TODAY})]);
		page.env.launch(BOOT);
		await page.env.settle();
		page.env.launch({});
		await page.env.settle();

		// A sync adds a task due today.
		page.env.luna.db.seed([task("t2", "Eggs", {position: 2000, dueDate: TODAY})]);
		page.env.fireActivity("TASKS_DB_CHANGED_ACTIVITY");
		await page.env.settle();

		assert.equal(page.env.luna.db.get("_id", "groceries").dueItemCount, 2);
		assert.match(text(), /List all tasks2/);
		assert.equal(page.env.luna.activities.get("TASKS_DB_CHANGED_ACTIVITY").state, "unsatisfied", "rescheduled");
	});
});
