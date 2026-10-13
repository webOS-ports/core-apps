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
 * The legacy app's checkbox: colored by priority (red high, black normal,
 * gray low), with the check mark drawn by the image sprite.
 */
enyo.kind({
	name: "Tasks.PriorityCheck",
	kind: enyo.Control,
	className: "tasks-check",
	published: {
		checked: false,
		priority: 2
	},
	events: {
		onChange: ""
	},
	create: function () {
		this.inherited(arguments);
		this.checkedChanged();
		this.priorityChanged();
	},
	checkedChanged: function () {
		this.addRemoveClass("tasks-checked", !!this.checked);
	},
	priorityChanged: function (inOld) {
		if (inOld) {
			this.removeClass("tasks-check-" + Tasks.Priority.name(inOld));
		}
		this.addClass("tasks-check-" + Tasks.Priority.name(this.priority));
	},
	clickHandler: function (inSender, inEvent) {
		this.setChecked(!this.checked);
		this.doChange(this.checked);
		return true;
	}
});

/**
 * One task in the tasks list. The subject is edited in place (tap it and type,
 * Enter starts the next task); the arrow or due date opens the details.
 */
enyo.kind({
	name: "Tasks.TaskRow",
	kind: enyo.SwipeableItem,
	className: "tasks-task-row",
	published: {
		task: null,
		highlight: ""
	},
	events: {
		onCompletedChange: "",
		onSubjectChange: "",
		onSubjectEnter: "",
		onSubjectBlur: "",
		onOpenTask: ""
	},
	components: [
		{kind: "HFlexBox", align: "center", components: [
			{name: "check", kind: "Tasks.PriorityCheck", onChange: "checkChange"},
			{name: "subject", kind: "Input", flex: 1, styled: false, className: "tasks-subject",
				hint: $L("Task name..."), autoCapitalize: "sentence", onchange: "subjectChange",
				onkeypress: "subjectKeypress", onblur: "subjectBlur", onfocus: "subjectFocus"},
			{name: "label", className: "tasks-subject-label enyo-text-ellipsis", flex: 1, allowHtml: true, onclick: "labelClick", showing: false},
			{name: "due", className: "tasks-row-due", onclick: "infoClick"},
			{name: "info", className: "tasks-row-info", onclick: "infoClick"}
		]}
	],

	create: function () {
		this.inherited(arguments);
		this.taskChanged();
	},

	taskChanged: function () {
		var task = this.task;
		if (!task) {
			return;
		}
		var priority = Tasks.Priority.name(task.priority);
		this.addClass("tasks-priority-" + priority);
		this.addRemoveClass("tasks-completed", !!task.completed);
		this.$.check.setChecked(!!task.completed);
		this.$.check.setPriority(task.priority);
		this.$.subject.setValue((task.subject || "").split("\n")[0]);
		var due = task.dueDate !== null && task.dueDate !== undefined;
		this.$.due.setContent(due ? Tasks.Dates.format(task.dueDate) : "");
		this.$.due.setShowing(due);
		this.$.due.addRemoveClass("tasks-overdue", due && !task.completed && Tasks.Dates.isOverdue(task.dueDate));
		this.$.due.addRemoveClass("tasks-due-today", due && !task.completed && task.dueDate === Tasks.Dates.today());
		this.$.info.setShowing(!due);
		this.highlightChanged();
	},

	// While searching, the subject is shown as a label with the match marked.
	highlightChanged: function () {
		var filter = this.highlight, subject = Tasks.Task.displaySubject(this.task);
		this.$.subject.setShowing(!filter);
		this.$.label.setShowing(!!filter);
		if (filter) {
			var i = subject.toLowerCase().indexOf(filter.toLowerCase());
			this.$.label.setContent(i < 0 ? Tasks.escapeHtml(subject) :
				Tasks.escapeHtml(subject.slice(0, i)) + "<span class='tasks-highlight'>" +
				Tasks.escapeHtml(subject.slice(i, i + filter.length)) + "</span>" +
				Tasks.escapeHtml(subject.slice(i + filter.length)));
		}
	},

	focusSubject: function () {
		this.$.subject.forceFocus();
	},

	hasFocus: function () {
		return this.$.subject.hasFocus();
	},

	getSubject: function () {
		return this.$.subject.getValue();
	},

	checkChange: function (inSender, inChecked) {
		this.addRemoveClass("tasks-completed", inChecked);
		this.doCompletedChange(this.task, inChecked);
	},

	subjectChange: function () {
		this.doSubjectChange(this.task, this.$.subject.getValue());
	},

	subjectKeypress: function (inSender, inEvent) {
		if (inEvent.keyCode === 13) {
			inEvent.preventDefault();
			this.doSubjectEnter(this.task, this.$.subject.getValue());
			return true;
		}
	},

	subjectFocus: function () {
		this.addClass("tasks-editing");
	},

	subjectBlur: function () {
		this.removeClass("tasks-editing");
		this.doSubjectBlur(this.task, this.$.subject.getValue());
	},

	labelClick: function () {
		this.doOpenTask(this.task);
	},

	infoClick: function (inSender, inEvent) {
		this.doOpenTask(this.task);
		return true;
	}
});
