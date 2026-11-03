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

// Calculator as launched, used by tapping its buttons. (The arithmetic is
// covered by tests/legacy/CalculatorSpec.js.)
"use strict";

const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const {usePage} = require("../../../tests/harness/fixtures");

describe("Calculator", () => {
	const page = usePage({app: "com.palm.app.calculator", launch: {}});

	// The rendered element of a control of the layout on screen (the app's
	// Pane shows one of "big" and "small").
	const el = (name) => {
		const doc = page.env.window.document;
		const view = doc.getElementById("app_small").style.display === "none" ? "big" : "small";
		return doc.getElementById("app_" + view + "_" + name);
	};
	const tap = (...names) => {
		for (const n of names) {
			const node = el(n);
			assert.ok(node, "no button " + n);
			for (const type of ["mousedown", "mouseup", "click"]) {
				node.dispatchEvent(new page.env.window.MouseEvent(type, {bubbles: true, cancelable: true}));
			}
		}
	};
	const display = () => el("display").textContent;

	it("launches showing 0", () => {
		assert.equal(display(), "0");
	});

	it("shows a digit that is tapped", () => {
		tap("1");
		assert.equal(display(), "1");
	});

	it("adds what is tapped in", () => {
		tap("1", "2", "+", "3", "0", "=");
		assert.equal(display(), "42");
	});

	it("clears with C", () => {
		tap("7", "c");
		assert.equal(display(), "0");
	});
});
