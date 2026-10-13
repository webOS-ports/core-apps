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
 * "Are you sure?" dialog. open(title, message, confirmCaption, callback);
 * callback runs only when the destructive button is tapped.
 */
enyo.kind({
	name: "Tasks.ConfirmDialog",
	kind: enyo.ModalDialog,
	className: "enyo-popup enyo-modaldialog tasks-dialog",
	components: [
		{name: "message", className: "tasks-dialog-message"},
		{name: "confirm", kind: "Button", className: "enyo-button-negative", onclick: "confirmClick"},
		{kind: "Button", caption: $L("Cancel"), onclick: "close"}
	],

	ask: function (title, message, confirmCaption, callback) {
		this.callback = callback;
		this.openAtCenter();
		this.setCaption(title || "");
		this.$.message.setContent(message);
		this.$.confirm.setCaption(confirmCaption || $L("Delete"));
	},

	confirmClick: function () {
		var callback = this.callback;
		this.callback = null;
		this.close();
		if (callback) {
			callback();
		}
	}
});

/**
 * The legacy "Set due date" dialog: a date picker plus "No due date".
 * pick(title, due, callback) calls callback(due) with a due timestamp or null;
 * nothing is called on Cancel.
 */
enyo.kind({
	name: "Tasks.DueDateDialog",
	kind: enyo.ModalDialog,
	className: "enyo-popup enyo-modaldialog tasks-dialog",
	components: [
		{name: "picker", kind: "DatePicker", label: "", className: "tasks-date-picker"},
		{kind: "Button", caption: $L("Set due date"), className: "enyo-button-affirmative", onclick: "setClick"},
		{kind: "Button", caption: $L("No due date"), onclick: "noneClick"},
		{kind: "Button", caption: $L("Cancel"), onclick: "close"}
	],

	pick: function (title, due, callback) {
		this.callback = callback;
		this.openAtCenter();
		this.setCaption(title || $L("Set due date"));
		this.$.picker.setValue(due !== null && due !== undefined ? Tasks.Dates.toLocalDate(due) : new Date());
	},

	finish: function (due) {
		var callback = this.callback;
		this.callback = null;
		this.close();
		if (callback) {
			callback(due);
		}
	},

	setClick: function () {
		this.finish(Tasks.Dates.fromLocalDate(this.$.picker.getValue()));
	},

	noneClick: function () {
		this.finish(null);
	}
});

/**
 * The due date menu of a task: No due date / Today / Tomorrow / In one week /
 * In one month / Other..., with the current custom date on top when set.
 * choose(control, due, callback) calls callback(due) with the new due date.
 */
enyo.kind({
	name: "Tasks.DueDateMenu",
	kind: enyo.Component,
	components: [
		{name: "menu", kind: "PopupSelect", onSelect: "menuSelect"},
		{name: "dialog", kind: "Tasks.DueDateDialog"}
	],

	choose: function (control, due, callback) {
		this.callback = callback;
		this.due = due;
		var items = [
			{caption: $L("No due date"), value: "none"},
			{caption: $L("Today"), value: "today"},
			{caption: $L("Tomorrow"), value: "tomorrow"},
			{caption: $L("In one week"), value: "one_week"},
			{caption: $L("In one month"), value: "one_month"},
			{caption: $L("Other..."), value: "other"}
		];
		if (due !== null && due !== undefined) {
			items.unshift({caption: Tasks.Dates.format(due, "medium"), value: "custom"});
		}
		this.$.menu.setItems(items);
		this.$.menu.openAroundControl(control);
	},

	menuSelect: function (inSender, inItem) {
		var today = Tasks.Dates.today(), due;
		switch (inItem.getValue()) {
		case "none":
			due = null;
			break;
		case "today":
			due = today;
			break;
		case "tomorrow":
			due = Tasks.Dates.addDays(today, 1);
			break;
		case "one_week":
			due = Tasks.Dates.addDays(today, 7);
			break;
		case "one_month":
			due = Tasks.Dates.addMonths(today, 1);
			break;
		case "other":
			this.$.dialog.pick($L("Set due date"), this.due, this.callback);
			return;
		default:
			return;
		}
		if (this.callback) {
			this.callback(due);
		}
	}
});
