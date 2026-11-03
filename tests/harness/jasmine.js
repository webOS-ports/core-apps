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

// Runs the apps' old Jasmine 1.x specs under node:test, unchanged, inside the
// app's real page (env.js). The specs see the Jasmine 1.x API as globals of
// the page -- describe/it/xit/beforeEach/afterEach, expect() with its
// matchers and .not, spyOn() and jasmine.createSpy() with
// andReturn/andCallFake/andCallThrough/andThrow, runs/waits/waitsFor,
// this.addMatchers -- and each it() becomes a node:test test.
//
// As under Jasmine's own runner, a spec file shares one page: its specs run
// in order, and what one leaves behind the next sees.
"use strict";

const nodeTest = require("node:test");
const {boot} = require("./env");

// Structural equality as Jasmine 1.x has it (env.equals_), across the page's
// realm and this one: undefined properties count as missing, jasmine.any()
// matches by type.
function equals(a, b, seen = []) {
	if (a && a.__jasmineAny) {
		return a.matches(b);
	}
	if (b && b.__jasmineAny) {
		return b.matches(a);
	}
	if (a === b) {
		return true;
	}
	if (a === null || b === null || a === undefined || b === undefined) {
		return false;
	}
	const ta = Object.prototype.toString.call(a), tb = Object.prototype.toString.call(b);
	if (ta !== tb) {
		return false;
	}
	if (ta === "[object Date]") {
		return a.getTime() === b.getTime();
	}
	if (ta === "[object RegExp]") {
		return a.source === b.source && a.flags === b.flags;
	}
	if (ta === "[object Number]" || ta === "[object String]" || ta === "[object Boolean]") {
		return typeof a === "object" || typeof b === "object" ? a.valueOf() === b.valueOf() : false;
	}
	if (typeof a !== "object" || typeof b !== "object") {
		return false;
	}
	if (a.nodeType && b.nodeType) {
		return a.isEqualNode(b);
	}
	if (seen.some(([x, y]) => x === a && y === b)) {
		return true;
	}
	seen.push([a, b]);
	if (ta === "[object Array]" && a.length !== b.length) {
		return false;
	}
	const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
	for (const k of keys) {
		if (a[k] === undefined && b[k] === undefined) {
			continue;
		}
		if (!(k in a) && b[k] !== undefined || !(k in b) && a[k] !== undefined) {
			return false;
		}
		if (!equals(a[k], b[k], seen)) {
			return false;
		}
	}
	return true;
}

function pp(v) {
	try {
		if (typeof v === "function") {
			return "Function";
		}
		if (v && v.__jasmineAny) {
			return "<jasmine.any(" + (v.ctor.name || v.ctor) + ")>";
		}
		if (v && v.isSpy) {
			return "spy on " + v.identity;
		}
		const s = JSON.stringify(v, (k, x) => x === undefined ? "undefined" : typeof x === "function" ? "Function" : x);
		return s === undefined ? String(v) : s.length > 300 ? s.slice(0, 300) + "..." : s;
	} catch (e) {
		return String(v);
	}
}

