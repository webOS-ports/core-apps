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

/*global enyo, $L, Tasks */

/**
 * The tasks of one list (the legacy "tasks" scene): editable list name, sort
 * order (My Order / Due Date / Priority), search, inline task editing, swipe to
 * delete, hold and drag to reorder, and the list commands.
 */
enyo.kind({
	name: "Tasks.TasksView",
	kind: enyo.SlidingView,
	className: "tasks-tasks-view",
	published: {
		db: null,
		list: null,
		selectedTaskId: null,
		singleView: false
	},
	events: {
		onOpenTask: "",
		onBack: "",
		onListSaved: "",
		onListDeleted: "",
		onTasksChanged: ""
	},
	components: [
		{kind: "Header", className: "tasks-header tasks-list-header", components: [
			{name: "backButton", kind: "Button", className: "tasks-back-button", caption: " ", onclick: "doBack", showing: false},
			{name: "name", kind: "Input", flex: 1, className: "tasks-list-title-input",
				hint: $L("List name"), autoCapitalize: "title", onchange: "nameChange", onkeypress: "nameKeypress"},
			{name: "icon", kind: "Image", className: "tasks-list-icon", showing: false},
			{name: "order", kind: "ListSelector", className: "tasks-order-selector", onChange: "orderChange", items: [
				{caption: $L("My Order"), value: "position"},
				{caption: $L("Due Date"), value: "duedate"},
				{caption: $L("Priority"), value: "priority"}
			]}
		]},
		{className: "tasks-search", components: [
			{name: "filter", kind: "RoundedSearchInput", hint: $L("Search tasks"), onchange: "filterChange", onCancel: "filterChange"}
		]},
		{name: "scroller", kind: "Scroller", flex: 1, className: "tasks-paper", components: [
			{name: "rows", kind: "Tasks.ReorderList", onReorder: "rowsReordered"},
			{name: "empty", className: "tasks-empty-hint", showing: false},
			{className: "tasks-list-end", onclick: "addTask"}
		]},
		{kind: "Toolbar", className: "tasks-toolbar", components: [
			{kind: "GrabButton"},
			{kind: "Spacer"},
			{icon: "images/icon-new-task.png", className: "tasks-new-task-button", onclick: "addTask"},
			{kind: "Spacer"},
			{name: "menuButton", caption: "\u2022\u2022\u2022", className: "tasks-menu-button", onclick: "openListMenu"}
		]},
		{name: "listMenu", kind: "Menu", components: [
			{name: "menuSetDue", caption: $L("Set due date for all..."), onclick: "setDueForAll"},
			{name: "menuMarkComplete", caption: $L("Mark all completed"), onclick: "markAllCompleted"},
			{name: "menuMarkIncomplete", caption: $L("Mark all incomplete"), onclick: "markAllIncomplete"},
			{name: "menuShowCompleted", caption: $L("Hide Completed"), onclick: "toggleShowCompleted"},
			{name: "menuPurge", caption: $L("Delete completed tasks"), onclick: "purgeCompleted"},
			{name: "menuDeleteList", caption: $L("Delete list"), onclick: "deleteList"}
		]},
		{name: "confirm", kind: "Tasks.ConfirmDialog"},
		{name: "dueDialog", kind: "Tasks.DueDateDialog"}
	],

	create: function () {
		this.inherited(arguments);
		this.tasks = [];
		this.nextNewId = 1;
		this.singleViewChanged();
	},

	// Devices have the back gesture; a desktop browser gets a button.
	singleViewChanged: function () {
		this.$.backButton.setShowing(this.singleView && !Tasks.Service.onDevice());
	},

	// ------------------------------------------------------------ list

	listChanged: function (inOld) {
		var list = this.list;
		if (inOld && list && inOld._id === list._id && inOld !== list) {
			// Same list, fresh data (e.g. new due counts): keep the view state.
			this.updateHeader();
			return;
		}
		this.$.filter.setValue("");
		this.tasks = [];
		this.renderRows();
		this.updateHeader();
		if (list) {
			this.reload();
		}
	},

	updateHeader: function () {
		var list = this.list || {}, local = Tasks.List.isLocal(list);
		this.$.name.setValue(Tasks.List.displayName(list) === $L("List name") && !list.name ? "" : Tasks.List.displayName(list));
		this.$.name.setDisabled(!local);
		this.$.name.addRemoveClass("tasks-readonly", !local);
		this.$.icon.setSrc(list.icon || "");
		this.$.icon.setShowing(!!list.icon);
		this.$.order.setValue(list.order || "position");
		this.updateMenu();
		this.$.empty.setContent(list._id || Tasks.List.isAllTasks(list) ? $L("No tasks. Tap + to add one.") : $L("Name the list, then tap + to add tasks."));
	},

	// The menu is created lazily, on first open.
	updateMenu: function () {
		var list = this.list || {};
		if (this.$.menuShowCompleted) {
			this.$.menuShowCompleted.setCaption(list.show === "remaining" ? $L("Show Completed") : $L("Hide Completed"));
			this.$.menuDeleteList.setShowing(Tasks.List.isLocal(list));
		}
	},

	focusName: function () {
		this.$.name.forceFocus();
	},

	nameChange: function () {
		var name = enyo.string.trim(this.$.name.getValue() || "");
		if (!Tasks.List.isLocal(this.list) || name === this.list.name) {
			return;
		}
		if (!name) {
			// A list keeps its name; an emptied field shows it again.
			this.$.name.setValue(this.list.name || "");
			return;
		}
		this.list.name = name;
		this.saveList();
	},

	nameKeypress: function (inSender, inEvent) {
		if (inEvent.keyCode === 13) {
			inEvent.preventDefault();
			this.nameChange();
			this.addTask();
			return true;
		}
	},

	// Saves the list; creates it first when it is a new list.
	saveList: function (callback) {
		var self = this, list = this.list;
		if (!list || !Tasks.List.isLocal(list)) {
			return callback && callback();
		}
		if (list._creating) {
			// A new list is being created: wait for it instead of creating it twice.
			list._creating.push(function () {
				self.saveList(callback);
			});
			return;
		}
		if (!list.name) {
			list.name = enyo.string.trim(this.$.name.getValue() || "") || $L("List name");
		}
		var waiting = list._id ? null : (list._creating = []);
		this.db.saveTaskList(list, function (err, id) {
			if (!err && !list._id) {
				list._id = id;
				list._kind = Tasks.TASKLIST_KIND;
				if (list === self.list) {
					self.updateHeader();
				}
			}
			delete list._creating;
			self.doListSaved(list);
			if (callback) {
				callback();
			}
			(waiting || []).forEach(function (fn) {
				fn();
			});
		});
	},

	orderChange: function () {
		this.list.order = this.$.order.getValue();
		this.commitEditing();
		this.renderRows();
		this.reload();
		if (this.list._id) {
			this.saveList();
		}
	},

	// ------------------------------------------------------------ loading

	// Reloads the tasks from the database. While a subject is being edited the
	// reload waits until editing ends, so typing is never interrupted.
	reload: function () {
		var self = this, list = this.list;
		if (this.editingRow()) {
			this.needsReload = true;
			return;
		}
		this.needsReload = false;
		if (!list || (!list._id && !Tasks.List.isAllTasks(list))) {
			this.tasks = [];
			this.renderRows();
			return;
		}
		this.db.getTasks(list, list.order || "position", function (err, tasks) {
			// Compare ids: every task change reloads the lists, which replaces
			// this.list with a fresh copy of the same list while this runs.
			if (!self.list || self.list._id !== list._id) {
				return;
			}
			if (self.editingRow()) {
				self.needsReload = true;
				return;
			}
			// Keep a new, still empty task that is being typed.
			var pending = self.tasks.filter(function (t) {
				return !t._id;
			});
			self.tasks = (tasks || []).concat(pending);
			self.renderRows();
		});
	},

	editingRow: function () {
		var rows = this.$.rows.getControls();
		for (var i = 0; i < rows.length; i++) {
			if (rows[i].hasFocus && rows[i].hasFocus()) {
				return rows[i];
			}
		}
		return null;
	},

	visibleTasks: function () {
		var filter = (this.$.filter.getValue() || "").toLowerCase();
		var remaining = this.list && this.list.show === "remaining";
		return this.tasks.filter(function (t) {
			if (!t._id) {
				return !filter;
			}
			if (remaining && t.completed && !t._fading) {
				return false;
			}
			return !filter || (t.subject || "").toLowerCase().indexOf(filter) >= 0;
		});
	},

	renderRows: function () {
		var rows = this.$.rows, tasks = this.visibleTasks(), filter = this.$.filter.getValue() || "";
		var order = this.list && this.list.order, lastGroup = null, index = 0;
		rows.destroyControls();
		tasks.forEach(function (task) {
			if (order === "priority" && task._id) {
				var group = Tasks.Priority.name(task.priority);
				if (group !== lastGroup) {
					rows.createComponent({kind: "Divider", caption: Tasks.Priority.label(task.priority)});
					lastGroup = group;
				}
			}
			rows.createComponent({
				kind: "Tasks.TaskRow",
				task: task,
				rowIndex: index++,
				highlight: filter,
				reorderable: !!task._id,
				className: "tasks-task-row" + (task._id && task._id === this.selectedTaskId ? " tasks-selected" : ""),
				onConfirm: "rowDelete",
				onCompletedChange: "rowCompletedChange",
				onSubjectChange: "rowSubjectChange",
				onSubjectEnter: "rowSubjectEnter",
				onSubjectBlur: "rowSubjectBlur",
				onOpenTask: "rowOpen"
			}, {owner: this});
		}, this);
		rows.setReorderable(order === "position" && !filter);
		this.$.empty.setShowing(!tasks.length);
		if (rows.hasNode()) {
			rows.render();
		}
	},

	rowFor: function (task) {
		var rows = this.$.rows.getControls();
		for (var i = 0; i < rows.length; i++) {
			if (rows[i].task === task) {
				return rows[i];
			}
		}
		return null;
	},

	selectedTaskIdChanged: function () {
		this.$.rows.getControls().forEach(function (row) {
			if (row.task) {
				row.addRemoveClass("tasks-selected", !!row.task._id && row.task._id === this.selectedTaskId);
			}
		}, this);
	},

	filterChange: function () {
		this.commitEditing();
		this.renderRows();
	},

	// ------------------------------------------------------------ editing

	// A new task goes to the end of the list, like in the legacy app. In "List
	// all tasks" new tasks are filed in Unfiled.
	addTask: function () {
		var self = this, list = this.list;
		if (!list) {
			return;
		}
		if (this.$.filter.getValue()) {
			this.$.filter.setValue("");
			this.renderRows();
		}
		var existing = this.tasks.filter(function (t) {
			return !t._id;
		})[0];
		if (existing) {
			var row = this.rowFor(existing);
			return row && row.focusSubject();
		}
		this.saveList(function () {
			var task = {
				_newId: self.nextNewId++,
				subject: "",
				notes: "",
				completed: false,
				priority: Tasks.PRIORITY_NORMAL,
				dueDate: null,
				taskListId: Tasks.List.isAllTasks(list) || Tasks.List.isUnfiled(list) ? null : list._id
			};
			self.db.nextPosition(list, function (err, position) {
				task.position = position;
			});
			self.tasks.push(task);
			self.renderRows();
			var row = self.rowFor(task);
			if (row) {
				self.$.scroller.scrollIntoView(row.hasNode() ? row.node.offsetTop : 0);
				row.focusSubject();
			}
		});
	},

	// Saves a task and keeps the in-memory copy in sync.
	saveTask: function (task, callback) {
		var self = this;
		task.subject = task.subject || "";
		this.db.saveTask(task, function (err, id) {
			if (!err) {
				task._id = id;
				delete task._newId;
			}
			self.doTasksChanged();
			if (callback) {
				callback(err);
			}
		});
	},

	removeUnsaved: function (task) {
		var i = this.tasks.indexOf(task);
		if (i >= 0) {
			this.tasks.splice(i, 1);
		}
		this.renderRows();
	},

	rowSubjectChange: function (inSender, inTask, inSubject) {
		if (inTask._id && inSubject !== (inTask.subject || "").split("\n")[0]) {
			// Only the first line is edited in place; keep the rest of a long subject.
			var rest = (inTask.subject || "").split("\n").slice(1);
			inTask.subject = [inSubject].concat(rest).join("\n");
			this.saveTask(inTask);
		}
	},

	rowSubjectBlur: function (inSender, inTask, inSubject) {
		var self = this;
		if (!inTask._id) {
			if (enyo.string.trim(inSubject)) {
				inTask.subject = inSubject;
				this.saveTask(inTask);
			} else {
				// Leaving an untouched new task throws it away.
				enyo.asyncMethod(this, function () {
					if (!inTask._id && !enyo.string.trim(self.rowFor(inTask) ? self.rowFor(inTask).getSubject() : "")) {
						self.removeUnsaved(inTask);
					}
				});
			}
		}
		if (this.needsReload) {
			enyo.job(this.id + "-reload", enyo.bind(this, "reload"), 300);
		}
	},

	// Enter commits the task and starts a new one below.
	rowSubjectEnter: function (inSender, inTask, inSubject) {
		var self = this;
		if (!enyo.string.trim(inSubject)) {
			return;
		}
		if (!inTask._id) {
			inTask.subject = inSubject;
			this.saveTask(inTask, function () {
				self.addTask();
			});
		} else {
			this.rowSubjectChange(inSender, inTask, inSubject);
			this.addTask();
		}
	},

	rowCompletedChange: function (inSender, inTask, inCompleted) {
		var self = this;
		inTask.completed = inCompleted;
		inTask.completedDate = inCompleted ? Date.now() : null;
		if (!inTask._id) {
			if (!enyo.string.trim(this.rowFor(inTask).getSubject())) {
				return;
			}
			inTask.subject = this.rowFor(inTask).getSubject();
		}
		this.saveTask(inTask);
		if (inCompleted && this.list.show === "remaining") {
			// Fade the finished task out of a "hide completed" list.
			var row = this.rowFor(inTask);
			inTask._fading = true;
			if (row) {
				row.addClass("tasks-fading");
			}
			setTimeout(function () {
				delete inTask._fading;
				self.renderRows();
			}, 600);
		}
	},

	rowDelete: function (inSender) {
		var task = inSender.task;
		this.removeUnsaved(task);
		if (task._id) {
			var self = this;
			this.db.deleteTask(task._id, function () {
				self.doTasksChanged(task);
			});
		}
	},

	rowOpen: function (inSender, inTask) {
		var self = this;
		if (!inTask._id) {
			var subject = this.rowFor(inTask) ? this.rowFor(inTask).getSubject() : "";
			inTask.subject = subject;
			if (!enyo.string.trim(subject)) {
				return;
			}
			return this.saveTask(inTask, function () {
				self.doOpenTask(inTask);
			});
		}
		this.commitEditing();
		this.doOpenTask(inTask);
	},

	// Ends inline editing so pending text is saved.
	commitEditing: function () {
		var row = this.editingRow();
		if (row) {
			row.$.subject.forceBlur();
		}
	},

	rowsReordered: function (inSender, from, to) {
		var tasks = this.visibleTasks().filter(function (t) {
			return !!t._id;
		});
		var moved = tasks[from];
		var changes = Tasks.movePositions(tasks, from, to, Tasks.POSITION_STEP);
		this.tasks.sort(function (a, b) {
			return (a._id ? 0 : 1) - (b._id ? 0 : 1) || a.position - b.position;
		});
		this.renderRows();
		var self = this;
		this.db.setPositions(changes, function () {
			self.doTasksChanged(moved);
		});
	},

	// ------------------------------------------------------------ list commands

	openListMenu: function (inSender) {
		this.$.listMenu.openAroundControl(inSender);
		this.updateMenu();
	},

	afterBulkChange: function () {
		this.doTasksChanged();
		this.reload();
	},

	setDueForAll: function () {
		var self = this;
		this.commitEditing();
		this.$.dueDialog.pick($L("Set due date for all"), null, function (due) {
			self.tasks.forEach(function (t) {
				t.dueDate = due;
			});
			self.renderRows();
			self.db.setAllDueDate(self.list, due, enyo.bind(self, "afterBulkChange"));
		});
	},

	markAll: function (completed) {
		this.commitEditing();
		this.tasks.forEach(function (t) {
			t.completed = completed;
		});
		this.renderRows();
		this.db.setAllCompleted(this.list, completed, enyo.bind(this, "afterBulkChange"));
	},

	markAllCompleted: function () {
		this.markAll(true);
	},

	markAllIncomplete: function () {
		this.markAll(false);
	},

	toggleShowCompleted: function () {
		this.commitEditing();
		this.list.show = this.list.show === "remaining" ? "all" : "remaining";
		this.updateHeader();
		this.renderRows();
		if (this.list._id) {
			this.saveList();
		}
	},

	purgeCompleted: function () {
		var self = this;
		this.$.confirm.ask($L("Delete Completed Tasks"), $L("Are you sure you want to delete all completed tasks?"),
			$L("Delete Completed"), function () {
				self.tasks = self.tasks.filter(function (t) {
					return !t.completed;
				});
				self.renderRows();
				self.db.purgeCompletedTasks(self.list, enyo.bind(self, "afterBulkChange"));
			});
	},

	deleteList: function () {
		var self = this, list = this.list;
		if (!Tasks.List.isLocal(list)) {
			return;
		}
		this.$.confirm.ask($L("Delete list"), $L("Are you sure you want to delete this list?"), $L("Delete"), function () {
			self.confirmedDeleteList(list);
		});
	},

	confirmedDeleteList: function (list) {
		var self = this;
		if (!list._id) {
			return this.doListDeleted(list);
		}
		this.db.deleteTaskList(list, function () {
			self.doListDeleted(list);
		});
	}
});
