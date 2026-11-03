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

// The fake bus answers as a device does.
"use strict";

const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const {Db8, ActivityManager, timeZoneRules} = require("./luna");

describe("fake getTimeZoneRules", () => {
	// What com.palm.systemservice answered on a device (mindphone, 2026-11-03).
	const device = [
		{dstStart: 1774746000, utcOffset: 3600, dstOffset: 7200, tz: "Europe/Amsterdam", year: 2026, hasDstChange: true, dstEnd: 1792890000},
		{dstStart: 1806195600, utcOffset: 3600, dstOffset: 7200, tz: "Europe/Amsterdam", year: 2027, hasDstChange: true, dstEnd: 1824944400},
		{dstStart: -1, utcOffset: 0, dstOffset: -1, tz: "UTC", year: 2026, hasDstChange: false, dstEnd: -1},
		{dstStart: 1772964000, utcOffset: -28800, dstOffset: -25200, tz: "America/Los_Angeles", year: 2026, hasDstChange: true, dstEnd: 1793523600},
		{dstStart: 1791043200, utcOffset: 36000, dstOffset: 39600, tz: "Australia/Sydney", year: 2026, hasDstChange: true, dstEnd: 1775318400}
	];
	for (const d of device) {
		it(d.tz + " " + d.year, () => {
			assert.deepEqual(timeZoneRules(d.tz, d.year), {tz: d.tz, year: d.year, hasDstChange: d.hasDstChange,
				utcOffset: d.utcOffset, dstOffset: d.dstOffset, dstStart: d.dstStart, dstEnd: d.dstEnd});
		});
	}
});

describe("fake DB8", () => {
	it("finds by = filters, merges, deletes and batches", () => {
		const db = new Db8();
		db.seed([{_kind: "k:1", a: 1}, {_kind: "k:1", a: 2}, {_kind: "j:1", a: 1}]);
		assert.equal(db.handle("find", {query: {from: "k:1", where: [{prop: "a", op: "=", val: 1}]}}).results.length, 1);
		const id = db.all("k:1")[0]._id;
		db.handle("merge", {objects: [{_id: id, b: 3}]});
		assert.equal(db.objects.get(id).b, 3);
		const r = db.handle("batch", {operations: [{method: "del", params: {ids: [id]}}, {method: "find", params: {query: {from: "k:1"}}}]});
		assert.equal(r.responses[1].results.length, 1);
	});

	const ids = (r) => r.results.map((o) => o._id);

	it("compares values of different types by type, so null is never >= 0", () => {
		const db = new Db8();
		db.seed([{_kind: "t:1", _id: "dated", due: 5}, {_kind: "t:1", _id: "undated", due: null}, {_kind: "t:1", _id: "none"}]);
		assert.deepEqual(ids(db.handle("find", {query: {from: "t:1", where: [{prop: "due", op: ">=", val: 0}]}})), ["dated"]);
		assert.deepEqual(ids(db.handle("find", {query: {from: "t:1", where: [{prop: "due", op: "=", val: null}]}})), ["undated"]);
		assert.deepEqual(ids(db.handle("find", {query: {from: "t:1", where: [{prop: "due", op: "!=", val: 1}]}})), ["dated", "undated"],
			"an object without the property matches nothing");
	});

	it("matches a property path through an array by any element", () => {
		const db = new Db8();
		db.seed([{_kind: "a:1", _id: "mail", caps: [{capability: "CONTACTS"}, {capability: "MAIL"}]}, {_kind: "a:1", _id: "cal", caps: [{capability: "CALENDAR"}]}]);
		assert.deepEqual(ids(db.handle("find", {query: {from: "a:1", where: [{prop: "caps.capability", op: "=", val: "MAIL"}]}})), ["mail"]);
	});

	it("orders, limits and counts", () => {
		const db = new Db8();
		db.seed([{_kind: "n:1", _id: "b", p: "m"}, {_kind: "n:1", _id: "a", p: "g"}, {_kind: "n:1", _id: "c", p: "z"}]);
		const r = db.handle("find", {query: {from: "n:1", orderBy: "p", desc: true, limit: 2}, count: true});
		assert.deepEqual(ids(r), ["c", "b"]);
		assert.equal(r.count, 3);
	});

	it("searches text by word prefixes, ignoring case and accents", () => {
		const db = new Db8();
		db.seed([{_kind: "n:1", _id: "x", text: "Crème brûlée recipe"}, {_kind: "n:1", _id: "y", text: "Shopping list"}]);
		const search = (val) => ids(db.handle("search", {query: {from: "n:1", where: [{prop: "text", op: "?", val}]}}));
		assert.deepEqual(search("creme bru"), ["x"]);
		assert.deepEqual(search("list shop"), ["y"]);
		assert.deepEqual(search("ecipe"), []);
	});

	it("includes the kinds that extend a kind", () => {
		const db = new Db8();
		db.extend("list.unfiled:1", ["list:1"]);
		db.seed([{_kind: "list:1", _id: "a"}, {_kind: "list.unfiled:1", _id: "u"}]);
		assert.deepEqual(ids(db.handle("find", {query: {from: "list:1"}})), ["a", "u"]);
		assert.deepEqual(ids(db.handle("find", {query: {from: "list.unfiled:1"}})), ["u"]);
	});

	it("fires a watch once, when its answer changes", () => {
		const db = new Db8();
		const fired = [];
		assert.deepEqual(db.handle("watch", {query: {from: "w:1"}}, (r) => fired.push(r)), {returnValue: true});
		db.seed([{_kind: "other:1"}]);
		assert.deepEqual(fired, []);
		db.handle("put", {objects: [{_kind: "w:1"}]});
		db.handle("put", {objects: [{_kind: "w:1"}]});
		assert.deepEqual(fired, [{returnValue: true, fired: true}]);
		assert.deepEqual(db.handle("watch", {query: {from: "w:1"}}), {returnValue: true, fired: true}, "fires at once when it matches");
	});

	it("fires a find's watch when a merge changes its results", () => {
		const db = new Db8();
		db.seed([{_kind: "w:1", _id: "a", n: 1}]);
		const fired = [];
		db.handle("find", {query: {from: "w:1"}, watch: true}, (r) => fired.push(r));
		db.handle("merge", {objects: [{_id: "a", n: 2}]});
		assert.equal(fired.length, 1);
	});
});

