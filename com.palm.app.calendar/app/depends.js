// @@@LICENSE
//
//      Copyright (c) 2010-2013 LG Electronics, Inc.
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


enyo.depends(
    "$enyo-lib/accounts/",
    "$enyo-lib/addressing/",
    "$enyo-lib/contactsui/",
    "../libs/date.js", // Okay because DateJS now avoids multiple instantiation thereby avoiding the Date.toString() stack overflow issue.
    "shared/DeferredLoader.js",   // must precede AppView: it hooks editView/prefsView
    "shared/SimpleTransition.js", // We need to include the custom transition before AppView.js
    "AppMenu.js",
    "AppView.css",
    "AppView.js",
    "CalendarView.js",
    "header/CalendarList.css",
    "header/CalendarList.js",
    "day/",
    "month/",
    "week/",
//  "edit/",
    "edit/EditView.css",        // CSS stays eager: these sheets carry global rules
    "edit/RepeatView.css",
    "prefs/PreferencesView.css",
    "edit/DeleteConfirm.js",
    "edit/RepeatChangeConfirm.js",
    "edit/DetailView.js",
    "edit/DetailView.css",
    "firstLaunch/FirstLaunchView.js",
//  "prefs/",
    "reminders/MissedRemindersView.js",
    "shared/CalendarEvent.js",
    "shared/MeetingTimeFormatter.js",
    "shared/FormatterCache.js",
    "shared/JumpToView.js",
    "shared/Utilities.js"
);
