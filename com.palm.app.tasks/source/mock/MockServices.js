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

/*global Tasks, localStorage */

/**
 * Desktop stand-in for the services the app uses, so Tasks runs in a desktop
 * browser (index-desktop.html). Only used when there is no window.PalmSystem.
 *
 * The DB8 part is a small in-memory database stored in localStorage. It covers
 * the subset of find/get/put/merge/del/batch the app uses, including kind
 * inheritance, where clauses, ordering, counts and watches. Like DB8, a watch
 * fires only for changes to the page of results it returned (or to objects
 * that would join a page that is not full).
 */
Tasks.MockServices = {
	storageKey: "com.palm.app.tasks.mockdb",
	parents: {
		"com.palm.task.eas:1": "com.palm.task:1",
		"com.palm.tasklist.eas:1": "com.palm.tasklist:1",
		"com.palm.tasklist.unfiled:1": "com.palm.tasklist:1",
		"com.palm.tasklist.alltasks:1": "com.palm.tasklist:1"
	},
	watches: [],

	call: function (uri, params, callback, subscribe) {
		var self = this, cancelled = false;
		var parts = uri.replace(/^(luna|palm):\/\//, "").split("/");
		var service = parts.shift(), method = parts.join("/");
		setTimeout(function () {
			if (cancelled) {
				return;
			}
			var response;
			try {
				response = self.handle(service, method, params, callback);
			} catch (e) {
				response = {returnValue: false, errorText: String(e)};
			}
			if (response && callback) {
				callback(response);
			}
		}, 0);
		return {
			cancel: function () {
				cancelled = true;
				self.watches = self.watches.filter(function (w) {
					return w.callback !== callback;
				});
			}
		};
	},

	handle: function (service, method, params, callback) {
		if (service === "com.palm.db") {
			var response = this.db(method, params);
			if (method === "find" && params.watch) {
				var limit = params.query.limit === undefined ? 500 : params.query.limit;
				this.watches.push({query: params.query, callback: callback, full: response.results.length >= limit,
					ids: response.results.map(function (o) {
						return o._id;
					})});
			}
			return response;
		}
		if (service === "com.palm.service.accounts" && method === "listAccounts") {
			return {returnValue: true, results: []};
		}
		if (service === "com.palm.systemservice" && method === "time/getSystemTime") {
			var now = new Date();
			return {
				returnValue: true,
				utc: Math.floor(now.getTime() / 1000),
				localtime: {year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate(),
					hour: now.getHours(), minute: now.getMinutes(), second: now.getSeconds()},
				timezone: "local"
			};
		}
		Tasks.log("mock service call", service, method, JSON.stringify(params));
		return {returnValue: true};
	},

	// ---- storage

	load: function () {
		if (!this.data) {
			try {
				this.data = JSON.parse(localStorage.getItem(this.storageKey) || "null");
			} catch (e) {
				this.data = null;
			}
			this.data = this.data || {objects: {}, nextId: 1, rev: 1};
		}
		return this.data;
	},

	save: function () {
		try {
			localStorage.setItem(this.storageKey, JSON.stringify(this.data));
		} catch (e) {}
	},

	// touched: the changed objects, as they were before and after the change.
	changed: function (touched) {
		var fire = [], self = this;
		this.watches = this.watches.filter(function (w) {
			var hit = touched.some(function (o) {
				return self.isKindOf(o._kind, w.query.from) && (w.ids.indexOf(o._id) >= 0 ||
					!w.full && (w.query.where || []).every(function (c) {
						return self.match(o, c);
					}));
			});
			if (hit) {
				fire.push(w.callback);
			}
			return !hit;
		});
		setTimeout(function () {
			fire.forEach(function (cb) {
				cb({returnValue: true, fired: true});
			});
		}, 0);
	},

	isKindOf: function (kind, from) {
		while (kind) {
			if (kind === from) {
				return true;
			}
			kind = this.parents[kind];
		}
		return false;
	},

	// ---- queries

	match: function (obj, clause) {
		var v = obj[clause.prop], val = clause.val;
		if (v === undefined) {
			v = null;
		}
		switch (clause.op) {
		case "=":
			return Array.isArray(val) ? val.indexOf(v) >= 0 : v === val;
		case "!=":
			return v !== val;
		case "<":
			return v !== null && v < val;
		case "<=":
			return v !== null && v <= val;
		case ">":
			return v !== null && v > val;
		case ">=":
			return v !== null && v >= val;
		case "%":
			return typeof v === "string" && v.toLowerCase().indexOf(String(val).toLowerCase()) === 0;
		case "?":
			return typeof v === "string" && v.toLowerCase().indexOf(String(val).toLowerCase()) >= 0;
		}
		return false;
	},

	query: function (query) {
		var data = this.load(), self = this, results = [];
		Object.keys(data.objects).forEach(function (id) {
			var o = data.objects[id];
			if (self.isKindOf(o._kind, query.from) && (query.where || []).every(function (c) {
				return self.match(o, c);
			})) {
				results.push(JSON.parse(JSON.stringify(o)));
			}
		});
		if (query.orderBy) {
			var key = query.orderBy, dir = query.desc ? -1 : 1;
			results.sort(function (a, b) {
				var x = a[key] === undefined ? null : a[key], y = b[key] === undefined ? null : b[key];
				if (x === y) {
					return a._id < b._id ? -1 : 1;
				}
				if (x === null) {
					return -dir;
				}
				if (y === null) {
					return dir;
				}
				return (x < y ? -1 : 1) * dir;
			});
		}
		return results;
	},

	// ---- db methods

	db: function (method, params) {
		var data = this.load(), self = this, results, touched = [];
		switch (method) {
		case "find":
		case "search":
			results = this.query(params.query);
			var start = Number(params.query.page || 0), limit = params.query.limit === undefined ? 500 : params.query.limit;
			var response = {returnValue: true, results: results.slice(start, start + limit)};
			if (start + limit < results.length) {
				response.next = String(start + limit);
			}
			if (params.count) {
				response.count = results.length;
			}
			return response;
		case "get":
			return {returnValue: true, results: (params.ids || []).map(function (id) {
				return data.objects[id];
			}).filter(Boolean)};
		case "put":
			results = params.objects.map(function (o) {
				o = JSON.parse(JSON.stringify(o));
				o._id = o._id || ("mock" + (data.nextId++));
				o._rev = data.rev++;
				data.objects[o._id] = o;
				touched.push(o);
				return {id: o._id, rev: o._rev};
			});
			break;
		case "merge":
			var targets = params.objects || this.query(params.query).map(function (o) {
				var m = JSON.parse(JSON.stringify(params.props));
				m._id = o._id;
				return m;
			});
			results = targets.map(function (m) {
				var o = data.objects[m._id];
				if (!o) {
					return {id: m._id, rev: -1};
				}
				touched.push(JSON.parse(JSON.stringify(o)));
				Object.keys(m).forEach(function (k) {
					o[k] = m[k];
				});
				o._rev = data.rev++;
				touched.push(o);
				return {id: o._id, rev: o._rev};
			});
			if (!params.objects) {
				this.save();
				this.changed(touched);
				return {returnValue: true, count: results.length};
			}
			break;
		case "del":
			var ids = params.ids || this.query(params.query).map(function (o) {
				return o._id;
			});
			ids.forEach(function (id) {
				if (data.objects[id]) {
					touched.push(data.objects[id]);
					delete data.objects[id];
				}
			});
			this.save();
			this.changed(touched);
			return params.ids ? {returnValue: true, results: ids.map(function (id) {
				return {id: id};
			})} : {returnValue: true, count: ids.length};
		case "batch":
			return {returnValue: true, responses: params.operations.map(function (op) {
				return self.db(op.method, op.params);
			})};
		default:
			return {returnValue: true};
		}
		this.save();
		this.changed(touched);
		return {returnValue: true, results: results};
	}
};
