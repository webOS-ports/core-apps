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

// A fake luna bus behind the PalmServiceBridge the page gets, the object
// WebAppMgr provides on a device. Every call is recorded. com.palm.db,
// com.palm.tempdb and com.palm.activitymanager answer the way the device does
// (see Db8 and ActivityManager below), and a few common services with answers
// shaped like a device's (defaults() below); other services answer
// {"returnValue": true} unless a test installs a handler with on().
"use strict";

// palm:// and luna:// name the same bus; calls are recorded as luna://.
function normalize(uri) {
	return uri.replace(/^palm:\/\//, "luna://").replace(/\/+$/, "");
}

class Luna {
	constructor() {
		this.calls = [];
		this.handlers = [];
		this.subscriptions = [];
		this.inflight = 0;
		this.db = new Db8();
		this.tempdb = new Db8();
		this.activities = new ActivityManager(this);
		// Answers of the defaults below that tests may change.
		// The account templates of a LuneOS image (mindphone, 2026-11-03).
		this.accountTemplates = JSON.parse(JSON.stringify(require("./device/accountTemplates.json")));
		this.accounts = [];
		this.preferences = {
			timeFormat: "HH24",
			locale: {languageCode: "en", countryCode: "us", phoneRegion: {countryCode: "us", countryName: "United States"}},
			region: {countryCode: "nl", countryName: "Netherlands"},
			wallpaper: {wallpaperName: "LuneOS.jpg", wallpaperFile: "/usr/share/wallpapers/LuneOS.jpg", wallpaperThumbFile: ""}
		};
		this.defaults();
	}

	// Services most apps call at startup, answering with the fields a device's
	// answer has (mindphone, 2026-11-03), and no accounts.
	defaults() {
		this.on("luna://com.palm.db/", (p, c) => this.db.handle(c.method, p, (r) => this.deliver(c.bridge, r)));
		this.on("luna://com.palm.tempdb/", (p, c) => this.tempdb.handle(c.method, p, (r) => this.deliver(c.bridge, r)));
		this.on("luna://com.palm.activitymanager/", (p, c) => this.activities.handle(c.method, p));
		// Filtered by capability, as the accounts service does.
		this.on("luna://com.palm.service.accounts/listAccountTemplates", (p) => ({
			returnValue: true,
			results: this.accountTemplates.filter((t) => !p.capability ||
				(t.capabilityProviders || []).some((c) => c.capability === p.capability))
		}));
		this.on("luna://com.palm.service.accounts/listAccounts", () =>
			({returnValue: true, results: this.accounts}));
		// Services a LuneOS image does not have, answered as the bus does.
		for (const service of ["com.palm.accountservices"]) {
			this.on("luna://" + service + "/", () => ({returnValue: false, errorCode: -1, errorText: "Service does not exist: " + service + "."}));
		}
		this.on("luna://com.palm.connectionmanager/getStatus", () => ({
			returnValue: true,
			isInternetConnectionAvailable: true,
			offlineMode: "disabled",
			wifi: {state: "connected", onInternet: "yes"},
			wan: {onInternet: false, connected: false},
			wired: {plugged: false, state: "disconnected"},
			wifiDirect: {state: "disconnected"},
			cellular: {enabled: true}
		}));
		this.on("luna://com.palm.systemservice/getPreferences", (p) => {
			const r = {returnValue: true};
			for (const k of p.keys || []) {
				if (k in this.preferences) {
					r[k] = this.preferences[k];
				}
			}
			return r;
		});
		this.on("luna://com.palm.systemservice/timezone/getTimeZoneRules", (p) => ({
			returnValue: true,
			results: [].concat(...(Array.isArray(p) ? p : [p]).map((q) => q.years.map((y) => timeZoneRules(q.tz, y))))
		}));
		this.on("luna://com.palm.systemservice/time/getSystemTime", () => {
			const d = new this.win.Date();
			const jan = new this.win.Date(d.getFullYear(), 0, 1), jul = new this.win.Date(d.getFullYear(), 6, 1);
			const isDST = d.getTimezoneOffset() < Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
			return {
				returnValue: true,
				timezone: process.env.TZ,
				TZ: new Intl.DateTimeFormat("en-GB", {timeZone: process.env.TZ, timeZoneName: "short"}).formatToParts(d).find((x) => x.type === "timeZoneName").value,
				offset: -d.getTimezoneOffset(),
				isDST,
				utc: Math.floor(d.getTime() / 1000),
				localtime: {year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds()},
				systemTimeSource: "ntp"
			};
		});
	}

	// fn(payload, call) answers calls whose URI starts with prefix. It returns
	// the response, or undefined to send none. Later handlers win.
	on(prefix, fn) {
		this.handlers.unshift({prefix: normalize(prefix), fn});
	}

	// The calls made so far whose URI starts with prefix.
	callsTo(prefix) {
		prefix = normalize(prefix);
		return this.calls.filter((c) => c.uri.startsWith(prefix));
	}

	// Sends response to every open subscription whose URI starts with prefix.
	push(prefix, response) {
		prefix = normalize(prefix);
		for (const s of this.subscriptions) {
			if (s.uri.startsWith(prefix)) {
				this.deliver(s.bridge, response);
			}
		}
	}

	// Installs window.PalmServiceBridge for this bus in win; every window of
	// the app shares the bus. The first window is the app's root.
	install(win) {
		const luna = this;
		// call and cancel live on the prototype, as on a device.
		win.PalmServiceBridge = function PalmServiceBridge() {
			this.win = win;
		};
		win.PalmServiceBridge.prototype.call = function (uri, json) {
			return luna.dispatch(this, uri, json);
		};
		win.PalmServiceBridge.prototype.cancel = function () {
			this.cancelled = true;
			luna.subscriptions = luna.subscriptions.filter((s) => s.bridge !== this);
		};
		this.win = this.win || win;
	}

	dispatch(bridge, rawUri, json) {
		const uri = normalize(rawUri);
		const payload = json ? JSON.parse(json) : {};
		const call = {uri, method: uri.slice(uri.lastIndexOf("/") + 1), payload};
		// Not enumerable, so recorded calls stay plain data.
		Object.defineProperty(call, "bridge", {value: bridge});
		this.calls.push(call);
		if (payload.subscribe) {
			this.subscriptions.push({uri, bridge});
		}
		const h = this.handlers.find((x) => uri.startsWith(x.prefix));
		const response = h ? h.fn(payload, call) : {returnValue: true};
		if (response !== undefined) {
			this.deliver(bridge, response);
		}
	}

	// Answers asynchronously, as the bus does: the caller has returned and
	// stored its request before the response arrives.
	deliver(bridge, response) {
		this.inflight++;
		const win = bridge.win && !bridge.win.closed ? bridge.win : this.win;
		win.setTimeout(() => {
			this.inflight--;
			if (!bridge.cancelled) {
				bridge.onservicecallback(JSON.stringify(response));
			}
		}, 0);
	}
}

// The UTC offset of tz at time t (ms), in seconds.
const offsetFormats = new Map();
function utcOffset(tz, t) {
	if (!offsetFormats.has(tz)) {
		offsetFormats.set(tz, new Intl.DateTimeFormat("en-US", {timeZone: tz, timeZoneName: "longOffset"}));
	}
	const name = offsetFormats.get(tz).formatToParts(new Date(t)).find((x) => x.type === "timeZoneName").value;
	const m = /GMT(?:([+-])(\d\d):(\d\d))?/.exec(name);
	return m[1] ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 3600 + Number(m[3]) * 60) : 0;
}

