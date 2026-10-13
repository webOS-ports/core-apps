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

// Page-side stand-in (FAPFIX=1) for the enyo.gesture fix, for a device whose
// Enyo still leaves _isFocusing set after focusing a text field: WAM never
// delivers the simulated click that would clear it, so the next tap is lost.
(function () {
	var g = enyo.gesture;
	if (g.__fapFixed) return "already";
	g.__fapFixed = true;
	var fap = g.focusAtPoint;
	g.focusAtPoint = function (e) {
		fap.call(this, e);
		// WAM's simulateMouseClick delivers nothing, so nothing would clear the flag.
		setTimeout(function () { g._isFocusing = false; }, 300);
	};
	g._isFocusing = false;
	return "patched";
})()