describe("fake bus", () => {
	const {Luna} = require("./luna");
	const answer = (luna, uri, payload) => luna.handlers.find((h) => uri.startsWith(h.prefix)).fn(payload, {uri});

	it("filters account templates by capability, as the device does", () => {
		const luna = new Luna();
		const ids = (cap) => answer(luna, "luna://com.palm.service.accounts/listAccountTemplates", cap ? {capability: cap} : {}).results.map((t) => t.templateId);
		// The device's answers (mindphone, 2026-11-03).
		assert.deepEqual(ids("MAIL"), ["com.palm.othermail", "com.palm.imap", "com.palm.pop"]);
		assert.deepEqual(ids("TASKS"), ["com.palm.palmprofile"]);
		assert.equal(ids().length, 37);
	});

	it("answers a service LuneOS does not have as the bus does", () => {
		assert.deepEqual(answer(new Luna(), "luna://com.palm.accountservices/getAccountToken", {}),
			{returnValue: false, errorCode: -1, errorText: "Service does not exist: com.palm.accountservices."});
	});
});

describe("fake activitymanager", () => {
	it("refuses to complete a scheduled activity and cancels it", () => {
		const am = new ActivityManager();
		am.handle("create", {activity: {name: "a", callback: {}}, start: true, replace: true});
		assert.equal(am.handle("complete", {activityName: "a"}).errorText, "Invalid transition: unsatisfied -> complete");
		assert.equal(am.handle("cancel", {activityName: "a"}).returnValue, true);
		assert.equal(am.handle("cancel", {activityName: "a"}).errorText, "Activity name/creator pair not found");
	});
});
