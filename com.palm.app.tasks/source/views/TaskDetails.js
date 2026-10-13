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
 * Details of one task (the legacy "task" scene): subject, completed, priority,
 * list, due date and notes. Changes are saved as they are made.
 */
enyo.kind({
	name: "Tasks.TaskDetails",
	kind: enyo.SlidingView,
	className: "tasks-details-view",
	published: {
		db: null,
		task: null,
		lists: null,		// [{caption, value}] choices for the List selector
		singleView: false
	},
	events: {
		onBack: "",
		onTaskSaved: "",
		onTaskDeleted: ""
	},
	components: [
		{kind: "Header", className: "tasks-header", components: [
			{name: "backButton", kind: "Button", className: "tasks-back-button", caption: " ", onclick: "doBack", showing: false},
			{name: "title", flex: 1, className: "tasks-header-title", content: $L("Task")}
		]},
		{name: "scroller", kind: "Scroller", flex: 1, className: "tasks-paper tasks-details", components: [
			{name: "placeholder", className: "tasks-empty-hint", content: $L("Select a task to see its details.")},
			{name: "body", showing: false, components: [
				{kind: "HFlexBox", className: "tasks-details-subject-row", align: "start", components: [
					{name: "check", kind: "Tasks.PriorityCheck", onChange: "completedChange"},
					{name: "subject", kind: "RichText", richContent: false, flex: 1, styled: false,
						className: "tasks-details-subject", hint: $L("Task name..."), onchange: "subjectChange"}
				]},
				{kind: "RowGroup", className: "tasks-details-group", components: [
					{kind: "HFlexBox", align: "center", components: [
						{content: $L("Priority"), className: "tasks-details-label"},
						{name: "priority", kind: "ListSelector", flex: 1, onChange: "priorityChange", items: [
							{caption: $L("High"), value: Tasks.PRIORITY_HIGH},
							{caption: $L("Normal"), value: Tasks.PRIORITY_NORMAL},
							{caption: $L("Low"), value: Tasks.PRIORITY_LOW}
						]}
					]},
					{kind: "HFlexBox", align: "center", components: [
						{content: $L("List"), className: "tasks-details-label"},
						{name: "list", kind: "ListSelector", flex: 1, onChange: "listChange"}
					]},
					{name: "dueRow", kind: "HFlexBox", align: "center", onclick: "dueClick", components: [
						{content: $L("Due"), className: "tasks-details-label"},
						{name: "due", flex: 1, className: "tasks-details-due"}
					]}
				]},
				{className: "tasks-details-notes-box", components: [
					{name: "notes", kind: "RichText", richContent: false, styled: false, className: "tasks-details-notes",
						hint: $L("Notes..."), autoLinking: true, onchange: "notesChange"}
				]}
			]}
		]},
		{kind: "Toolbar", className: "tasks-toolbar", components: [
			{kind: "GrabButton"},
			{kind: "Spacer"},
			{name: "deleteButton", caption: $L("Delete Task"), onclick: "deleteClick", disabled: true}
		]},
		{name: "dueMenu", kind: "Tasks.DueDateMenu"},
		{name: "confirm", kind: "Tasks.ConfirmDialog"}
	],

	create: function () {
		this.inherited(arguments);
		this.singleViewChanged();
		this.taskChanged();
	},

	// Devices have the back gesture; a desktop browser gets a button (phone:
	// back to the tasks, tablet: closes the details).
	singleViewChanged: function () {
		this.$.backButton.setShowing(!Tasks.Service.onDevice() && (this.singleView || !!this.task));
	},

	listsChanged: function () {
		this.$.list.setItems(this.lists || []);
		this.updateList();
	},

	taskChanged: function () {
		var task = this.task;
		this.$.placeholder.setShowing(!task);
		this.$.body.setShowing(!!task);
		this.$.deleteButton.setDisabled(!task);
		this.singleViewChanged();
		if (!task) {
			return;
		}
		this.$.check.setChecked(!!task.completed);
		this.$.check.setPriority(task.priority);
		this.$.subject.setValue(task.subject || "");
		this.$.priority.setValue(Number(task.priority) || Tasks.PRIORITY_NORMAL);
		this.updateList();
		this.updateDue();
		this.$.notes.setValue(task.notes || "");
	},

	// Called when the task changed in the database while it is shown.
	refresh: function (task) {
		if (!this.task || !task || task._id !== this.task._id) {
			return;
		}
		if (this.$.subject.hasFocus() || this.$.notes.hasFocus()) {
			return;
		}
		this.task = task;
		this.taskChanged();
	},

	focusSubject: function () {
		this.$.subject.forceFocus();
	},

	updateList: function () {
		if (this.task) {
			this.$.list.setValue(this.task.taskListId || "unfiled");
		}
	},

	updateDue: function () {
		var due = this.task && this.task.dueDate;
		var text = due === null || due === undefined ? $L("No due date") : Tasks.Dates.format(due, "medium");
		this.$.due.setContent(text);
		this.$.due.addRemoveClass("tasks-overdue", !this.task.completed && Tasks.Dates.isOverdue(due));
	},

	save: function () {
		var self = this, task = this.task;
		if (!task) {
			return;
		}
		if (!enyo.string.trim(task.subject || "")) {
			task.subject = $L("Task name...");
		}
		this.db.saveTask(task, function (err, id) {
			if (!err) {
				task._id = id;
			}
			self.doTaskSaved(task);
		});
	},

	// Saves any text still being typed; used before the view goes away.
	commit: function () {
		if (!this.task) {
			return;
		}
		var subject = this.$.subject.getValue(), notes = this.$.notes.getValue();
		if (subject !== (this.task.subject || "") || notes !== (this.task.notes || "")) {
			this.task.subject = subject;
			this.task.notes = notes;
			this.save();
		}
	},

	subjectChange: function () {
		var subject = this.$.subject.getValue();
		if (this.task && subject !== this.task.subject) {
			this.task.subject = subject;
			this.save();
		}
	},

	notesChange: function () {
		var notes = this.$.notes.getValue();
		if (this.task && notes !== (this.task.notes || "")) {
			this.task.notes = notes;
			this.save();
		}
	},

	completedChange: function (inSender, inChecked) {
		this.task.completed = inChecked;
		this.task.completedDate = inChecked ? Date.now() : null;
		this.updateDue();
		this.save();
	},

	priorityChange: function () {
		this.task.priority = Number(this.$.priority.getValue());
		this.$.check.setPriority(this.task.priority);
		this.save();
	},

	listChange: function () {
		var value = this.$.list.getValue();
		this.task.taskListId = value === "unfiled" ? null : value;
		this.save();
	},

	dueClick: function (inSender) {
		var self = this;
		this.$.dueMenu.choose(this.$.due, this.task.dueDate, function (due) {
			self.task.dueDate = due;
			self.updateDue();
			self.save();
		});
	},

	deleteClick: function () {
		var self = this, task = this.task;
		this.$.confirm.ask($L("Delete Task"), $L("Are you sure you want to delete this task?"), $L("Delete"), function () {
			var done = function () {
				self.setTask(null);
				self.doTaskDeleted(task);
			};
			if (task._id) {
				self.db.deleteTask(task._id, done);
			} else {
				done();
			}
		});
	}
});
