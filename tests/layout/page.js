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

// What runs inside the pages: the stand-ins for what WebAppMgr gives an app's
// windows, and the layout check. Both are sent to Chromium as source, so
// neither may use anything from this module's scope.
"use strict";

// Installed in every window before its own scripts run. cfg is the JSON
// given to shim(): launchParams, identifier, deviceInfo, TZ.
//
// The bus calls go out through the __lunaCall binding (the root window's, for
// a window the app opens) to the fake bus in Node (tests/harness/luna.js, the
// one the jsdom tests use) and come back through __lunaDeliver.
function shim(cfg) {
	if (window.__layoutShim) {
		return;
	}
	window.__layoutShim = true;
	var ps = {
		launchParams: cfg.launchParams,
		identifier: cfg.identifier,
		locale: "en_us",
		localeRegion: "us",
		phoneRegion: "us",
		timeFormat: "HH24",
		TZ: cfg.TZ,
		deviceInfo: JSON.stringify(cfg.deviceInfo),
		screenOrientation: "up",
		isActivated: true,
		useSimulatedMouseClicks: false
	};
	// The methods a device's PalmSystem has (mindphone, 2026-11-03), as in
	// tests/harness/env.js; they do nothing here.
	["PmLogInfoWithClock", "PmLogString", "PmTrace", "PmTraceAfter", "PmTraceBefore", "PmTraceItem",
		"activate", "addBannerMessage", "addNewContentIndicator", "applyLaunchFeedback", "clearBannerMessages",
		"close", "containerReady", "copiedToClipboard", "deactivate", "editorFocused", "enableFullScreenMode",
		"focusLayer", "focusOwner", "getIdentifier", "getResource", "hide", "keepAlive", "keyboardHide",
		"keyboardShow", "markFirstUseDone", "onCloseNotify", "paste", "pastedFromClipboard", "platformBack",
		"playSoundNotification", "reloadInjectionData", "removeBannerMessage", "removeNewContentIndicator",
		"serviceCall", "setAlertSound", "setCursor", "setCursorHidden", "setInputRegion", "setKeyMask",
		"setLoadErrorPolicy", "setManualKeyboardEnabled", "setWindowOrientation", "setWindowProperty",
		"simulateMouseClick", "stagePreparing", "stageReady", "updateInjectionData"].forEach(function (m) {
		ps[m] = function () {};
	});
	window.PalmSystem = ps;

	// What the app asked of each window it opened (a popup alert's height is
	// in the features), kept in the root window, where the runner reads it.
	var root = window;
	try {
		while (root.opener && root.opener !== root && root.opener.__layoutShim) {
			root = root.opener;
		}
	} catch (e) {}
	root.__opened = root.__opened || [];
	var open = window.open;
	window.open = function (url, name, features) {
		var w = open.apply(window, arguments);
		root.__opened.push({url: String(url || ""), name: String(name || ""), features: String(features || "")});
		return w;
	};

	// One registry of bridges for all the app's windows, in the root window:
	// Chromium does not give a window the app opens the __lunaCall binding,
	// so such a window calls through the root's, and an answer finds its
	// bridge whichever window it is delivered in.
	var hub = root.__lunaHub = root.__lunaHub || {bridges: {}, next: 1};
	function PalmServiceBridge() {
		this.__id = hub.next++;
		hub.bridges[this.__id] = this;
	}
	// A window can call before a binding is in (a new window's first
	// document): the call waits for it, as a bus call would for the bus.
	function send(msg) {
		var via = typeof window.__lunaCall === "function" ? window :
			typeof root.__lunaCall === "function" ? root : null;
		if (via) {
			via.__lunaCall(msg);
		} else {
			setTimeout(function () {
				send(msg);
			}, 10);
		}
	}
	PalmServiceBridge.prototype.call = function (uri, json) {
		send(JSON.stringify({op: "call", id: this.__id, uri: uri, json: json || ""}));
	};
	PalmServiceBridge.prototype.cancel = function () {
		send(JSON.stringify({op: "cancel", id: this.__id}));
		delete hub.bridges[this.__id];
	};
	window.PalmServiceBridge = PalmServiceBridge;
	window.__lunaDeliver = function (id, response) {
		var b = hub.bridges[id];
		if (b && b.onservicecallback) {
			b.onservicecallback(response);
		}
	};

	// Device files (locale strings and the like) by their path, which the
	// server answers from the rootfs; a missing one is "", as on a device.
	// Asked for as "json" (Enyo 1's fetchAppInfo asks "const json"), the
	// file comes back parsed, and a missing one as undefined.
	window.palmGetResource = function (file, how) {
		var json = /\bjson\b/.test(String(how || ""));
		try {
			var x = new XMLHttpRequest();
			x.open("GET", file, false);
			x.send();
			if (x.status !== 200) {
				return json ? undefined : "";
			}
			return json ? JSON.parse(x.responseText) : x.responseText;
		} catch (e) {
			return json ? undefined : "";
		}
	};
}

