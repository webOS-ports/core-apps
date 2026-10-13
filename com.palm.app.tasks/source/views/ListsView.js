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
 * The list of task lists: "List all tasks" on top, then the visible lists
 * (local lists, account lists and Unfiled when it holds tasks). Lists can be
 * filtered by typing, reordered by hold and drag, and local lists deleted by
 * swiping.
 */
enyo.kind({
	name: "Tasks.ListsView",
	kind: enyo.SlidingView,
	className: "tasks-lists-view",
	published: {
		lists: null,
		allTasks: null,
		selectedId: null
	},
	events: {
		onSelectList: "",
		onNewList: "",
		onDeleteList: "",
		onReorderList: ""
	},
	components: [
		{kind: "Header", className: "tasks-header", components: [
			{className: "tasks-header-icon"},
			{content: $L("Tasks"), flex: 1, className: "tasks-header-title"}
		]},
		{className: "tasks-search", components: [
			{name: "filter", kind: "RoundedSearchInput", hint: $L("Search lists"), onchange: "filterChanged", onCancel: "filterChanged"}
		]},
		{kind: "Scroller", flex: 1, className: "tasks-lists-scroller", components: [
			{name: "allTasks", kind: "Item", className: "tasks-list-row tasks-all-row", tapHighlight: true, onclick: "allTasksClick", components: [
				{kind: "HFlexBox", align: "center", components: [
					{name: "allTasksName", flex: 1, className: "tasks-list-name"},
					{name: "allTasksDue", className: "tasks-due-badge", showing: false}
				]}
			]},
			{kind: "Divider", caption: $L("Lists")},
			{name: "rows", kind: "Tasks.ReorderList", onReorder: "rowsReordered"},
			{name: "empty", className: "tasks-empty-hint", content: $L("No lists yet"), showing: false}
		]},
		{kind: "Toolbar", className: "tasks-toolbar", components: [
			{kind: "Spacer"},
			{icon: "images/icon-new-task-list.png", className: "tasks-new-list-button", onclick: "doNewList"},
			{kind: "Spacer"}
		]}
	],

	create: function () {
		this.inherited(arguments);
		this.lists = this.lists || [];
		this.allTasksChanged();
		this.renderRows();
	},

	listsChanged: function () {
		this.renderRows();
	},

	allTasksChanged: function () {
		this.$.allTasksName.setContent($L("List all tasks"));
		var count = this.allTasks && this.allTasks.dueItemCount || 0;
		this.$.allTasksDue.setContent(count);
		this.$.allTasksDue.setShowing(count > 0);
		this.$.allTasks.addRemoveClass("tasks-due", count > 0);
		this.selectedIdChanged();
	},

	selectedIdChanged: function () {
		var all = this.allTasks && this.selectedId === this.allTasks._id;
		this.$.allTasks.addRemoveClass("tasks-selected", !!all);
		this.$.rows.getControls().forEach(function (row) {
			row.addRemoveClass("tasks-selected", row.list && row.list._id === this.selectedId);
		}, this);
	},

	filterChanged: function () {
		this.renderRows();
	},

	visibleLists: function () {
		var filter = (this.$.filter.getValue() || "").toLowerCase();
		return (this.lists || []).filter(function (list) {
			return !filter || Tasks.List.displayName(list).toLowerCase().indexOf(filter) >= 0;
		});
	},

	renderRows: function () {
		var rows = this.$.rows, lists = this.visibleLists(), filtering = !!this.$.filter.getValue();
		rows.destroyControls();
		lists.forEach(function (list, i) {
			var local = Tasks.List.isLocal(list);
			var due = list.dueItemCount || 0;
			var row = rows.createComponent({
				kind: "SwipeableItem",
				rowIndex: i,
				list: list,
				swipeable: local,
				reorderable: !filtering,
				className: "tasks-list-row" + (due ? " tasks-due" : "") + (list._id === this.selectedId ? " tasks-selected" : ""),
				confirmCaption: $L("Delete"),
				cancelCaption: $L("Cancel"),
				onConfirm: "rowDelete",
				onclick: "rowClick",
				components: [
					{kind: "HFlexBox", align: "center", components: [
						{flex: 1, className: "tasks-list-name enyo-text-ellipsis", allowHtml: true, content: this.highlight(Tasks.List.displayName(list))},
						{kind: "Image", className: "tasks-list-icon", src: list.icon, showing: !!list.icon},
						{className: "tasks-due-badge", content: due, showing: due > 0}
					]}
				]
			}, {owner: this});
		}, this);
		rows.setReorderable(!filtering);
		this.$.empty.setShowing(!lists.length);
		if (this.hasNode()) {
			rows.render();
		}
	},

	highlight: function (name) {
		var filter = this.$.filter.getValue(), text = Tasks.escapeHtml(name);
		if (!filter) {
			return text;
		}
		var i = name.toLowerCase().indexOf(filter.toLowerCase());
		if (i < 0) {
			return text;
		}
		return Tasks.escapeHtml(name.slice(0, i)) + "<span class='tasks-highlight'>" +
			Tasks.escapeHtml(name.slice(i, i + filter.length)) + "</span>" + Tasks.escapeHtml(name.slice(i + filter.length));
	},

	allTasksClick: function () {
		if (this.allTasks) {
			this.doSelectList(this.allTasks);
		}
	},

	rowClick: function (inSender) {
		this.doSelectList(inSender.list);
	},

	rowDelete: function (inSender) {
		this.doDeleteList(inSender.list);
	},

	rowsReordered: function (inSender, from, to) {
		this.doReorderList(this.visibleLists(), from, to);
	}
});