// The Jasmine 1.x globals for one page; specs register into a tree.
function makeJasmine(win) {
	const root = {name: "", children: [], before: [], after: [], parent: null};
	const fileSpies = [];
	let current = root;
	let spec = null; // the running spec: {failures, queue, spies, ctx, matchers}

	const fail = (msg) => {
		if (!spec) {
			throw new Error("expectation outside a spec: " + msg);
		}
		spec.failures.push(msg);
	};

	function createSpy(name, original, object) {
		let impl = null;
		const spy = function (...args) {
			spy.wasCalled = true;
			spy.callCount++;
			const call = {object: this, args};
			spy.calls.push(call);
			spy.argsForCall.push(args);
			spy.mostRecentCall = call;
			if (impl) {
				return impl.apply(this, args);
			}
			return undefined;
		};
		Object.assign(spy, {
			isSpy: true,
			identity: name || "unknown",
			originalValue: original,
			wasCalled: false,
			callCount: 0,
			calls: [],
			argsForCall: [],
			mostRecentCall: {},
			andReturn(v) {
				impl = () => v;
				return spy;
			},
			andCallFake(fn) {
				impl = fn;
				return spy;
			},
			andCallThrough() {
				impl = function (...args) {
					return original.apply(this, args);
				};
				return spy;
			},
			andThrow(e) {
				impl = () => {
					throw e;
				};
				return spy;
			},
			reset() {
				spy.wasCalled = false;
				spy.callCount = 0;
				spy.calls = [];
				spy.argsForCall = [];
				spy.mostRecentCall = {};
			}
		});
		return spy;
	}

	const matchers = {
		toEqual(e) {
			return equals(this.actual, e);
		},
		toNotEqual(e) {
			return !equals(this.actual, e);
		},
		toBe(e) {
			return this.actual === e;
		},
		toNotBe(e) {
			return this.actual !== e;
		},
		toBeTruthy() {
			return !!this.actual;
		},
		toBeFalsy() {
			return !this.actual;
		},
		toBeDefined() {
			return this.actual !== undefined;
		},
		toBeUndefined() {
			return this.actual === undefined;
		},
		toBeNull() {
			return this.actual === null;
		},
		toBeNaN() {
			return this.actual !== this.actual;
		},
		toContain(e) {
			const a = this.actual;
			if (typeof a === "string") {
				return a.indexOf(e) >= 0;
			}
			return Array.prototype.some.call(a || [], (x) => equals(x, e));
		},
		toNotContain(e) {
			return !matchers.toContain.call(this, e);
		},
		toMatch(e) {
			return new RegExp(e).test(this.actual);
		},
		toNotMatch(e) {
			return !new RegExp(e).test(this.actual);
		},
		toBeGreaterThan(e) {
			return this.actual > e;
		},
		toBeLessThan(e) {
			return this.actual < e;
		},
		toBeCloseTo(e, precision = 2) {
			return Math.abs(e - this.actual) < Math.pow(10, -precision) / 2;
		},
		toThrow(e) {
			let threw = false, err;
			try {
				this.actual();
			} catch (x) {
				threw = true;
				err = x;
			}
			if (!threw || e === undefined) {
				return threw;
			}
			const msg = err && err.message !== undefined ? err.message : err;
			return equals(msg, e && e.message !== undefined ? e.message : e);
		},
		toHaveBeenCalled() {
			return this.actual.wasCalled;
		},
		wasCalled() {
			return this.actual.wasCalled;
		},
		wasNotCalled() {
			return !this.actual.wasCalled;
		},
		toHaveBeenCalledWith(...args) {
			return this.actual.argsForCall.some((a) => equals(a, args));
		},
		wasCalledWith(...args) {
			return matchers.toHaveBeenCalledWith.apply(this, args);
		},
		wasNotCalledWith(...args) {
			return !matchers.toHaveBeenCalledWith.apply(this, args);
		}
	};

	function expect(actual) {
		const all = Object.assign({}, matchers, spec ? spec.matchers : {});
		const make = (negate) => {
			const out = {actual};
			for (const [name, fn] of Object.entries(all)) {
				out[name] = function (...args) {
					const ctx = {actual, isNot: negate, env: jasmine.getEnv(), message: null};
					const pass = !!fn.apply(ctx, args);
					if (pass === negate) {
						let msg = ctx.message;
						if (typeof msg === "function") {
							msg = msg();
						}
						if (Array.isArray(msg)) {
							msg = msg[negate ? 1 : 0];
						}
						fail(msg || "Expected " + pp(ctx.actual) + (negate ? " not " : " ") +
							name.replace(/[A-Z]/g, (c) => " " + c.toLowerCase()) + (args.length ? " " + args.map(pp).join(", ") : "") + ".");
					}
				};
			}
			return out;
		};
		const e = make(false);
		e.not = make(true);
		return e;
	}

	const env = {
		equals_: (a, b) => equals(a, b),
		reporter: {log() {}},
		currentSpec: null,
		addReporter() {},
		execute() {}
	};
	const jasmine = {
		getEnv: () => env,
		createSpy: (name) => createSpy(name),
		createSpyObj(name, methods) {
			const o = {};
			for (const m of methods) {
				o[m] = createSpy(name + "." + m);
			}
			return o;
		},
		any(ctor) {
			return {
				__jasmineAny: true,
				ctor,
				matches(v) {
					const t = typeof v;
					if (ctor === win.String || ctor === String) {
						return t === "string" || v instanceof win.String;
					}
					if (ctor === win.Number || ctor === Number) {
						return t === "number" || v instanceof win.Number;
					}
					if (ctor === win.Function || ctor === Function) {
						return t === "function";
					}
					if (ctor === win.Object || ctor === Object) {
						return t === "object" && v !== null;
					}
					if (ctor === win.Boolean || ctor === Boolean) {
						return t === "boolean";
					}
					return v instanceof ctor;
				}
			};
		},
		pp,
		suite: null
	};

	const node = (name, fn, kind) => {
		const n = {name, kind, parent: current, children: [], before: [], after: [], fn};
		current.children.push(n);
		return n;
	};

	const g = {
		jasmine,
		describe(name, fn) {
			const n = node(name, null, "suite");
			const prev = current;
			current = n;
			try {
				fn.call({});
			} finally {
				current = prev;
			}
			return n;
		},
		xdescribe(name) {
			node(name, null, "xsuite");
		},
		it(name, fn) {
			node(name, fn, fn ? "spec" : "xspec");
		},
		xit(name) {
			node(name, null, "xspec");
		},
		beforeEach(fn) {
			current.before.push(fn);
		},
		afterEach(fn) {
			current.after.push(fn);
		},
		expect,
		spyOn(obj, name) {
			if (!obj) {
				throw new Error("spyOn could not find an object to spy upon for " + name + "()");
			}
			if (obj[name] === undefined) {
				throw new Error(name + "() method does not exist");
			}
			if (obj[name] && obj[name].isSpy) {
				throw new Error(name + " has already been spied upon");
			}
			const spy = createSpy(name, obj[name], obj);
			const had = Object.prototype.hasOwnProperty.call(obj, name);
			// A spy made outside a spec (in a describe body; Jasmine 1.3 throws
			// there) lasts until the spec file is done.
			(spec ? spec.spies : fileSpies).push(() => {
				if (had) {
					obj[name] = spy.originalValue;
				} else {
					delete obj[name];
				}
			});
			obj[name] = spy;
			return spy;
		},
		runs(fn) {
			spec.queue.push({type: "runs", fn});
		},
		waits(ms) {
			spec.queue.push({type: "waits", ms});
		},
		waitsFor(fn, message, timeout) {
			// Jasmine 1.x also takes (fn, timeout) and (fn, timeout, message).
			if (typeof message === "number") {
				[message, timeout] = [typeof timeout === "string" ? timeout : undefined, message];
			}
			spec.queue.push({type: "waitsFor", fn, message, timeout: timeout || 5000});
		}
	};

	// Runs fn, then the runs/waits/waitsFor blocks it queued, in order (each
	// block's own queued blocks run before the next one).
	async function runBlock(fn) {
		const saved = spec.queue;
		spec.queue = [];
		try {
			fn.call(spec.ctx);
		} catch (e) {
			spec.queue = saved;
			throw e;
		}
		const queued = spec.queue;
		spec.queue = saved;
		for (const b of queued) {
			if (b.type === "runs") {
				await runBlock(b.fn);
			} else if (b.type === "waits") {
				await new Promise((r) => setTimeout(r, b.ms));
			} else {
				const end = Date.now() + b.timeout;
				while (!b.fn.call(spec.ctx)) {
					if (Date.now() > end) {
						throw new Error("timeout: timed out after " + b.timeout + " msec waiting for " + (b.message || "something to happen"));
					}
					await new Promise((r) => setTimeout(r, 5));
				}
			}
		}
	}

	async function runSpec(n) {
		const chain = [];
		for (let p = n.parent; p; p = p.parent) {
			chain.unshift(p);
		}
		spec = {failures: [], queue: [], spies: [], ctx: {}, matchers: {}};
		spec.ctx.addMatchers = (m) => Object.assign(spec.matchers, m);
		env.currentSpec = spec.ctx;
		let error = null;
		try {
			for (const s of chain) {
				for (const b of s.before) {
					await runBlock(b);
				}
			}
			await runBlock(n.fn);
		} catch (e) {
			error = e;
		}
		for (const s of chain.slice().reverse()) {
			for (const a of s.after) {
				try {
					await runBlock(a);
				} catch (e) {
					error = error || e;
				}
			}
		}
		for (const restore of spec.spies.reverse()) {
			restore();
		}
		const failures = spec.failures;
		spec = null;
		env.currentSpec = null;
		if (error) {
			throw error;
		}
		if (failures.length) {
			throw new Error(failures.join("\n"));
		}
	}

	const restoreFileSpies = () => fileSpies.splice(0).reverse().forEach((r) => r());
	return {globals: g, root, runSpec, restoreFileSpies};
}