// systemservice/timezone/getTimeZoneRules for one zone and year, as the
// service gives it: standard and summer offsets, and when summer time starts
// and ends that year (seconds since the epoch), or -1 without summer time.
function timeZoneRules(tz, year) {
	const from = Date.UTC(year, 0, 1) - 14 * 3600e3, to = Date.UTC(year + 1, 0, 1) + 14 * 3600e3;
	const changes = [];
	let prev = utcOffset(tz, from);
	for (let t = from + 3600e3; t <= to; t += 3600e3) {
		const cur = utcOffset(tz, t);
		if (cur !== prev) {
			let lo = t - 3600e3, hi = t; // the change is in (lo, hi]
			while (hi - lo > 1000) {
				const mid = lo + Math.floor((hi - lo) / 2000) * 1000;
				if (utcOffset(tz, mid) === prev) {
					lo = mid;
				} else {
					hi = mid;
				}
			}
			changes.push({at: hi / 1000, to: cur});
			prev = cur;
		}
	}
	const inYear = changes.filter((c) => new Date(c.at * 1000 + c.to * 1000).getUTCFullYear() === year);
	if (inYear.length === 0) {
		return {tz, year, hasDstChange: false, utcOffset: utcOffset(tz, Date.UTC(year, 6, 1)), dstOffset: -1, dstStart: -1, dstEnd: -1};
	}
	const offsets = [...new Set(changes.map((c) => c.to).concat(utcOffset(tz, from)))];
	const std = Math.min(...offsets), dst = Math.max(...offsets);
	const start = inYear.find((c) => c.to === dst), end = inYear.find((c) => c.to === std);
	return {tz, year, hasDstChange: true, utcOffset: std, dstOffset: dst, dstStart: start ? start.at : -1, dstEnd: end ? end.at : -1};
}

