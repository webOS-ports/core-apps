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

// The devices the layouts are checked on: the display profiles the shell's
// tests use (luneos-components, test/imports/LunaNext/Common/SettingsStub.js),
// read from there so the two lists cannot drift apart.
//
// What an Enyo 1 app gets of a device is not its panel. WebAppMgr zooms a
// legacy page by com.webos.surfacemanager.devicePixelRatio
// (WAM_LEGACY_UI_ZOOM_FACTOR), so the page lays out in panel / zoom CSS
// pixels; and the card is the panel less the shell's status bar (3 grid
// units, plus a notch's inset) and gesture area (4 grid units, on by
// default: LunaGestureArea.enableGestureArea).
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const COMPONENTS = process.env.LUNEOS_COMPONENTS ||
	path.resolve(__dirname, "../../../luneos-components");
const STUB = path.join(COMPONENTS, "test/imports/LunaNext/Common/SettingsStub.js");

// The zoom each profile's device runs its legacy apps at, and where that
// comes from. A device that declares none gets what luneos-device-config's
// 10-configd-surfacemanager derives: the panel width over 450 CSS px.
//
// Profiles that stand for no LuneOS device are left out: "a500" (an A500
// alike, no LuneOS machine), "asymmetric" (a made-up notch) and "desktop".
const ZOOM = {
	gnex:      {zoom: 1.8, from: "configd-data maguro"},
	n7:        {zoom: 1.4, from: "configd-data grouper"},
	tp:        {zoom: 1.0, from: "configd-data tenderloin"},
	n4:        {zoom: 1.8, from: "configd-data mako"},
	n5:        {zoom: 2.6, from: "configd-data hammerhead"},
	radon:     {zoom: 1.6, from: "deviceinfo radon"},
	brax3:     {zoom: 720 / 450, from: "derived, 720 / 450"},
	q25:       {zoom: 1.6, from: "deviceinfo q25"},
	mindphone: {zoom: 480 / 450, from: "derived, 480 / 450"},
	tissot:    {zoom: 2.6, from: "configd-data tissot"},
	sargo:     {zoom: 2.4, from: "deviceinfo sargo"}
};
// A phone on its side keeps its zoom.
for (const p of ["tissot", "sargo", "radon"]) {
	ZOOM[p + "-land"] = Object.assign({}, ZOOM[p], {from: ZOOM[p].from + ", on its side"});
}

function loadProfiles() {
	const src = fs.readFileSync(STUB, "utf8").replace(/^\.pragma library\s*$/m, "");
	const ctx = {Qt: {application: {arguments: []}}, console};
	vm.createContext(ctx);
	vm.runInContext(src + "\n;this.__profiles = profiles;", ctx, {filename: STUB});
	return JSON.parse(JSON.stringify(ctx.__profiles));
}

// Every device, or those named. Each: name, the panel, gridUnit, tabletUi,
// zoom (and where it is from), and the card the app gets in CSS px.
function devices(names) {
	const profiles = loadProfiles();
	const out = [];
	for (const name of Object.keys(profiles)) {
		if (!ZOOM[name] || (names && names.length && !names.includes(name))) {
			continue;
		}
		const p = profiles[name];
		const gu = p.gridUnit;
		// A notch along the top edge lowers the status bar by its depth.
		const notchTop = (p.cutouts || []).filter((c) => c.y === 0 && c.width < p.displayWidth)
			.reduce((m, c) => Math.max(m, c.y + c.height), 0);
		const notchLeft = (p.cutouts || []).filter((c) => c.x === 0 && c.height < p.displayHeight)
			.reduce((m, c) => Math.max(m, c.x + c.width), 0);
		const cardW = p.displayWidth - notchLeft;
		const cardH = p.displayHeight - notchTop - 3 * gu - 4 * gu;
		const z = ZOOM[name].zoom;
		out.push({
			name,
			panel: [p.displayWidth, p.displayHeight],
			gridUnit: gu,
			tabletUi: p.tabletUi,
			zoom: z,
			zoomFrom: ZOOM[name].from,
			card: [cardW, cardH],
			css: [Math.floor(cardW / z), Math.floor(cardH / z)],
			// A popup alert's width, in CSS px: the card's on a phone; on a
			// tablet the shell's panel, Units.length(320) = 320 * dpi / 132
			// (AlertWindowsArea's tabletModalPanel).
			popupWidth: p.tabletUi ? Math.floor(320 * p.dpi / 132 / z) : Math.floor(cardW / z)
		});
	}
	const unknown = (names || []).filter((n) => !out.some((d) => d.name === n));
	if (unknown.length) {
		throw new Error("no such device: " + unknown.join(", ") + " (known: " +
			Object.keys(ZOOM).join(", ") + ")");
	}
	return out;
}

module.exports = {devices, loadProfiles, STUB};
