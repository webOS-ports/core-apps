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

// The Jasmine specs that came with Calendar, run in its page. Calendar loads
// MojoLoader and the Calendar library from /usr/palm/frameworks, so these
// need LUNEOS_ROOT.
"use strict";

const {describe, it} = require("node:test");
const {legacySuite} = require("../../tests/harness/jasmine");
const {LUNEOS_ROOT} = require("../../tests/harness/env");

if (!LUNEOS_ROOT) {
	describe("Calendar legacy specs", () => {
		it("need LUNEOS_ROOT", {skip: "set LUNEOS_ROOT to a LuneOS root filesystem"}, () => {});
	});
} else {
	legacySuite({
		app: "com.palm.app.calendar",
		specs: [
			"tests/legacy/DataHubSpec.js",
			"tests/legacy/EventViewSpec.js",
			"tests/legacy/LayoutManagerSpec.js",
			"tests/legacy/AppIconSpec.js",
			// CacheManager watches enyo.application, which the launched app sets up.
			{file: "tests/legacy/CacheManagerSpec.js", launch: {}}
		],
		skip: {
			"CacheManager buildEventCache(): Test Suite drop event from cache":
				"stale: the suite stubs updateTimestampCache, where buildEventCache now drops deleted events"
		}
	});
}
