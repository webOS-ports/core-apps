// @@@LICENSE
//
//      Copyright (c) 2009-2010 Palm, Inc.
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

/*global enyo, $L, PalmServiceBridge, Tasks:true */

// Namespace, constants and small helpers shared by the launcher and the UI window.
var Tasks = {
	// DB8 kinds. These are the kind names the legacy (Mojo) Tasks app and the
	// EAS / sync services use, so existing task data and account sync keep working.
	TASK_KIND: "com.palm.task:1",
	TASK_KIND_EAS: "com.palm.task.eas:1",
	TASKLIST_KIND: "com.palm.tasklist:1",
	TASKLIST_KIND_ALL: "com.palm.tasklist.alltasks:1",
	TASKLIST_KIND_UNFILED: "com.palm.tasklist.unfiled:1",
	TASKLIST_KIND_EAS: "com.palm.tasklist.eas:1",
	ACCOUNT_KIND: "com.palm.account:1",

	POSITION_STEP: 1000,

	APP_ID: "com.palm.app.tasks",
	DB_SERVICE: "luna://com.palm.db/",
	ACTIVITY_SERVICE: "luna://com.palm.activitymanager/",
	ACCOUNTS_SERVICE: "luna://com.palm.service.accounts/",
	SYSTEM_SERVICE: "luna://com.palm.systemservice/",
	APP_MANAGER_LAUNCH: "luna://com.webos.service.applicationManager/launch",

	PRIORITY_HIGH: 1,
	PRIORITY_NORMAL: 2,
	PRIORITY_LOW: 3
};

Tasks.log = function () {
	if (window.console) {
		console.log("Tasks: " + Array.prototype.join.call(arguments, " "));
	}
};

Tasks.error = function () {
	if (window.console) {
		console.error("Tasks: " + Array.prototype.join.call(arguments, " "));
	}
};

/**
 * Service calls. On the device this goes over the PalmServiceBridge; in a desktop
 * browser the calls are answered by Tasks.MockServices so the app is usable for
 * development without a device.
 *
 * callback(response) is called with the parsed response; response.returnValue is
 * false on failure. Returns a handle with cancel().
 */
Tasks.Service = {
	_pending: {},
	_nextId: 1,

	onDevice: function () {
		return !!window.PalmSystem;
	},

	call: function (uri, params, callback, subscribe) {
		params = params || {};
		if (!this.onDevice()) {
			return Tasks.MockServices.call(uri, params, callback, subscribe);
		}
		var id = this._nextId++, pending = this._pending, done = false;
		var bridge = new PalmServiceBridge();
		pending[id] = bridge;
		bridge.onservicecallback = function (json) {
			var response;
			try {
				response = typeof json === "string" ? JSON.parse(json) : json;
			} catch (e) {
				response = {returnValue: false, errorText: "bad response: " + json};
			}
			response = response || {returnValue: false};
			if (response.errorCode !== undefined && response.returnValue === undefined) {
				response.returnValue = false;
			}
			if (response.returnValue === false) {
				Tasks.error(uri, "failed:", JSON.stringify(response));
			}
			if (!subscribe) {
				delete pending[id];
			}
			if (!done && callback) {
				callback(response);
			}
		};
		bridge.call(uri, JSON.stringify(params));
		return {
			cancel: function () {
				done = true;
				delete pending[id];
				try {
					bridge.cancel();
				} catch (e) {}
			}
		};
	}
};

/**
 * Dates. Like the legacy app (and EAS), a due date is a whole day stored as the
 * UTC midnight timestamp of that calendar day, independent of the local timezone.
 */
Tasks.Dates = {
	DAY: 24 * 60 * 60 * 1000,

	// Local Date -> due timestamp of that calendar day.
	fromLocalDate: function (date) {
		return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
	},

	// Due timestamp -> local Date at midnight of that calendar day.
	toLocalDate: function (due) {
		var d = new Date(due);
		return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
	},

	today: function () {
		return this.fromLocalDate(new Date());
	},

	addDays: function (due, days) {
		return due + days * this.DAY;
	},

	addMonths: function (due, months) {
		var d = new Date(due);
		var target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
		var lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
		return Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d.getUTCDate(), lastDay));
	},

	// Last millisecond of today in due-date terms: anything <= this is due.
	endOfToday: function () {
		return this.today() + this.DAY - 1;
	},

	isDue: function (due) {
		return due !== null && due !== undefined && due <= this.endOfToday();
	},

	isOverdue: function (due) {
		return due !== null && due !== undefined && due < this.today();
	},

	_fmts: {},

	format: function (due, length) {
		if (due === null || due === undefined) {
			return "";
		}
		var today = this.today();
		if (due === today) {
			return $L("Today");
		}
		if (due === this.addDays(today, 1)) {
			return $L("Tomorrow");
		}
		var date = this.toLocalDate(due);
		length = length || "short";
		try {
			if (!this._fmts[length]) {
				this._fmts[length] = new enyo.g11n.DateFmt({date: length});
			}
			return this._fmts[length].format(date);
		} catch (e) {
			return date.toLocaleDateString();
		}
	}
};

Tasks.Priority = {
	name: function (priority) {
		switch (Number(priority)) {
		case Tasks.PRIORITY_HIGH:
			return "high";
		case Tasks.PRIORITY_LOW:
			return "low";
		default:
			return "normal";
		}
	},

	label: function (priority) {
		switch (Number(priority)) {
		case Tasks.PRIORITY_HIGH:
			return $L("High");
		case Tasks.PRIORITY_LOW:
			return $L("Low");
		default:
			return $L("Normal");
		}
	}
};

Tasks.List = {
	isAllTasks: function (list) {
		return !!(list && list._kind === Tasks.TASKLIST_KIND_ALL);
	},

	isUnfiled: function (list) {
		return !!(list && list._kind === Tasks.TASKLIST_KIND_UNFILED);
	},

	// Lists created in this app. Synced (EAS, ...) lists and the two built-in
	// lists can not be renamed or deleted.
	isLocal: function (list) {
		return !!list && (!list._kind || list._kind === Tasks.TASKLIST_KIND);
	},

	displayName: function (list) {
		if (!list) {
			return "";
		}
		if (Tasks.List.isAllTasks(list)) {
			return $L("List all tasks");
		}
		if (Tasks.List.isUnfiled(list)) {
			return $L("Unfiled");
		}
		if (list.name === "Tasks" && list._kind === Tasks.TASKLIST_KIND_EAS) {
			return $L("Exchange");
		}
		return list.name || $L("List name");
	}
};

Tasks.Task = {
	displaySubject: function (task) {
		var subject = (task && task.subject) || "";
		return subject.split("\n")[0] || $L("Task name...");
	}
};

// Enyo escapes control content itself; this is only for building markup for
// controls with allowHtml: true (the search highlights).
Tasks.escapeHtml = function (text) {
	return String(text === undefined || text === null ? "" : text)
		.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
};
