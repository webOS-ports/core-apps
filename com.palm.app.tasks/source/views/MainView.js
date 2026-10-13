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
 * The Tasks window. Three sliding views: lists | tasks | task details.
 * On a tablet (or any window wider than multiViewMinWidth) they sit side by
 * side and slide over each other; on a phone each fills the screen and back
 * goes to the previous one, like the legacy scenes.
 *
 * Window params (from the launcher, dashboard or universal search):
 *   {taskListId, taskId}  open a list, and optionally one of its tasks
 *   {taskSubject}         start a new Unfiled task with this subject
 *
 * On a device the back gesture (backHandler) closes the details or, on a
 * phone, goes back to the list of lists; a desktop browser has back buttons
 * that do the same.
 */
enyo.kind({
	name: "Tasks.MainView",
	kind: enyo.VFlexBox,
	className: "tasks-app",
	components: [
		{kind: "ApplicationEvents", onWindowParamsChange: "windowParamsChange", onBack: "backHandler",
			onWindowDeactivated: "windowDeactivated"},
		{name: "pane", kind: "SlidingPane", flex: 1, multiViewMinWidth: 600, onSelectView: "viewSelected",
			onSlideComplete: "slideComplete", components: [
			{name: "listsView", kind: "Tasks.ListsView", width: "300px", onSelectList: "selectList",
				onNewList: "newList", onDeleteList: "deleteList", onReorderList: "reorderLists"},
			{name: "tasksView", kind: "Tasks.TasksView", flex: 1, onOpenTask: "openTask",
				onBack: "back", onListSaved: "listSaved", onListDeleted: "listDeleted", onTasksChanged: "tasksChanged"},
			{name: "detailsView", kind: "Tasks.TaskDetails", width: "380px", showing: false, onBack: "back",
				onTaskSaved: "taskSaved", onTaskDeleted: "taskDeleted"}
		]},
		{kind: "AppMenu", components: [
			{caption: $L("Set due date for all..."), onclick: "menuCommand", command: "setDueForAll"},
			{caption: $L("Mark All"), components: [
				{caption: $L("Mark all completed"), onclick: "menuCommand", command: "markAllCompleted"},
				{caption: $L("Mark all incomplete"), onclick: "menuCommand", command: "markAllIncomplete"}
			]},
			{name: "appMenuShowCompleted", caption: $L("Hide Completed"), onclick: "menuCommand", command: "toggleShowCompleted"},
			{caption: $L("Delete completed tasks"), onclick: "menuCommand", command: "purgeCompleted"},
			{name: "appMenuDeleteList", caption: $L("Delete list"), onclick: "menuCommand", command: "deleteList"}
		]},
		{name: "confirm", kind: "Tasks.ConfirmDialog"}
	],

	create: function () {
		this.inherited(arguments);
		this.db = new Tasks.Db();
		this.$.tasksView.setDb(this.db);
		this.$.detailsView.setDb(this.db);
		this.data = {lists: []};
		this.start(enyo.windowParams || {});
	},

	destroy: function () {
		this.stopWatching();
		this.inherited(arguments);
	},

	rendered: function () {
		this.inherited(arguments);
		this.updateSingleView();
		// Focusing an input in a view that is off screen makes the browser
		// scroll the pane sideways; the pane positions views itself.
		var pane = this.$.pane.hasNode();
		if (pane) {
			pane.addEventListener("scroll", function () {
				if (pane.scrollLeft) {
					pane.scrollLeft = 0;
				}
			});
		}
	},

	resizeHandler: function () {
		this.inherited(arguments);
		this.updateSingleView();
	},

	updateSingleView: function () {
		var single = !(this.$.pane.multiView && window.innerWidth > this.$.pane.multiViewMinWidth);
		if (single !== this.singleView) {
			this.singleView = single;
			this.$.tasksView.setSingleView(single);
			this.$.detailsView.setSingleView(single);
			this.$.detailsView.setShowing(single || !!this.$.detailsView.getTask());
			if (single) {
				// SlidingPane zeroes the views' flex for the one-view layout but
				// leaves the box-flex style, which squeezes the tasks view to 0 wide.
				this.$.tasksView.applyStyle("-webkit-box-flex", "0");
			}
			this.$.pane.resize();
		}
	},

	// ------------------------------------------------------------ start up

	start: function (params) {
		var self = this;
		this.db.mapAccounts(function () {
			self.db.checkTaskLists(function () {
				self.watchLists();
				self.loadLists(function () {
					self.handleParams(params);
				});
			});
		});
	},

	windowParamsChange: function () {
		var params = enyo.windowParams || {};
		if (this.data.allTasks) {
			this.handleParams(params);
		}
	},

	handleParams: function (params) {
		var self = this;
		if (params.taskSubject) {
			this.selectList(null, this.data.unfiled || this.data.allTasks);
			this.db.nextPosition(this.data.unfiled, function (err, position) {
				var task = {subject: params.taskSubject, notes: "", completed: false, priority: Tasks.PRIORITY_NORMAL,
					dueDate: null, taskListId: null, position: position};
				self.db.saveTask(task, function (err, id) {
					task._id = id;
					self.tasksChanged();
					self.openTask(null, task);
				});
			});
		} else if (params.taskListId) {
			var list = this.findList(params.taskListId) || this.data.allTasks;
			this.selectList(null, list);
			if (params.taskId) {
				this.db.getTask(params.taskId, function (err, task) {
					if (task) {
						self.openTask(null, task);
					}
				});
			}
		} else if (!this.currentList) {
			// Nothing selected yet: a tablet shows all tasks next to the lists,
			// a phone starts on the list of lists.
			this.selectList(null, this.data.allTasks, this.singleView);
		}
	},

	// ------------------------------------------------------------ lists

	loadLists: function (callback) {
		var self = this;
		this.db.getTaskLists(function (err, data) {
			if (err) {
				Tasks.error("could not load lists", JSON.stringify(err));
				return callback && callback();
			}
			var lists = data.lists.slice();
			if (data.unfiled && data.unfiled.visible) {
				lists.push(data.unfiled);
			}
			self.data = {lists: lists, unfiled: data.unfiled, allTasks: data.allTasks, all: data.lists};
			self.$.listsView.setAllTasks(data.allTasks);
			self.$.listsView.setLists(lists);
			self.updateListChoices();
			// Pick up renamed lists and new due counts for the list on screen.
			var current = self.currentList;
			if (current && current._id) {
				var fresh = self.findList(current._id);
				if (fresh) {
					self.currentList = fresh;
					self.$.tasksView.setList(fresh);
				} else if (current._kind && !Tasks.List.isUnfiled(current)) {
					// Deleted elsewhere.
					self.selectList(null, self.data.allTasks, true);
				}
			}
			if (callback) {
				callback();
			}
		});
	},

	findList: function (id) {
		var d = this.data;
		if (d.allTasks && d.allTasks._id === id) {
			return d.allTasks;
		}
		if (d.unfiled && d.unfiled._id === id) {
			return d.unfiled;
		}
		return (d.all || []).filter(function (l) {
			return l._id === id;
		})[0];
	},

	// Choices for the List selector of the task details.
	updateListChoices: function () {
		var choices = [{caption: $L("Unfiled"), value: "unfiled"}];
		(this.data.all || []).forEach(function (list) {
			choices.push({caption: Tasks.List.displayName(list), value: list._id});
		});
		this.$.detailsView.setLists(choices);
	},

	selectList: function (inSender, inList, inStayOnLists) {
		if (!inList) {
			return;
		}
		this.$.detailsView.commit();
		this.currentList = inList;
		this.$.listsView.setSelectedId(inList._id);
		this.$.tasksView.setList(inList);
		this.$.detailsView.setTask(null);
		this.$.tasksView.setSelectedTaskId(null);
		this.updateAppMenu();
		this.watchTasks();
		if (!inStayOnLists) {
			this.showView("tasks");
		} else {
			this.showView("lists");
		}
	},

	newList: function () {
		var list = {name: "", order: "position", show: "all", position: Date.now()};
		this.selectList(null, list);
		this.$.listsView.setSelectedId(null);
		enyo.asyncMethod(this.$.tasksView, "focusName");
	},

	listSaved: function (inSender, inList) {
		this.$.listsView.setSelectedId(inList._id);
		this.watchTasks();
		this.loadLists();
	},

	deleteList: function (inSender, inList) {
		var self = this;
		this.db.deleteTaskList(inList, function () {
			self.listDeleted(null, inList);
		});
	},

	listDeleted: function (inSender, inList) {
		var self = this;
		if (!this.currentList || this.currentList === inList || this.currentList._id === inList._id) {
			this.selectList(null, this.data.allTasks, this.singleView);
		}
		this.db.updateTotals(function () {
			self.loadLists();
		});
	},

	reorderLists: function (inSender, inLists, inFrom, inTo) {
		var self = this;
		var lists = inLists.map(function (l) {
			return {_id: l._id, position: l.position || 0};
		});
		var changes = Tasks.movePositions(lists, inFrom, inTo, -Tasks.POSITION_STEP);
		this.db.setPositions(changes, function () {
			self.loadLists();
		});
	},

	// ------------------------------------------------------------ tasks

	openTask: function (inSender, inTask) {
		this.$.detailsView.commit();
		this.$.detailsView.setTask(inTask);
		this.$.tasksView.setSelectedTaskId(inTask._id);
		this.showView("details");
		if (!inTask.subject || inTask.subject === $L("Task name...")) {
			enyo.asyncMethod(this.$.detailsView, "focusSubject");
		}
	},

	taskSaved: function () {
		this.tasksChanged();
	},

	taskDeleted: function () {
		this.$.tasksView.setSelectedTaskId(null);
		this.tasksChanged();
		this.closeDetails();
	},

	// Something changed: refresh the due counts (which also refreshes the lists
	// through the list watch) and whether Unfiled shows up.
	tasksChanged: function () {
		enyo.job("tasks-totals", enyo.bind(this, function () {
			var self = this;
			this.db.checkUnfiledVisibility(function () {
				self.db.updateTotals(function () {
					self.loadLists();
				});
			});
		}), 500);
	},

	// ------------------------------------------------------------ watches

	watchLists: function () {
		var self = this;
		if (this.listWatch) {
			this.listWatch.cancel();
		}
		this.listWatch = this.db.watch({from: Tasks.TASKLIST_KIND}, function () {
			enyo.job("tasks-lists-reload", enyo.bind(self, "loadLists"), 200);
		});
	},

	watchTasks: function () {
		var self = this, list = this.currentList;
		if (this.taskWatch) {
			this.taskWatch.cancel();
			this.taskWatch = null;
		}
		if (!list || (!list._id && !Tasks.List.isAllTasks(list))) {
			return;
		}
		var query = {from: Tasks.TASK_KIND};
		var clause = this.db._listClause(list);
		if (clause) {
			query.where = [clause];
		}
		this.taskWatch = this.db.watch(query, function () {
			enyo.job("tasks-reload", enyo.bind(self, "tasksChangedInDb"), 200);
		});
	},

	tasksChangedInDb: function () {
		var self = this, shown = this.$.detailsView.getTask();
		this.$.tasksView.reload();
		if (shown && shown._id) {
			this.db.getTask(shown._id, function (err, task) {
				if (task) {
					self.$.detailsView.refresh(task);
				}
			});
		}
	},

	stopWatching: function () {
		if (this.listWatch) {
			this.listWatch.cancel();
		}
		if (this.taskWatch) {
			this.taskWatch.cancel();
		}
	},

	// ------------------------------------------------------------ navigation

	viewSelected: function (inSender, inView) {
		if (inView !== this.$.detailsView) {
			this.$.detailsView.commit();
		}
		if (inView === this.$.listsView) {
			this.$.tasksView.commitEditing();
		}
	},

	/**
	 * Phone: one view at a time. Tablet: lists and tasks side by side; the
	 * details view appears on the right when a task is open, or on top of
	 * everything when the window is too narrow for three columns.
	 */
	showView: function (inName) {
		var pane = this.$.pane, details = this.$.detailsView;
		if (this.singleView) {
			this.selectView(this.$[inName + "View"]);
			return;
		}
		if (inName === "details") {
			if (!details.showing) {
				details.setShowing(true);
				pane.resize();
			}
			// Wide enough: lists | tasks | details. Otherwise the details cover
			// the window, as on a phone.
			this.selectView(window.innerWidth - 300 - 380 >= 320 ? this.$.listsView : details);
		} else {
			this.selectView(this.$.listsView);
		}
	},

	// SlidingPane moves every view by animating one of them; a view selected
	// while it is still sliding (two quick back gestures) starts from the half
	// way positions and leaves the tasks view covering the lists. Such a
	// selection is made again once the pane has stopped.
	selectView: function (inView) {
		var pane = this.$.pane;
		if (pane.isAnimating()) {
			this.reselectView = true;
		}
		pane.selectView(inView);
	},

	slideComplete: function () {
		if (this.reselectView) {
			enyo.job(this.id + "-reselect", enyo.bind(this, function () {
				var pane = this.$.pane;
				if (this.reselectView && !pane.isAnimating()) {
					this.reselectView = false;
					pane.selectView(pane.getView());
				}
			}), 50);
		}
	},

	closeDetails: function () {
		this.$.detailsView.commit();
		this.$.detailsView.setTask(null);
		this.$.tasksView.setSelectedTaskId(null);
		if (this.singleView) {
			this.selectView(this.$.tasksView);
		} else {
			this.$.detailsView.setShowing(false);
			this.$.pane.resize();
			this.selectView(this.$.listsView);
		}
	},

	// The desktop back buttons.
	back: function () {
		this.backHandler(null, {preventDefault: function () {}});
	},

	backHandler: function (inSender, inEvent) {
		if (this.closeTopPopup()) {
			inEvent.preventDefault();
		} else if (this.$.detailsView.getTask() && (!this.singleView || this.$.pane.getView() === this.$.detailsView)) {
			this.closeDetails();
			inEvent.preventDefault();
		} else if (this.singleView && this.$.pane.getView() !== this.$.listsView) {
			this.selectView(this.$.listsView);
			inEvent.preventDefault();
		}
	},

	// Enyo closes a popup on ESC only while focus is inside it, which a menu
	// opened from a toolbar button never has; so back closes the topmost open
	// menu or dialog itself before it navigates.
	closeTopPopup: function () {
		var top = null;
		for (var id in enyo.$) {
			var c = enyo.$[id];
			if (c instanceof enyo.BasicPopup && c.isOpen && (!top || (c._zIndex || 0) > (top._zIndex || 0))) {
				top = c;
			}
		}
		if (top) {
			top.close();
		}
		return !!top;
	},

	windowDeactivated: function () {
		this.$.detailsView.commit();
		this.$.tasksView.commitEditing();
	},

	// ------------------------------------------------------------ app menu

	updateAppMenu: function () {
		var list = this.currentList || {};
		if (!this.$.appMenuShowCompleted) {
			return;
		}
		this.$.appMenuShowCompleted.setCaption(list.show === "remaining" ? $L("Show Completed") : $L("Hide Completed"));
		this.$.appMenuDeleteList.setShowing(Tasks.List.isLocal(list));
	},

	menuCommand: function (inSender) {
		this.$.tasksView[inSender.command]();
		this.updateAppMenu();
	}
});