// The part of DB8 the apps use: find (with watch), search, watch, put,
// merge, del, get and batch.
// The values at a property path; arrays on the way give one value each.
function values(o, prop) {
	let cur = [o];
	for (const part of prop.split(".")) {
		cur = cur.flatMap((x) => (x === null || x === undefined) ? [] : [].concat(x[part]));
	}
	if (prop === "_del") {
		cur = cur.map((v) => v === undefined ? false : v);
	}
	// An object without the property is not in the index: it matches nothing.
	return cur.filter((v) => v !== undefined);
}

// DB8's order of values: by type first (null, booleans, numbers, strings,
// then the rest), then by value. So null is never ">= 0".
function collate(a, b) {
	const rank = (v) => v === null ? 0 : typeof v === "boolean" ? 1 : typeof v === "number" ? 2 : typeof v === "string" ? 3 : 4;
	const ra = rank(a), rb = rank(b);
	if (ra !== rb) {
		return ra - rb;
	}
	if (ra === 4) {
		const ja = JSON.stringify(a), jb = JSON.stringify(b);
		return ja < jb ? -1 : ja > jb ? 1 : 0;
	}
	return a < b ? -1 : a > b ? 1 : 0;
}

const words = (v) => typeof v !== "string" ? [] :
	(v.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);

const revs = (objects) => objects.map((o) => o._id + ":" + o._rev).join(",");

class Db8 {
	constructor() {
		this.objects = new Map();
		this.parents = new Map();
		this.watches = [];
		this.nextId = 1;
		this.rev = 1;
	}

	// Stores objects as if they were already in the database.
	seed(objects) {
		for (const o of objects) {
			const copy = JSON.parse(JSON.stringify(o));
			copy._id = copy._id || "id" + this.nextId++;
			copy._rev = this.rev++;
			this.objects.set(copy._id, copy);
		}
		this.changed();
	}

	// Declares that kind extends the parent kinds (a kind file's "extends").
	extend(kind, parents) {
		this.parents.set(kind, [].concat(parents));
	}

	isKindOf(kind, ancestor) {
		return kind === ancestor || (this.parents.get(kind) || []).some((p) => this.isKindOf(p, ancestor));
	}

	// A kind's objects include those of the kinds that extend it.
	all(kind) {
		return [...this.objects.values()].filter((o) => !kind || this.isKindOf(o._kind, kind));
	}

	get(prop, val) {
		return [...this.objects.values()].find((o) => o[prop] === val);
	}

	// reply delivers a later answer to the caller (a watch firing).
	handle(method, p, reply) {
		const answer = this.answer(method, p, reply);
		if (["put", "merge", "del", "batch"].includes(method)) {
			this.changed();
		}
		return answer;
	}

	answer(method, p, reply) {
		switch (method) {
			case "find": {
				const results = this.query(p.query || {});
				// count: the number of matches, whatever the limit.
				const count = p.count ? this.query(Object.assign({}, p.query, {limit: Infinity})).length : undefined;
				if (p.watch && reply) {
					this.watches.push({query: p.query || {}, reply, count: results.length, revs: revs(results)});
				}
				return Object.assign({returnValue: true, results: JSON.parse(JSON.stringify(results))}, p.count ? {count} : {});
			}
			case "search":
				return {returnValue: true, results: JSON.parse(JSON.stringify(this.query(p.query || {})))};
			case "watch": {
				// Fires at once when the query matches something, else on
				// the first change that makes it match.
				if (this.query(p.query || {}).length) {
					return {returnValue: true, fired: true};
				}
				if (reply) {
					this.watches.push({query: p.query || {}, reply, count: 0, revs: ""});
				}
				return {returnValue: true};
			}
			case "put": {
				const results = p.objects.map((o) => {
					const copy = JSON.parse(JSON.stringify(o));
					copy._id = copy._id || "id" + this.nextId++;
					copy._rev = this.rev++;
					this.objects.set(copy._id, copy);
					return {id: copy._id, rev: copy._rev};
				});
				return {returnValue: true, results};
			}
			case "merge": {
				const results = [];
				for (const o of p.objects) {
					const cur = this.objects.get(o._id);
					if (cur) {
						Object.assign(cur, JSON.parse(JSON.stringify(o)), {_rev: this.rev++});
						results.push({id: cur._id, rev: cur._rev});
					}
				}
				return {returnValue: true, results};
			}
			case "del": {
				if (p.query) {
					const found = this.query(p.query);
					found.forEach((o) => this.objects.delete(o._id));
					return {returnValue: true, count: found.length};
				}
				const results = p.ids.filter((id) => this.objects.delete(id)).map((id) => ({id}));
				return {returnValue: true, results};
			}
			case "get": {
				const results = p.ids.map((id) => this.objects.get(id)).filter(Boolean);
				return {returnValue: true, results: JSON.parse(JSON.stringify(results))};
			}
			case "batch": {
				const responses = p.operations.map((op) => this.answer(op.method, op.params || {}));
				return {returnValue: true, responses};
			}
			case "putKind":
			case "delKind":
			case "putPermissions":
				return {returnValue: true};
		}
		return {returnValue: false, errorCode: -986, errorText: "fake db8: no method " + method};
	}

