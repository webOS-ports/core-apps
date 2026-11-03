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

// The Jasmine 1.x layer itself: a spec it runs passes or fails as it would
// under Jasmine.
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const {boot} = require("./env");
const {makeJasmine, equals} = require("./jasmine");

describe("Jasmine 1.x layer", () => {
	let env;
	before(() => {
		env = boot({app: "com.palm.app.clock"});
	});
	after(() => env.close());

	// Registers the specs source declares in the page; returns the run of
	// spec #i (0-based, in declaration order) as a promise.
	function specs(source) {
		const jas = makeJasmine(env.window);
		Object.assign(env.window, jas.globals);
		env.window.eval(source);
		const all = [];
		const walk = (n) => n.children.forEach((c) => (c.kind === "spec" ? all.push(c) : walk(c)));
		walk(jas.root);
		return (i) => jas.runSpec(all[i]);
	}

	it("passes a spec whose expectations hold", async () => {
		const run = specs(`describe("s", function () { it("a", function () {
			expect(1 + 1).toEqual(2); expect([1, {a: 2}]).toEqual([1, {a: 2}]); expect(null).toBeNull();
			expect(undefined).not.toBeDefined(); expect("abc").toContain("b"); expect([1, 2]).toContain(2);
			expect("abc").toMatch(/b/); expect(3).toBeGreaterThan(2); expect(NaN).toBeNaN();
			expect(function () { throw new Error("x"); }).toThrow("x");
			expect({a: 1, b: undefined}).toEqual({a: 1});
			expect(5).toEqual(jasmine.any(Number)); expect(function () {}).toEqual(jasmine.any(Function));
		}); });`);
		await run(0);
	});

	it("fails a spec with the failed expectation's message", async () => {
		const run = specs(`describe("s", function () { it("a", function () { expect(1).toEqual(2); expect(3).not.toBe(3); }); });`);
		await assert.rejects(run(0), /Expected 1 to equal 2\.\nExpected 3 not to be 3\./);
	});

	it("fails a spec that throws", async () => {
		const run = specs(`describe("s", function () { it("a", function () { null.x; }); });`);
		await assert.rejects(run(0), /Cannot read properties of null/);
	});

	it("runs beforeEach and afterEach around every spec, outer ones first, sharing this", async () => {
		env.window.order = [];
		const run = specs(`describe("o", function () {
			beforeEach(function () { order.push("bo"); this.v = 1; });
			afterEach(function () { order.push("ao"); });
			describe("i", function () {
				beforeEach(function () { order.push("bi"); this.v++; });
				afterEach(function () { order.push("ai"); });
				it("a", function () { order.push("it" + this.v); });
			});
		});`);
		await run(0);
		assert.deepEqual([...env.window.order], ["bo", "bi", "it2", "ai", "ao"]);
	});

	it("spies record calls, fake their result and are removed after the spec", async () => {
		env.window.obj = {f(x) {
			return x * 2;
		}};
		const run = specs(`describe("s", function () {
			it("a", function () {
				spyOn(obj, "f").andReturn(7);
				expect(obj.f(1)).toEqual(7); obj.f(2, 3);
				expect(obj.f).toHaveBeenCalled(); expect(obj.f).toHaveBeenCalledWith(2, 3);
				expect(obj.f.callCount).toEqual(2); expect(obj.f.mostRecentCall.args).toEqual([2, 3]);
				expect(obj.f.argsForCall[0]).toEqual([1]);
			});
			it("b", function () { spyOn(obj, "f").andCallThrough(); expect(obj.f(4)).toEqual(8); });
			it("c", function () { spyOn(obj, "f").andCallFake(function (x) { return -x; }); expect(obj.f(4)).toEqual(-4); });
		});`);
		await run(0);
		await run(1);
		await run(2);
		assert.equal(env.window.obj.f(5), 10);
		assert.equal(env.window.obj.f.isSpy, undefined);
	});

	it("runs runs/waits/waitsFor blocks in order", async () => {
		env.window.order = [];
		const run = specs(`describe("s", function () { it("a", function () {
			var done = false;
			runs(function () { order.push(1); setTimeout(function () { done = true; }, 20); });
			waitsFor(function () { return done; }, "done", 1000);
			runs(function () { order.push(2); runs(function () { order.push(3); }); });
			waits(5);
			runs(function () { order.push(4); });
		}); });`);
		await run(0);
		assert.deepEqual([...env.window.order], [1, 2, 3, 4]);
	});

	it("fails a spec whose waitsFor never comes true", async () => {
		const run = specs(`describe("s", function () { it("a", function () { waitsFor(function () { return false; }, "never", 30); }); });`);
		await assert.rejects(run(0), /timed out after 30 msec waiting for never/);
	});

	it("takes custom matchers from this.addMatchers", async () => {
		const run = specs(`describe("s", function () {
			beforeEach(function () { this.addMatchers({ toBeEven: function () { return this.actual % 2 === 0; } }); });
			it("a", function () { expect(2).toBeEven(); expect(3).not.toBeEven(); });
			it("b", function () { expect(3).toBeEven(); });
		});`);
		await run(0);
		await assert.rejects(run(1), /Expected 3 to be even\./);
	});

	it("compares structurally across realms, as Jasmine's equals does", () => {
		assert.equal(equals(env.window.eval("({a: [1, 2], d: new Date(5)})"), {a: [1, 2], d: new Date(5)}), true);
		assert.equal(equals([1], {0: 1}), false);
		assert.equal(equals({a: 1}, {a: 1, b: 2}), false);
	});
});
