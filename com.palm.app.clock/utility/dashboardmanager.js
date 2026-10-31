// @@@LICENSE
//
//      Copyright (c) 2011-2013 LG Electronics, Inc.
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
 * The alarm dashboard: one item in the notification area while the Clock is
 * not in front, as the legacy Clock's alarmdash stage was. What it says comes
 * from AlarmDashState; the item itself is alarmDashboard/alarmDashboard.html,
 * a page of the Clock's own, in the phone dashboard style the other
 * dashboards (e.g. com.palm.systemui's USB one) use.
 *
 * It used to be an enyo.Dashboard with one layer per enabled alarm. That page
 * is the TouchPad's (enyo's dashboard-window: a 270px text column, a 320px
 * wide layout with a swipe shadow from 320px on), it showed the alarm that
 * rings LAST on top, and every deactivation of the main window pushed the
 * alarms again without taking the old layers off - the "2" on a single alarm.
 */
enyo.kind(
{
	name: "DashboardManager",
	kind: "Component",
	events: {},
	components: [
		{kind: "AlarmDbManager", onGotAlarms: "gotAlarms"}
	],

	kWindowName: "com.palm.app.clock.dashboard",
	kPagePath: "alarmDashboard/alarmDashboard.html",

	create: function ()
	{
		this.inherited(arguments);
		this.boolMainActive = false;
		this.boolDismissed = false;
		this.boolWanted = false;
		this.getAlarms();
	},

	destroy: function ()
	{
		this.clearRefreshTimer();
		this.inherited(arguments);
	},

	getAlarms: function ()
	{
		this.log();
		this.$.alarmDbManager.getAlarms({where: [{"prop": "enabled", "op": "=", "val": true}]});
	},

	gotAlarms: function (sender, results)
	{
		this.log(results);
		enyo.application.arAlarms = results;
		if (this.boolWanted)
		{
			this.boolWanted = false;
			this.render();
		}
	},

	/*
	 * true when the main window goes to the background, false when it comes
	 * to the front. The Clock in front shows no dashboard, as legacy's didn't.
	 */
	showDashboards: function (boolShowDashboards)
	{
		this.log(boolShowDashboards);
		this.boolMainActive = !boolShowDashboards;
		if (boolShowDashboards)
		{
			// Having been in the app brings a swiped away dashboard back.
			this.boolDismissed = false;
			this.refresh();
		}
		else
		{
			this.clearDashboards();
		}
	},

	/*
	 * Something about the alarms changed (snoozed, dismissed, rang, edited):
	 * read them again and show what is current.
	 */
	refresh: function ()
	{
		this.log();
		if (this.boolMainActive)
		{
			return;
		}
		this.boolWanted = true;
		this.getAlarms();
	},

	render: function ()
	{
		this.clearRefreshTimer();
		if (this.boolMainActive || this.boolDismissed)
		{
			this.clearDashboards();
			return;
		}

		var utilities = enyo.application.utilities;
		var state = AlarmDashState.describe(enyo.application.arAlarms || [],
			enyo.application.snoozedAlarms || {}, new Date(), {
				L: $L,
				nextDate: function (alarm) {
					return utilities.dateGetNext(alarm.hour, alarm.minute, alarm.occurs);
				},
				dayText: function (alarm, dateNext) {
					return dateNext ? utilities.nextAlarmDayText(dateNext, alarm.occurs) : "";
				}
			});
		this.log(state);

		if (!state)
		{
			this.clearDashboards();
			return;
		}

		if (this.window && this.window.closed === false)
		{
			enyo.windows.setWindowParams(this.window, state);
		}
		else
		{
			var icon = enyo.fetchAppRootPath().replace(/^file:\/\//, "") + "images/notification-alarm-small.png";
			this.window = enyo.windows.openDashboard(this.kPagePath, this.kWindowName, state, {icon: icon});
		}

		if (state.refreshIn > 0)
		{
			this.refreshTimer = setTimeout(enyo.bind(this, "render"), state.refreshIn + 50);
		}
	},

	clearRefreshTimer: function ()
	{
		if (this.refreshTimer)
		{
			clearTimeout(this.refreshTimer);
			this.refreshTimer = undefined;
		}
	},

	clearDashboards: function ()
	{
		this.log();
		this.clearRefreshTimer();
		var win = this.window;
		// Dropped first: the page's unload reports the close, and a close of
		// ours is not the user swiping the dashboard away.
		this.window = undefined;
		if (win && win.closed === false)
		{
			win.close();
		}
	},

	/*
	 * The page went away. Unless we closed it, the user swiped it off: it
	 * stays off until they have been back in the app, or an alarm changes.
	 */
	dashboardClosed: function ()
	{
		this.log();
		if (this.window)
		{
			this.window = undefined;
			this.clearRefreshTimer();
			this.boolDismissed = true;
		}
	},

	// An alarm was snoozed, rang or was dismissed: show it even if swiped off.
	alarmChanged: function ()
	{
		this.boolDismissed = false;
		this.refresh();
	},

	sendCommand: function (cmdType, strKey)
	{
		this.log();
		var winRoot = enyo.windows.getRootWindow();
		if(winRoot)
		{
			enyo.windows.setWindowParams(winRoot, {action: cmdType, key:  strKey });
		}
		else
		{
			this.log("root window not found");
		}
	}
});