const fullName = (n) => {
	const parts = [];
	for (let p = n; p && p.name; p = p.parent) {
		parts.unshift(p.name);
	}
	return parts.join(" ");
};

/**
 * Declares node:test suites for old Jasmine spec files. options:
 *   app, page, ...   boot()'s options for the page the specs run in
 *   helpers          files (relative to the app) loaded before the specs
 *   before(env)      runs after the helpers load, before the spec files
 *   specs            spec files (relative to the app); each gets its own page.
 *                    An entry can be {file, ...options} for options of its
 *                    own (launch: {} to run it in the launched app, say, or
 *                    helpers, or before), and file can list several files
 *                    that share one page, loaded in order.
 *   skip             { "full spec name": "why" }: specs not run, with the reason
 *   todo             { "full spec name": "why" }: specs that run and report,
 *                    but whose failure does not fail the run (a known bug)
 *   bootFn           replaces boot()
 */
function legacySuite(options) {
	const {helpers = [], specs, skip = {}, todo = {}, bootFn = boot} = options;
	const path = require("path");
	const used = new Set();
	// Pages launched for their specs open windows that load asynchronously;
	// that finishes before any spec runs, so it cannot slow down another
	// file's timed specs.
	const launched = [];
	nodeTest.before(async () => {
		for (const env of launched) {
			await env.settle();
		}
	});
	for (const entry of specs) {
		// An entry may name several files that share one page, in order.
		const files = [].concat(typeof entry === "string" ? entry : entry.file);
		const file = files.join(" + ");
		const fileOptions = Object.assign({}, options, typeof entry === "string" ? {} : entry);
		let env, jas, loadError;
		try {
			env = bootFn(fileOptions);
			if (fileOptions.launch) {
				launched.push(env);
			}
			jas = makeJasmine(env.window);
			Object.assign(env.window, jas.globals);
			for (const h of fileOptions.helpers || helpers) {
				env.load(path.join(env.app, h));
			}
			if (fileOptions.before) {
				fileOptions.before(env);
			}
			for (const f of files) {
				env.load(path.join(env.app, f));
			}
		} catch (e) {
			loadError = e;
		}
		nodeTest.describe(file, () => {
			if (loadError) {
				nodeTest.it("loads", () => {
					if (env) {
						env.close();
					}
					throw loadError;
				});
				return;
			}
			const declare = (n) => {
				for (const c of n.children) {
					const name = fullName(c);
					if (c.kind === "suite") {
						nodeTest.describe(c.name, () => declare(c));
					} else if (c.kind === "xsuite" || c.kind === "xspec") {
						nodeTest.it(c.name, {skip: "x'd out in the spec"}, () => {});
					} else if (skip[name]) {
						used.add(name);
						nodeTest.it(c.name, {skip: skip[name]}, () => {});
					} else {
						if (todo[name]) {
							used.add(name);
						}
						nodeTest.it(c.name, {todo: todo[name]}, async () => {
							const before = env.errors.length;
							await jas.runSpec(c);
							await env.settle();
							const errs = env.errors.slice(before);
							if (errs.length) {
								throw new Error("the page reported errors:\n" + errs.join("\n"));
							}
						});
					}
				}
			};
			declare(jas.root);
			nodeTest.after(() => {
				jas.restoreFileSpies();
				env.close();
			});
		});
	}
	// A skip entry left behind by a renamed or removed spec is an error.
	nodeTest.after(() => {
		const unused = Object.keys(skip).concat(Object.keys(todo)).filter((k) => !used.has(k));
		if (unused.length) {
			throw new Error("skip/todo entries match no spec: " + unused.join("; "));
		}
	});
}

module.exports = {legacySuite, makeJasmine, equals};