// The layout check, run in a window once it has settled. It returns what a
// user could not reach or read:
//
//   off-screen    a control none of which is on the screen, and no scroller
//                 between it and the screen to bring it there
//   clipped       a control mostly cut off the same way
//   covered       a control on the screen with something else over it
//   squeezed      a scroller with too little of it left on the screen to use
//   scroller-cut  a scroller reaching past the window's edge: scrolled to its
//                 end, its last rows are still out of reach
//   page-overflow the page is wider or taller than the window. WebAppMgr does
//                 not scroll the main frame, so the excess cannot be reached
//
// Controls inside an Enyo scroller are not judged against the scroller: it
// can bring them into view. The scroller itself is judged instead.
function check(opts) {
	var W = window.innerWidth, H = window.innerHeight;
	var minScroller = opts && opts.minScroller || 40;
	var cutScroller = opts && opts.cutScroller || 8;
	var issues = [];

	function ctlOf(node) {
		for (var n = node; n; n = n.parentNode) {
			if (n.id && window.enyo && enyo.$ && enyo.$[n.id]) {
				return enyo.$[n.id];
			}
		}
		return null;
	}
	function describe(node) {
		var c = ctlOf(node);
		var text = (node.textContent || node.value || node.placeholder || "").replace(/\s+/g, " ").trim().slice(0, 40);
		return {
			kind: c ? c.kindName : node.tagName.toLowerCase(),
			name: c ? (c.owner && c.owner.name ? c.owner.name + "." : "") + c.name : "",
			id: node.id || "",
			text: text
		};
	}
	function shown(node) {
		if (!node.getClientRects().length) {
			return false;
		}
		for (var n = node; n && n.nodeType === 1; n = n.parentNode) {
			var s = getComputedStyle(n);
			if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) {
				return false;
			}
		}
		var r = node.getBoundingClientRect();
		return r.width >= 2 && r.height >= 2;
	}
	function isScroller(node) {
		var c = window.enyo && enyo.$ && node.id ? enyo.$[node.id] : null;
		// Enyo 1's scrollers, and Enyo 2's, which move what they hold by a
		// transform behind overflow: hidden, so only the kind tells.
		if (c && ((enyo.BasicScroller && c instanceof enyo.BasicScroller) ||
			(enyo.VirtualScroller && c instanceof enyo.VirtualScroller) ||
			(enyo.Scroller && c instanceof enyo.Scroller) ||
			(enyo.ScrollStrategy && c instanceof enyo.ScrollStrategy))) {
			return true;
		}
		var s = getComputedStyle(node);
		return /(auto|scroll)/.test(s.overflowY + s.overflowX) &&
			(node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1);
	}
	function clips(node) {
		var s = getComputedStyle(node);
		return s.overflowX !== "visible" || s.overflowY !== "visible";
	}
	function intersect(a, b) {
		var l = Math.max(a.left, b.left), t = Math.max(a.top, b.top);
		var r = Math.min(a.right, b.right), bt = Math.min(a.bottom, b.bottom);
		return {left: l, top: t, right: Math.max(l, r), bottom: Math.max(t, bt)};
	}
	function area(r) {
		return Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
	}
	function rectOf(node) {
		var r = node.getBoundingClientRect();
		return {left: r.left, top: r.top, right: r.right, bottom: r.bottom};
	}
	function round(r) {
		return [Math.round(r.left), Math.round(r.top), Math.round(r.right - r.left), Math.round(r.bottom - r.top)];
	}

	// What of node the clips above it leave, up to the first scroller (which
	// is returned, to be judged in its turn).
	function visibleOf(node) {
		var vis = rectOf(node);
		for (var a = node.parentNode; a && a.nodeType === 1; a = a.parentNode) {
			if (isScroller(a)) {
				return {vis: vis, scroller: a};
			}
			if (clips(a)) {
				vis = intersect(vis, rectOf(a));
			}
		}
		return {vis: intersect(vis, {left: 0, top: 0, right: W, bottom: H}), scroller: null};
	}

	var de = document.documentElement, body = document.body;
	var sw = Math.max(de.scrollWidth, body ? body.scrollWidth : 0);
	var sh = Math.max(de.scrollHeight, body ? body.scrollHeight : 0);
	if (sw > W + 1 || sh > H + 1) {
		// What sticks out: the outermost elements past the window's edge that
		// nothing clips or scrolls.
		var out = [];
		Array.prototype.forEach.call(document.body ? document.body.getElementsByTagName("*") : [], function (el) {
			var r = el.getBoundingClientRect();
			if (!(r.width > 0 && r.height > 0 && (r.right > W + 1 || r.bottom > H + 1))) {
				return;
			}
			for (var a = el.parentNode; a && a.nodeType === 1 && a !== document.body; a = a.parentNode) {
				if (clips(a) || out.indexOf(a) >= 0) {
					return;
				}
			}
			out.push(el);
		});
		var what = out.slice(0, 2).map(function (el) {
			var d = describe(el), r = el.getBoundingClientRect();
			return (d.name || d.kind + (el.className ? "." + String(el.className).split(" ")[0] : "")) +
				" to " + Math.round(r.right) + "," + Math.round(r.bottom);
		});
		issues.push({issue: "page-overflow", detail: "page " + sw + "x" + sh + " in a " + W + "x" + H + " window" +
			(what.length ? ": " + what.join("; ") : "")});
	}

	var selector = "button, input, textarea, select, a[href], .enyo-button, .enyo-tool-button, " +
		".enyo-radiobutton, .enyo-checkbox, .enyo-toggle-button, .enyo-tabbutton, .enyo-listselector, " +
		".enyo-picker-button, .enyo-menuitem, .enyo-grabbutton, .enyo-custom-button, .enyo-slider-button, " +
		".enyo-input, .enyo-item, " +
		// Enyo 2's onyx
		".onyx-button, .onyx-icon-button, .onyx-checkbox, .onyx-toggle-button, .onyx-radiobutton, " +
		".onyx-input-decorator, .onyx-picker-decorator, .onyx-menu-item, .onyx-slider-knob, .onyx-item";
	var nodes = Array.prototype.slice.call(document.querySelectorAll(selector));
	// The outermost of nested matches (an input inside an .enyo-input).
	nodes = nodes.filter(function (n) {
		for (var a = n.parentNode; a && a.nodeType === 1; a = a.parentNode) {
			if (a.matches && a.matches(selector)) {
				return false;
			}
		}
		return true;
	});
	// And any Enyo control that takes a click, or is a button whatever its
	// classes (Calculator's keys replace the button's class name), and holds
	// no other control. A container
	// with a handler (a list catching its rows' taps) is not one.
	if (window.enyo && enyo.$) {
		var handlers = [];
		Object.keys(enyo.$).forEach(function (id) {
			// Enyo 2 leaves a destroyed control's entry, as null.
			var c = enyo.$[id], n = c && c.hasNode && c.hasNode();
			if (!n) {
				return;
			}
			// onclick in Enyo 1, ontap in Enyo 2.
			var tappable = (typeof c.onclick === "string" && c.onclick) ||
				(typeof c.ontap === "string" && c.ontap) ||
				(enyo.CustomButton && c instanceof enyo.CustomButton);
			if (n && tappable && nodes.indexOf(n) < 0) {
				handlers.push(n);
			}
		});
		handlers.forEach(function (n) {
			var holds = nodes.concat(handlers).some(function (m) {
				return m !== n && n.contains(m);
			});
			var inside = nodes.some(function (m) {
				return m.contains(n);
			});
			if (!holds && !inside) {
				nodes.push(n);
			}
		});
	}
	nodes = nodes.filter(shown);

	// A view parked beside the screen, as a phone's sliding panes keep the
	// ones not shown: a whole box of the page past the left or right edge.
	// The user slides to it; it is not lost.
	function parked(node) {
		for (var a = node; a && a.nodeType === 1 && a !== document.body; a = a.parentNode) {
			var r = a.getBoundingClientRect();
			if (r.width > 0 && (r.left >= W - 1 || r.right <= 1)) {
				return true;
			}
		}
		return false;
	}

	var scrollers = [];
	nodes.forEach(function (n) {
		var r = rectOf(n), v = visibleOf(n);
		var target = n, vis = v.vis;
		// Inside a scroller: the scroller has to be usable instead.
		var sc = v.scroller;
		while (sc) {
			if (scrollers.indexOf(sc) < 0) {
				scrollers.push(sc);
			}
			var outer = visibleOf(sc);
			sc = outer.scroller;
			if (!sc) {
				target = null;
			}
		}
		if (!target || parked(n)) {
			return;
		}
		var frac = area(vis) / area(r);
		var d = describe(n);
		d.rect = round(r);
		if (frac === 0) {
			d.issue = "off-screen";
			issues.push(d);
		} else if (frac < 0.6) {
			d.issue = "clipped";
			d.detail = Math.round(frac * 100) + "% on screen";
			issues.push(d);
		} else {
			var x = (vis.left + vis.right) / 2, y = (vis.top + vis.bottom) / 2;
			var hit = document.elementFromPoint(x, y);
			if (hit && hit !== n && !n.contains(hit) && !hit.contains(n)) {
				d.issue = "covered";
				var by = describe(hit);
				d.detail = "under " + by.kind + (by.name ? " " + by.name : "") + (by.text ? " \"" + by.text + "\"" : "");
				issues.push(d);
			}
		}
	});

	// Every scroller on the page, not only those holding a control found
	// above (Notes' memos are no control kind).
	Array.prototype.forEach.call(document.body ? document.body.getElementsByTagName("*") : [], function (el) {
		if (scrollers.indexOf(el) < 0 && shown(el) && isScroller(el)) {
			scrollers.push(el);
		}
	});

	scrollers.forEach(function (sc) {
		var r = rectOf(sc), v = visibleOf(sc);
		if (v.scroller || parked(sc)) {
			return;  // judged with its own scroller, or parked
		}
		var h = v.vis.bottom - v.vis.top, w = v.vis.right - v.vis.left;
		if (h < Math.min(minScroller, r.bottom - r.top) || w < Math.min(minScroller, r.right - r.left)) {
			var d = describe(sc);
			d.issue = "squeezed";
			d.rect = round(r);
			d.detail = Math.round(w) + "x" + Math.round(h) + " of it on screen";
			issues.push(d);
		} else if (r.bottom - v.vis.bottom > cutScroller || r.right - v.vis.right > cutScroller) {
			// Scrolled to its end, the end is still past the window's edge:
			// what scrolls there cannot be reached.
			var c = describe(sc);
			c.issue = "scroller-cut";
			c.rect = round(r);
			c.detail = Math.round(Math.max(r.bottom - v.vis.bottom, r.right - v.vis.right)) + " px of it past the edge";
			issues.push(c);
		}
	});

	return {width: W, height: H, controls: nodes.length, issues: issues};
}

module.exports = {shim, check};
