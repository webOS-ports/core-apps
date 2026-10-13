// @@@LICENSE
//
//      Copyright (c) 2010 Palm, Inc.
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

/*global enyo, Tasks */

/**
 * DB8 access for tasks and task lists; the Enyo port of the legacy app's
 * DatabaseManager. Every method takes a node style callback(error, result).
 *
 * Conventions kept from the legacy app so data written by it (and by the EAS
 * sync) keeps working:
 *  - taskListId === null means the task is in the "Unfiled" list.
 *  - "All tasks" is a com.palm.tasklist.alltasks:1 object that only carries the
 *    total due count; it holds no tasks.
 *  - A task synced by an account uses the task kind that account's TASKS
 *    capability provider declares (e.g. com.palm.task.eas:1). Moving a task to a
 *    list of another account deletes it and re-creates it with the new kind.
 *  - Lists are ordered by position descending, tasks by position ascending.
 */
Tasks.Db = function () {
	this.unfiledId = null;
	this.allTasksId = null;
	this.accounts = {};	// accountId -> {taskKind, icon, local}
};

Tasks.Db.prototype = {
	// ---------------------------------------------------------------- plumbing

	call: function (method, params, callback) {
		return Tasks.Service.call(Tasks.DB_SERVICE + method, params, function (response) {
			if (!callback) {
				return;
			}
			if (response.returnValue === false) {
				callback(response);
			} else {
				callback(null, response);
			}
		});
	},

	// find, following "next" pages until everything is loaded.
	findAll: function (query, callback, results) {
		var self = this;
		results = results || [];
		this.call("find", {query: query}, function (err, response) {
			if (err) {
				return callback(err);
			}
			results = results.concat(response.results || []);
			if (response.next && response.results && response.results.length) {
				var next = enyo.mixin({}, query);
				next.page = response.next;
				self.findAll(next, callback, results);
			} else {
				callback(null, results);
			}
		});
	},

	/**
	 * Calls callback() every time something matching query changes, until the
	 * returned handle is cancelled.
	 *
	 * No limit on the query: DB8 only fires a watch when the page of results it
	 * returned changes, so a limit of 1 misses changes to every other object.
	 */
	watch: function (query, callback) {
		var self = this, request = null, cancelled = false;
		var arm = function () {
			if (cancelled) {
				return;
			}
			if (request) {
				// A watch fires once; free the spent request before the next one.
				request.cancel();
			}
			request = Tasks.Service.call(Tasks.DB_SERVICE + "find", {
				query: enyo.mixin({select: ["_id"]}, query),
				watch: true
			}, function (response) {
				if (response.fired && !cancelled) {
					arm();
					callback();
				}
			}, true);
		};
		arm();
		return {
			cancel: function () {
				cancelled = true;
				if (request) {
					request.cancel();
				}
			}
		};
	},

	// ---------------------------------------------------------------- accounts

	/**
	 * Maps account ids to the task kind their sync uses and their icon.
	 * The local (Palm profile) account may be missing on LuneOS; local lists
	 * then simply carry no accountId.
	 */
	mapAccounts: function (callback) {
		var self = this;
		Tasks.Service.call(Tasks.ACCOUNTS_SERVICE + "listAccounts", {capability: "TASKS"}, function (response) {
			var accounts = {};
			(response.results || []).forEach(function (account) {
				if (account.templateId === "com.palm.palmprofile") {
					accounts[account._id] = {taskKind: Tasks.TASK_KIND, local: true};
					return;
				}
				(account.capabilityProviders || []).forEach(function (provider) {
					if (provider.capability === "TASKS") {
						accounts[account._id] = {
							taskKind: provider.subKind || provider.dbkinds && provider.dbkinds.task,
							icon: provider.icon && (provider.icon.loc_32x32 || provider.icon.loc_48x48) ||
								account.icon && (account.icon.loc_32x32 || account.icon.loc_48x48),
							local: false
						};
					}
				});
			});
			self.accounts = accounts;
			if (callback) {
				callback(null, accounts);
			}
		});
	},

	localAccountId: function () {
		for (var id in this.accounts) {
			if (this.accounts.hasOwnProperty(id) && this.accounts[id].local) {
				return id;
			}
		}
		return null;
	},

	iconForList: function (list) {
		var account = list && list.accountId && this.accounts[list.accountId];
		if (account && account.icon) {
			return account.icon;
		}
		if (list && list._kind === Tasks.TASKLIST_KIND_EAS) {
			return "images/icon-exchange.png";
		}
		return "";
	},

	// The task kind for tasks stored on the given list.
	taskKindForList: function (list) {
		if (!list || !list._kind || list._kind === Tasks.TASKLIST_KIND ||
				list._kind === Tasks.TASKLIST_KIND_UNFILED || list._kind === Tasks.TASKLIST_KIND_ALL) {
			return Tasks.TASK_KIND;
		}
		var account = list.accountId && this.accounts[list.accountId];
		if (account && account.taskKind) {
			return account.taskKind;
		}
		// e.g. com.palm.tasklist.eas:1 -> com.palm.task.eas:1
		return list._kind.replace("com.palm.tasklist", "com.palm.task");
	},

	// ---------------------------------------------------------------- lists

	/**
	 * Makes sure the Unfiled and All tasks lists exist and remembers their ids.
	 */
	checkTaskLists: function (callback) {
		var self = this;
		if (this.unfiledId && this.allTasksId) {
			return callback && callback(null);
		}
		this.call("batch", {operations: [
			{method: "find", params: {query: {from: Tasks.TASKLIST_KIND_UNFILED}}},
			{method: "find", params: {query: {from: Tasks.TASKLIST_KIND_ALL}}}
		]}, function (err, response) {
			if (err) {
				return callback && callback(err);
			}
			var unfiled = response.responses[0].results || [], all = response.responses[1].results || [];
			var create = [];
			if (unfiled.length) {
				self.unfiledId = unfiled[0]._id;
			} else {
				create.push({_kind: Tasks.TASKLIST_KIND_UNFILED, name: "Unfiled", position: 0,
					order: "position", show: "all", visible: false, dueItemCount: 0});
			}
			if (all.length) {
				self.allTasksId = all[0]._id;
			} else {
				create.push({_kind: Tasks.TASKLIST_KIND_ALL, name: "List all tasks", position: Tasks.POSITION_STEP,
					order: "position", show: "all", visible: false, dueItemCount: 0});
			}
			if (!create.length) {
				return callback && callback(null);
			}
			var accountId = self.localAccountId();
			create.forEach(function (list) {
				if (accountId) {
					list.accountId = accountId;
				}
			});
			self.call("put", {objects: create}, function (err, put) {
				if (err) {
					return callback && callback(err);
				}
				create.forEach(function (list, i) {
					if (list._kind === Tasks.TASKLIST_KIND_UNFILED) {
						self.unfiledId = put.results[i].id;
					} else {
						self.allTasksId = put.results[i].id;
					}
				});
				if (callback) {
					callback(null);
				}
			});
		});
	},

	_fixupList: function (list) {
		// Very old data stored "show:order" in show.
		var parts = (list.show || "").split(":");
		list.show = parts[0] || "all";
		list.order = list.order || parts[1] || "position";
		if (list.order === "dueDate") {
			list.order = "duedate";
		}
		list.icon = this.iconForList(list);
		return list;
	},

	/**
	 * callback(err, {lists, unfiled, allTasks}); lists are the visible lists in
	 * display order, unfiled/allTasks the built-in lists.
	 */
	getTaskLists: function (callback) {
		var self = this;
		this.checkTaskLists(function () {
			self.call("batch", {operations: [
				{method: "find", params: {query: {from: Tasks.TASKLIST_KIND, where: [{prop: "visible", op: "=", val: true}],
					orderBy: "position", desc: true}}},
				{method: "find", params: {query: {from: Tasks.TASKLIST_KIND_UNFILED}}},
				{method: "find", params: {query: {from: Tasks.TASKLIST_KIND_ALL}}}
			]}, function (err, response) {
				if (err) {
					return callback(err);
				}
				var lists = (response.responses[0].results || []).filter(function (list) {
					return !Tasks.List.isUnfiled(list) && !Tasks.List.isAllTasks(list);
				}).map(self._fixupList, self);
				var unfiled = response.responses[1].results[0];
				var allTasks = response.responses[2].results[0];
				callback(null, {
					lists: lists,
					unfiled: unfiled && self._fixupList(unfiled),
					allTasks: allTasks && self._fixupList(allTasks)
				});
			});
		});
	},

	getTaskList: function (id, callback) {
		var self = this;
		this.call("get", {ids: [id]}, function (err, response) {
			var list = !err && response.results && response.results[0];
			callback(list ? null : (err || {errorText: "list not found"}), list && self._fixupList(list));
		});
	},

	/**
	 * Creates (no _id) or updates a list. New lists are local lists.
	 * callback(err, id)
	 */
	saveTaskList: function (list, callback) {
		var object = {
			name: list.name || "",
			show: list.show || "all",
			order: list.order || "position"
		};
		if (list.position !== undefined) {
			object.position = list.position;
		}
		if (list._id) {
			object._id = list._id;
			this.call("merge", {objects: [object]}, function (err) {
				if (callback) {
					callback(err, list._id);
				}
			});
		} else {
			object._kind = Tasks.TASKLIST_KIND;
			object.visible = true;
			object.dueItemCount = 0;
			object.position = list.position || Date.now();
			var accountId = this.localAccountId();
			if (accountId) {
				object.accountId = accountId;
			}
			this.call("put", {objects: [object]}, function (err, response) {
				if (callback) {
					callback(err, !err && response.results[0].id);
				}
			});
		}
	},

	// Deletes a list and every task on it.
	deleteTaskList: function (list, callback) {
		this.call("batch", {operations: [
			{method: "del", params: {query: {from: Tasks.TASK_KIND, where: [this._listClause(list)]}}},
			{method: "del", params: {ids: [list._id]}}
		]}, callback);
	},

	// Stores new list positions: [{_id, position}]
	setPositions: function (objects, callback) {
		if (!objects.length) {
			return callback && callback(null);
		}
		this.call("merge", {objects: objects}, callback);
	},

	// Shows Unfiled in the list of lists only while it holds tasks.
	checkUnfiledVisibility: function (callback) {
		var self = this;
		this.checkTaskLists(function () {
			self.call("find", {query: {from: Tasks.TASK_KIND, where: [{prop: "taskListId", op: "=", val: null}], limit: 1},
				count: true}, function (err, response) {
				var visible = !err && response.count > 0;
				self.call("merge", {objects: [{_id: self.unfiledId, visible: visible}]}, function () {
					if (callback) {
						callback(null, visible);
					}
				});
			});
		});
	},

	// ---------------------------------------------------------------- tasks

	// where clause selecting the tasks of a list (undefined for All tasks).
	_listClause: function (list) {
		if (!list || Tasks.List.isAllTasks(list)) {
			return undefined;
		}
		return {prop: "taskListId", op: "=", val: Tasks.List.isUnfiled(list) || list._id === this.unfiledId ? null : list._id};
	},

	_fixupTask: function (task) {
		task.completed = task.completed === true || task.completed === "1" || task.completed === 1;
		task.dueDate = task.dueDate === undefined || task.dueDate === null || task.dueDate === "" ? null : Number(task.dueDate);
		task.priority = Number(task.priority) || Tasks.PRIORITY_NORMAL;
		task.position = task.position === undefined || task.position === null ? null : Number(task.position);
		task.subject = task.subject || "";
		task.notes = task.notes || "";
		if (task.taskListId === undefined) {
			task.taskListId = null;
		}
		return task;
	},

	/**
	 * All tasks of a list sorted by order ("position", "duedate" or "priority").
	 * Tasks synced without a position get one after the last known position, like
	 * the legacy app did.
	 */
	getTasks: function (list, order, callback) {
		var self = this;
		var query = {from: Tasks.TASK_KIND};
		var clause = this._listClause(list);
		if (clause) {
			query.where = [clause];
		}
		query.orderBy = order === "duedate" ? "dueDate" : order === "priority" ? "priority" : "position";
		this.findAll(query, function (err, tasks) {
			if (err) {
				return callback(err);
			}
			tasks = tasks.map(self._fixupTask, self);
			self._attachPositions(tasks);
			if (order === "duedate") {
				// Dated tasks first (earliest first), then undated ones in position order.
				var dated = tasks.filter(function (t) {
					return t.dueDate !== null;
				}), undated = tasks.filter(function (t) {
					return t.dueDate === null;
				});
				undated.sort(function (a, b) {
					return a.position - b.position;
				});
				tasks = dated.concat(undated);
			} else if (order === "priority") {
				tasks.sort(function (a, b) {
					return a.priority - b.priority || a.position - b.position;
				});
			} else {
				tasks.sort(function (a, b) {
					return a.position - b.position;
				});
			}
			callback(null, tasks);
		});
	},

	_attachPositions: function (tasks) {
		var highest = 0, missing = [];
		tasks.forEach(function (t) {
			if (t.position) {
				highest = Math.max(highest, t.position);
			}
		});
		tasks.forEach(function (t) {
			if (!t.position) {
				highest += Tasks.POSITION_STEP;
				t.position = highest;
				missing.push({_id: t._id, position: t.position});
			}
		});
		if (missing.length) {
			this.setPositions(missing);
		}
	},

	getTask: function (id, callback) {
		var self = this;
		this.call("get", {ids: [id]}, function (err, response) {
			var task = !err && response.results && response.results[0];
			callback(task ? null : (err || {errorText: "task not found"}), task && self._fixupTask(task));
		});
	},

	// Next free position at the end of a list.
	nextPosition: function (list, callback) {
		var query = {from: Tasks.TASK_KIND, orderBy: "position", desc: true, limit: 1};
		var clause = this._listClause(list);
		if (clause) {
			query.where = [clause];
		}
		this.call("find", {query: query}, function (err, response) {
			var last = !err && response.results && response.results[0];
			callback(null, (last && Number(last.position) || 0) + Tasks.POSITION_STEP);
		});
	},

	/**
	 * Creates or updates a task. task.taskListId selects the list (null for
	 * Unfiled). callback(err, id)
	 */
	saveTask: function (task, callback) {
		var self = this;
		var listId = task.taskListId && task.taskListId !== this.unfiledId ? task.taskListId : null;
		var object = {
			subject: task.subject || "",
			notes: task.notes || "",
			completed: !!task.completed,
			completedDate: task.completed ? (task.completedDate || Date.now()) : null,
			priority: Number(task.priority) || Tasks.PRIORITY_NORMAL,
			dueDate: task.dueDate === undefined ? null : task.dueDate,
			taskListId: listId
		};
		if (task.position !== undefined && task.position !== null) {
			object.position = task.position;
		}
		var operations = [];
		if (listId) {
			operations.push({method: "get", params: {ids: [listId]}});
		}
		if (task._id) {
			operations.push({method: "get", params: {ids: [task._id]}});
		}
		var done = function (err, response) {
			if (callback) {
				callback(err, !err && response.results[0].id);
			}
		};
		var save = function (list, existing) {
			var kind = self.taskKindForList(list);
			if (existing && existing._kind === kind) {
				object._id = existing._id;
				self.call("merge", {objects: [object]}, done);
			} else if (existing) {
				// Moving between accounts: the task has to change kind.
				var moved = enyo.mixin({}, existing);
				delete moved._id;
				delete moved._rev;
				delete moved._sync;
				moved = enyo.mixin(moved, object);
				moved._kind = kind;
				self.call("del", {ids: [existing._id]}, function () {
					self.call("put", {objects: [moved]}, done);
				});
			} else {
				object._kind = kind;
				self.call("put", {objects: [object]}, done);
			}
		};
		if (!operations.length) {
			return save(null, null);
		}
		this.call("batch", {operations: operations}, function (err, response) {
			if (err) {
				return callback && callback(err);
			}
			var list = listId ? response.responses[0].results[0] : null;
			var existing = task._id ? response.responses[operations.length - 1].results[0] : null;
			save(list, existing);
		});
	},

	deleteTask: function (id, callback) {
		this.call("del", {ids: [id]}, callback);
	},

	_bulkQuery: function (list, where) {
		var clause = this._listClause(list);
		return {from: Tasks.TASK_KIND, where: (clause ? [clause] : []).concat(where)};
	},

	purgeCompletedTasks: function (list, callback) {
		this.call("del", {query: this._bulkQuery(list, [{prop: "completed", op: "=", val: true}])}, callback);
	},

	setAllCompleted: function (list, completed, callback) {
		this.call("merge", {
			query: this._bulkQuery(list, [{prop: "completed", op: "=", val: !completed}]),
			props: {completed: completed, completedDate: completed ? Date.now() : null}
		}, callback);
	},

	setAllDueDate: function (list, dueDate, callback) {
		this.call("merge", {query: this._bulkQuery(list, []), props: {dueDate: dueDate}}, callback);
	},

	// ---------------------------------------------------------------- due tasks

	// Open tasks due today or earlier, each with its taskListName.
	getDueTasks: function (callback) {
		var self = this;
		this.checkTaskLists(function () {
			self.findAll({from: Tasks.TASK_KIND, where: [
				{prop: "completed", op: "=", val: false},
				{prop: "dueDate", op: ">=", val: 0},
				{prop: "dueDate", op: "<=", val: Tasks.Dates.endOfToday()}
			]}, function (err, tasks) {
				if (err) {
					return callback(err);
				}
				tasks = tasks.map(self._fixupTask, self);
				var listIds = [];
				tasks.forEach(function (t) {
					t.taskListId = t.taskListId || self.unfiledId;
					if (listIds.indexOf(t.taskListId) < 0) {
						listIds.push(t.taskListId);
					}
				});
				if (!tasks.length) {
					return callback(null, tasks);
				}
				self.call("get", {ids: listIds}, function (err, response) {
					var names = {};
					((response && response.results) || []).forEach(function (list) {
						names[list._id] = Tasks.List.displayName(list);
					});
					tasks.forEach(function (t) {
						t.taskListName = names[t.taskListId] || "";
					});
					tasks.sort(function (a, b) {
						return a.dueDate - b.dueDate || a.priority - b.priority;
					});
					callback(null, tasks);
				});
			});
		});
	},

	/**
	 * Recounts the tasks due per list and stores them as dueItemCount on the
	 * lists (and the total on All tasks). callback(err, dueTasks)
	 */
	updateTotals: function (callback) {
		var self = this;
		this.getDueTasks(function (err, dueTasks) {
			if (err) {
				return callback && callback(err);
			}
			self.findAll({from: Tasks.TASKLIST_KIND}, function (err, lists) {
				if (err) {
					return callback && callback(err);
				}
				var totals = {}, changed = [];
				dueTasks.forEach(function (t) {
					totals[t.taskListId] = (totals[t.taskListId] || 0) + 1;
				});
				lists.forEach(function (list) {
					var count = Tasks.List.isAllTasks(list) ? dueTasks.length : (totals[list._id] || 0);
					if (list.dueItemCount !== count) {
						changed.push({_id: list._id, dueItemCount: count});
					}
				});
				self.setPositions(changed, function () {
					if (callback) {
						callback(null, dueTasks);
					}
				});
			});
		});
	}
};
