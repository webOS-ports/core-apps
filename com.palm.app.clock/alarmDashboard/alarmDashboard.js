// @@@LICENSE
//
//      Copyright (c) 2026 LuneOS
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

/*
 * The alarm dashboard item, laid out as the legacy Clock's alarmdash scene
 * was: the bell in its square with the number of alarms on the badge at its
 * corner, the title over one line of text. DashboardManager opens it and sends
 * it what to show (AlarmDashState) as window params.
 */
enyo.kind({
	name: "AlarmDashboard",
	kind: enyo.Control,
	className: "dashboard-notification-module single",
	components: [
		{kind: "ApplicationEvents", onWindowParamsChange: "windowParamsChangeHandler", onUnload: "unloadHandler"},
		{name: "iconContainer", className: "palm-dashboard-icon-container", onclick: "iconTap", components: [
			{name: "icon", className: "palm-dashboard-icon alarm"},
			{name: "badge", className: "dashboard-newitem", showing: false, components: [
				{name: "count", nodeTag: "span"}
			]}
		]},
		{name: "textContainer", className: "palm-dashboard-text-container", onclick: "messageTap", components: [
			{name: "title", className: "dashboard-title"},
			{name: "text", className: "palm-dashboard-text"}
		]}
	],

	create: function() {
		this.inherited(arguments);
		this.showState(enyo.windowParams);
	},

	windowParamsChangeHandler: function() {
		this.showState(enyo.windowParams);
	},

	showState: function(state) {
		if (!state || state.title === undefined) {
			return;
		}
		this.key = state.key;
		this.$.title.setContent(state.title);
		this.$.text.setContent(state.text || "");
		var many = state.count > 1;
		this.$.count.setContent(many ? String(state.count) : "");
		this.$.badge.setShowing(many);
		this.addRemoveClass("single", !many);
	},

	// The bell opens the list of alarms, the text the alarm it is about.
	iconTap: function() {
		this.tellApp({action: "alarms"});
		return true;
	},

	messageTap: function() {
		this.tellApp({action: "edit", key: this.key});
		return true;
	},

	// Swiped away (or closed by the app, which ignores this then).
	unloadHandler: function() {
		this.tellApp({action: "alarmDashboardClosed"});
	},

	tellApp: function(params) {
		var root = enyo.windows.getRootWindow();
		if (root && root !== window) {
			enyo.windows.setWindowParams(root, params);
		}
	}
});
