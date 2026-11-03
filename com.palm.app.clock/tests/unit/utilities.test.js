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

// Utilities: when an alarm rings next, and how that is written.
// Dates are Amsterdam local time; 2026-11-03 is a Tuesday.
"use strict";

const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const {usePage, local} = require("../fixtures");

describe("Utilities.dateGetNext", () => {
	const page = usePage();
	const next = (now, occurs, h = 7, m = 5) => {
		page.env.setNow(now);
		return local(page.env.enyo.application.utilities.dateGetNext(h, m, occurs));
	};

	describe("daily", () => {
		it("is today while the time is still to come", () => {
			assert.equal(next("2026-11-03T06:00:00", "daily"), "2026-11-03 07:05:00");
		});
		it("is tomorrow once the time has passed", () => {
			assert.equal(next("2026-11-03T16:00:00", "daily"), "2026-11-04 07:05:00");
		});
		it("is tomorrow at the very minute it rings", () => {
			assert.equal(next("2026-11-03T07:05:00", "daily"), "2026-11-04 07:05:00");
		});
		it("keeps the local time across the end of summer time", () => {
			// 2026-10-25 03:00 CEST becomes 02:00 CET.
			assert.equal(next("2026-10-24T08:00:00", "daily"), "2026-10-25 07:05:00");
		});
		it("keeps the local time across the start of summer time", () => {
			// 2027-03-28 02:00 CET becomes 03:00 CEST.
			assert.equal(next("2027-03-27T08:00:00", "daily"), "2027-03-28 07:05:00");
		});
		it("is what an unknown or 'once' repeat gets", () => {
			assert.equal(next("2026-11-03T16:00:00", "once"), "2026-11-04 07:05:00");
			assert.equal(next("2026-11-03T16:00:00", undefined), "2026-11-04 07:05:00");
		});
	});

	describe("weekdays", () => {
		it("is today on a weekday before the time", () => {
			assert.equal(next("2026-11-03T06:00:00", "weekdays"), "2026-11-03 07:05:00");
		});
		it("is the next day on a weekday after the time", () => {
			assert.equal(next("2026-11-03T08:00:00", "weekdays"), "2026-11-04 07:05:00");
		});
		it("is Monday on a Friday after the time", () => {
			assert.equal(next("2026-11-06T08:00:00", "weekdays"), "2026-11-09 07:05:00");
		});
		it("is Monday on a Saturday or a Sunday", () => {
			assert.equal(next("2026-11-07T06:00:00", "weekdays"), "2026-11-09 07:05:00");
			assert.equal(next("2026-11-08T06:00:00", "weekdays"), "2026-11-09 07:05:00");
		});
	});

	describe("weekends", () => {
		it("is Saturday during the week", () => {
			assert.equal(next("2026-11-03T06:00:00", "weekends"), "2026-11-07 07:05:00");
			assert.equal(next("2026-11-06T08:00:00", "weekends"), "2026-11-07 07:05:00");
		});
		it("is today on a Saturday before the time, Sunday after it", () => {
			assert.equal(next("2026-11-07T06:00:00", "weekends"), "2026-11-07 07:05:00");
			assert.equal(next("2026-11-07T08:00:00", "weekends"), "2026-11-08 07:05:00");
		});
		it("is today on a Sunday before the time, next Saturday after it", () => {
			assert.equal(next("2026-11-08T06:00:00", "weekends"), "2026-11-08 07:05:00");
			assert.equal(next("2026-11-08T08:00:00", "weekends"), "2026-11-14 07:05:00");
		});
	});
});

describe("Utilities.getActivityDateString", () => {
	const page = usePage();

	it("writes local time as activitymanager's 'YYYY-MM-DD HH:MM:SS'", () => {
		const win = page.env.window;
		assert.equal(page.env.enyo.application.utilities.getActivityDateString(new win.Date(2026, 0, 2, 3, 4, 5)), "2026-01-02 03:04:05");
		assert.equal(page.env.enyo.application.utilities.getActivityDateString(new win.Date(2026, 11, 31, 23, 59, 0)), "2026-12-31 23:59:00");
	});
});

describe("Utilities.nextAlarmDayText", () => {
	const page = usePage();
	const text = (now, occurs) => {
		page.env.setNow(now);
		const win = page.env.window;
		return page.env.enyo.application.utilities.nextAlarmDayText(new win.Date(1990, 1, 1, 7, 5, 0, 0), occurs);
	};

	it("says nothing for a daily alarm still to ring today", () => {
		assert.equal(text("2026-11-03T06:00:00", "daily"), "");
	});
	it("says Tomorrow for a daily or one-time alarm whose time has passed", () => {
		assert.equal(text("2026-11-03T16:00:00", "daily"), "Tomorrow");
		assert.equal(text("2026-11-03T16:00:00", "once"), "Tomorrow");
	});
	it("says Monday for a weekday alarm on Friday evening or Saturday", () => {
		assert.equal(text("2026-11-06T16:00:00", "weekdays"), "Monday");
		assert.equal(text("2026-11-07T06:00:00", "weekdays"), "Monday");
	});
	it("says Saturday for a weekend alarm during the week", () => {
		assert.equal(text("2026-11-03T06:00:00", "weekends"), "Saturday");
	});
	it("says Tomorrow for a weekend alarm on Friday", () => {
		assert.equal(text("2026-11-06T06:00:00", "weekends"), "Tomorrow");
	});
});
