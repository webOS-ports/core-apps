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

/*global enyo, $L, Tasks, PalmSystem */

/**
 * Activities that keep the due counts and the due tasks dashboard current
 * (ported from the legacy ActivityManager):
 *  - when the set of due tasks changes in the database
 *  - at midnight, when tomorrow's tasks become due
 *  - when the system time or timezone changes
 * The boot activity lives in configuration/activities.
 */
Tasks.Activities = {
	create: function (activity) {
		Tasks.Service.call(Tasks.ACTIVITY_SERVICE + "create", {activity: activity, start: true, replace: true, subscribe: false});
	},

	callback: function (params) {
		return {method: Tasks.APP_MANAGER_LAUNCH, params: {id: Tasks.APP_ID, params: params}};
	},

	type: {persist: true, cancellable: true, foreground: true},

	createDbActivity: function () {
		this.create({
			name: "TASKS_DB_CHANGED_ACTIVITY",
			description: "Tasks app activity that fires when due tasks are added, removed or changed",
			type: this.type,
			callback: this.callback({action: "rescheduleDBActivity"}),
			trigger: {
				method: Tasks.DB_SERVICE + "find",
				params: {
					query: {
						from: Tasks.TASK_KIND,
						where: [
							{prop: "completed", op: "=", val: false},
							{prop: "dueDate", op: ">=", val: 0},
							{prop: "dueDate", op: "<=", val: Tasks.Dates.endOfToday()}
						],
						limit: 0
					},
					watch: true,
					count: true
				}
			}
		});
	},

	createMidnightActivity: function () {
		var tomorrow = new Date();
		tomorrow.setDate(tomorrow.getDate() + 1);
		var pad = function (n) {
			return n < 10 ? "0" + n : String(n);
		};
		this.create({
			name: "TASKS_12AM_ACTIVITY",
			description: "Tasks app activity that fires at midnight",
			type: this.type,
			callback: this.callback({action: "rescheduleAMActivity"}),
			schedule: {
				start: tomorrow.getFullYear() + "-" + pad(tomorrow.getMonth() + 1) + "-" + pad(tomorrow.getDate()) + " 00:00:00",
				local: true
			}
		});
	},

	/**
	 * Re-arms the time change activity with the current date, and tells
	 * callback(dateChanged) whether the local date differs from previous.
	 */
	createTimeChangedActivity: function (previous, callback) {
		var self = this;
		Tasks.Service.call(Tasks.SYSTEM_SERVICE + "time/getSystemTime", {}, function (response) {
			if (!response.localtime) {
				return callback && callback(false);
			}
			var now = {
				year: response.localtime.year,
				month: response.localtime.month,
				day: response.localtime.day,
				timezone: response.timezone
			};
			self.create({
				name: "TASKS_TIME_CHANGED_ACTIVITY",
				description: "Tasks app activity that fires when the time or timezone is changed",
				type: self.type,
				callback: self.callback({action: "rescheduleTimeChangedActivity", previousTimeDate: now}),
				trigger: {
					method: Tasks.SYSTEM_SERVICE + "time/getSystemTime",
					params: {subscribe: true}
				}
			});
			var changed = !previous || previous.year !== now.year || previous.month !== now.month ||
				previous.day !== now.day || previous.timezone !== now.timezone;
			if (callback) {
				callback(changed);
			}
		});
	}
};

/**
 * The headless part of the app (index.html; appinfo has noWindow). It handles
 * every launch: it opens the Tasks window, answers the activities above and
 * keeps the dashboard of tasks due today (or overdue).
 */
enyo.kind({
	name: "Tasks.Launcher",
	kind: enyo.Component,
	components: [
		{name: "dashboard", kind: "Dashboard", smallIcon: "images/notification-small.png",
			onMessageTap: "dashboardMessageTap", onIconTap: "dashboardIconTap", onUserClose: "dashboardClosed"}
	],

	create: function () {
		this.inherited(arguments);
		this.db = new Tasks.Db();
		this.dashboardIds = "";
	},

	startup: function () {
		var params = {};
		try {
			params = JSON.parse(window.PalmSystem && PalmSystem.launchParams || "{}") || {};
		} catch (e) {}
		this.handleLaunch(params);
	},

	relaunch: function (params) {
		this.handleLaunch(params || {});
		return true;
	},

	handleLaunch: function (params) {
		Tasks.log("launch", JSON.stringify(params));
		var self = this;
		if (params.taskSubject) {
			this.openWindow({taskSubject: params.taskSubject});
			return;
		}
		switch (params.action) {
		case "createDefaultTasklists":
			// Boot: set up the lists and the activities.
			Tasks.Activities.createDbActivity();
			Tasks.Activities.createMidnightActivity();
			Tasks.Activities.createTimeChangedActivity(null);
			this.init(function () {
				self.updateTotals(true);
			});
			break;
		case "dashboardTap":
			this.openWindow({taskListId: params.taskListId, taskId: params.taskId});
			break;
		case "rescheduleDBActivity":
			Tasks.Activities.createDbActivity();
			this.init(function () {
				self.updateTotals(true);
			});
			break;
		case "rescheduleAMActivity":
			Tasks.Activities.createMidnightActivity();
			Tasks.Activities.createDbActivity();
			this.init(function () {
				self.updateTotals(true);
			});
			break;
		case "rescheduleTimeChangedActivity":
			Tasks.Activities.createTimeChangedActivity(params.previousTimeDate, function (dateChanged) {
				Tasks.Activities.createMidnightActivity();
				Tasks.Activities.createDbActivity();
				self.init(function () {
					self.updateTotals(dateChanged);
				});
			});
			break;
		default:
			this.openWindow(params);
		}
	},

	init: function (callback) {
		var self = this;
		this.db.mapAccounts(function () {
			self.db.checkTaskLists(callback);
		});
	},

	openWindow: function (params) {
		enyo.windows.activate("main.html", "tasks", params || {});
	},

	// Recounts due tasks and shows them in the dashboard. The dashboard is only
	// brought back when the set of due tasks changed since it was last shown.
	updateTotals: function (showDashboard) {
		var self = this;
		this.db.updateTotals(function (err, dueTasks) {
			if (err || !showDashboard) {
				return;
			}
			self.showDashboard(dueTasks || []);
		});
	},

	showDashboard: function (dueTasks) {
		var ids = dueTasks.map(function (t) {
			return t._id;
		}).join(",");
		if (!dueTasks.length) {
			this.$.dashboard.setLayers([]);
		} else if (ids !== this.dashboardIds) {
			this.$.dashboard.setLayers(dueTasks.map(function (t) {
				return {
					icon: "images/notification-large.png",
					title: Tasks.Task.displaySubject(t),
					text: t.taskListName,
					taskId: t._id,
					taskListId: t.taskListId
				};
			}));
		}
		this.dashboardIds = ids;
	},

	dashboardMessageTap: function (inSender, inLayer) {
		this.openWindow({taskListId: inLayer.taskListId, taskId: inLayer.taskId});
	},

	dashboardIconTap: function (inSender, inLayer) {
		var layers = this.$.dashboard.layers || [];
		var params = {taskListId: inLayer.taskListId};
		if (layers.length === 1) {
			params.taskId = inLayer.taskId;
		}
		this.openWindow(params);
	},

	dashboardClosed: function () {
		// Keep dashboardIds so the same set of tasks is not shown again.
	}
});