	// The objects a DB8 query selects: where clauses (a property path
	// through arrays matches any element, as a DB8 index does), orderBy,
	// desc and limit. Objects without _del count as not deleted.
	query(q) {
		const ops = {
			"=": (a, b) => Array.isArray(b) ? b.some((x) => collate(a, x) === 0) : collate(a, b) === 0,
			"!=": (a, b) => collate(a, b) !== 0,
			"<": (a, b) => collate(a, b) < 0,
			"<=": (a, b) => collate(a, b) <= 0,
			">": (a, b) => collate(a, b) > 0,
			">=": (a, b) => collate(a, b) >= 0,
			"%": (a, b) => typeof a === "string" && a.startsWith(b),
			// Full text (search): each word of b starts a word of a,
			// ignoring case and accents.
			"?": (a, b) => {
				const have = words(a);
				return words(b).every((w) => have.some((h) => h.startsWith(w)));
			}
		};
		let results = this.all(q.from).filter((o) => (q.where || []).every((w) => {
			if (!ops[w.op]) {
				throw new Error("fake db8: unsupported op " + w.op);
			}
			return values(o, w.prop).some((v) => ops[w.op](v, w.val));
		}));
		if (q.orderBy) {
			const key = (o) => values(o, q.orderBy)[0];
			results.sort((a, b) => collate(key(a), key(b)));
		}
		if (q.desc) {
			results.reverse();
		}
		return results.slice(0, q.limit || 500);
	}

	// A change was made: fire the watches whose answer changed.
	changed() {
		const fire = [];
		this.watches = this.watches.filter((w) => {
			const now = this.query(w.query);
			if (now.length === w.count && revs(now) === w.revs) {
				return true;
			}
			fire.push(w);
			return false;
		});
		fire.forEach((w) => w.reply({returnValue: true, fired: true}));
	}
}

// Activities by name, with the transitions activitymanager allows. The
// answers are the ones a device gave (mindphone, 2026-11-03):
//   complete on a scheduled activity -> errorCode -1000,
//       "Invalid transition: unsatisfied -> complete", activity kept
//   complete on a fired one          -> returnValue true, activity removed
//   cancel on either                 -> returnValue true, activity removed
//   cancel/complete on no activity   -> errorCode 2,
//       "Activity name/creator pair not found"
class ActivityManager {
	constructor(luna) {
		this.luna = luna;
		this.byName = new Map();
		this.nextId = 1;
	}

	get(name) {
		return this.byName.get(name);
	}

	scheduled() {
		return [...this.byName.values()].filter((a) => a.state === "unsatisfied");
	}

	// The activity's time comes: it is marked expired and its callback is
	// returned (the applicationManager launch the app asked for).
	fire(name) {
		const a = this.byName.get(name);
		if (!a || a.state !== "unsatisfied") {
			throw new Error("fake activitymanager: nothing scheduled named " + name);
		}
		a.state = "expired";
		return a.activity.callback;
	}

	handle(method, p) {
		const notFound = {returnValue: false, errorCode: 2, errorText: "Activity name/creator pair not found"};
		switch (method) {
			case "create": {
				const name = p.activity.name;
				if (this.byName.has(name) && !p.replace) {
					return {returnValue: false, errorCode: 17, errorText: "Activity with that name already exists"};
				}
				const a = {activityId: this.nextId++, activity: p.activity, state: p.start ? "unsatisfied" : "init"};
				this.byName.set(name, a);
				return {returnValue: true, activityId: a.activityId, subscribed: false};
			}
			case "cancel": {
				if (!this.byName.delete(p.activityName)) {
					return notFound;
				}
				return {returnValue: true};
			}
			case "complete": {
				const a = this.byName.get(p.activityName);
				if (!a) {
					return notFound;
				}
				if (a.state === "unsatisfied") {
					return {returnValue: false, errorCode: -1000, errorText: "Invalid transition: unsatisfied -> complete"};
				}
				this.byName.delete(p.activityName);
				return {returnValue: true};
			}
			case "getDetails": {
				const a = this.byName.get(p.activityName);
				return a ? {returnValue: true, activity: Object.assign({activityId: a.activityId, state: a.state}, a.activity)} : notFound;
			}
		}
		return {returnValue: false, errorCode: -1, errorText: "fake activitymanager: no method " + method};
	}
}

module.exports = {Luna, Db8, ActivityManager, normalize, timeZoneRules};
