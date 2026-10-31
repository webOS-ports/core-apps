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
 * What the alarm dashboard says, worked out the way the legacy Clock's
 * alarmdash scene did it (AlarmdashAssistant.update()):
 *
 *  - one dashboard for all alarms, with the number of enabled alarms on the
 *    badge when there is more than one;
 *  - a snoozed alarm first: its time (or its own title) over
 *    "Snoozed for N more minutes", "Snoozed for 1 more minute", or just
 *    "Snoozed" for an alarm that hides its snooze time;
 *  - otherwise the next alarm to ring: its time over the day it rings
 *    ("Today", "Tomorrow", a weekday), or its own title over time and day.
 *
 * Plain functions, no enyo, so the host tests can run it as it is.
 */

var AlarmDashState = {

	/*
	 * alarms:  the alarm records (db8 com.palm.clock.alarm:1)
	 * snoozes: { alarm key: time in ms the snooze ends }
	 * now:     a Date
	 * helpers: { nextDate(alarm, now) -> Date,
	 *            dayText(alarm, nextDate, now) -> "" for today, or the day,
	 *            L(string) -> the localised string }
	 *
	 * Returns null when there is nothing to show, otherwise
	 * { key, title, text, count, snoozed, refreshIn } where refreshIn is the
	 * number of ms after which the text changes (0: it does not).
	 */
	describe: function(alarms, snoozes, now, helpers) {
		var L = helpers.L;
		var nowMs = now.getTime();
		var enabled = [];
		var i;

		for (i = 0; alarms && i < alarms.length; i++) {
			if (alarms[i] && alarms[i].enabled) {
				enabled.push(alarms[i]);
			}
		}
		if (enabled.length === 0) {
			return null;
		}

		// The snoozed alarm that rings first. A snooze whose time has passed
		// is not one any more: the alarm is ringing, or rang and was dealt with.
		var snoozed = null, snoozeEnd = 0;
		for (i = 0; i < enabled.length; i++) {
			var end = snoozes ? snoozes[enabled[i].key] : undefined;
			if (typeof end === "number" && end > nowMs && (!snoozed || end < snoozeEnd)) {
				snoozed = enabled[i];
				snoozeEnd = end;
			}
		}

		var state = { count: enabled.length, snoozed: !!snoozed, refreshIn: 0 };

		if (snoozed) {
			state.key = snoozed.key;
			state.title = AlarmDashState.isDefaultTitle(snoozed, L) ? snoozed.niceTime : snoozed.title;
			if (snoozed.hideSnoozeTime) {
				state.text = L("Snoozed");
			} else {
				var left = Math.ceil((snoozeEnd - nowMs) / 60000);
				if (left <= 1) {
					state.text = L("Snoozed for 1 more minute");
				} else {
					state.text = L("Snoozed for #{minutes} more minutes").replace("#{minutes}", left);
				}
				// Once the minutes left go down by one, so the text changes.
				state.refreshIn = ((snoozeEnd - nowMs) % 60000) || 60000;
			}
			return state;
		}

		var next = null, nextMs = 0, nextDate = null;
		for (i = 0; i < enabled.length; i++) {
			var d = helpers.nextDate(enabled[i], now);
			var ms = d ? d.getTime() : NaN;
			if (!isNaN(ms) && (!next || ms < nextMs)) {
				next = enabled[i];
				nextMs = ms;
				nextDate = d;
			}
		}
		if (!next) {
			next = enabled[0];
			nextDate = null;
		}

		var day = helpers.dayText(next, nextDate, now) || L("Today");
		state.key = next.key;
		if (AlarmDashState.isDefaultTitle(next, L)) {
			state.title = next.niceTime;
			state.text = day;
		} else {
			state.title = next.title;
			state.text = next.niceTime + " " + day;
		}
		return state;
	},

	// An alarm nobody named shows its time as the title, as legacy's did.
	isDefaultTitle: function(alarm, L) {
		var title = alarm.title === undefined || alarm.title === null ? "" : String(alarm.title);
		title = title.replace(/^\s+|\s+$/g, "");
		return title === "" || title === L("Alarm") || title === "Alarm";
	}
};
