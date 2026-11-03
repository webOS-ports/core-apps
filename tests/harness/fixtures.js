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

// Helpers shared by every app's tests.
"use strict";

const assert = require("node:assert/strict");
const {beforeEach, afterEach} = require("node:test");
const {boot} = require("./env");

// Boots a fresh page before each test of the enclosing describe() and closes
// it after. A test fails if the page logged an error or threw. options is
// boot()'s, or a function returning them; bootFn replaces boot (an app's own
// setup around it). Returns an object whose .env is the current page.
function usePage(options, bootFn = boot) {
	const holder = {env: null};
	beforeEach(() => {
		holder.env = bootFn(typeof options === "function" ? options() : options);
	});
	afterEach(() => {
		const errors = holder.env.errors.slice();
		holder.env.close();
		assert.deepEqual(errors, [], "the page reported errors");
	});
	return holder;
}

// The local time a Date shows, as "YYYY-MM-DD HH:MM:SS" (the format
// activitymanager schedules are written in).
function local(d) {
	const p = (n) => String(n).padStart(2, "0");
	return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " +
		p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
}

// A copy of a value made in the page, comparable with deepEqual (the page's
// objects have the page's Object.prototype, not this realm's).
function plain(v) {
	return JSON.parse(JSON.stringify(v));
}

module.exports = {usePage, local, plain};
