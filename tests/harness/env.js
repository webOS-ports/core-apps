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

// Boots one page of a core-apps app in a jsdom window the way WebAppMgr does
// on a device: the page's scripts in order, with the real Enyo 1 framework
// from source and the app's depends.js. What the device provides is faked:
// PalmSystem, palmGetResource, the luna bus (luna.js), the clock (setNow),
// and the window manager and media elements, which record what the app asks
// of them. See tests/README.md.
"use strict";

// Local times in the tests are Amsterdam times, with its DST changes. Set
// before any Date exists in this process.
process.env.TZ = process.env.TEST_TZ || "Europe/Amsterdam";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {pathToFileURL, fileURLToPath} = require("url");
const {JSDOM, VirtualConsole} = require("jsdom");
const {Luna} = require("./luna");

const REPO = path.resolve(__dirname, "../..");

// settle() waits for page timers of up to SETTLE_TIMER_MS, for at most
// SETTLE_MAX_MS in all.
const SETTLE_TIMER_MS = 500;
const SETTLE_MAX_MS = 3000;
const DEVICE_ENYO = "/usr/palm/frameworks/enyo/0.10";

// A LuneOS root filesystem (a device's, or a Yocto image's rootfs) for the
// parts of /usr/palm that are not Enyo: MojoLoader and the libraries it
// loads, ringtones, and so on. Optional; tests that need it say so.
const LUNEOS_ROOT = process.env.LUNEOS_ROOT ? path.resolve(process.env.LUNEOS_ROOT) : null;

// The Enyo 1.0 checkout: $ENYO, or enyo-1.0-ports / enyo-1.0 next to this
// repository, or the one in $LUNEOS_ROOT.
function findEnyo() {
	const candidates = [
		process.env.ENYO,
		path.resolve(REPO, "../enyo-1.0-ports"),
		path.resolve(REPO, "../enyo-1.0"),
		LUNEOS_ROOT && path.join(LUNEOS_ROOT, DEVICE_ENYO)
	].filter(Boolean);
	for (const c of candidates) {
		if (fs.existsSync(path.join(c, "framework/source/enyo-depends.js"))) {
			return path.resolve(c);
		}
	}
	throw new Error("Enyo 1.0 not found; set ENYO to an enyo-1.0-ports checkout. Looked in:\n  " + candidates.join("\n  "));
}

const ENYO = findEnyo();

class NeedsLuneOSRoot extends Error {
	constructor(file) {
		super(file + " is not part of Enyo; set LUNEOS_ROOT to a LuneOS root filesystem to provide it");
		this.file = file;
	}
}

// A device path as a host path: Enyo comes from ENYO, the rest of /usr/palm
// from LUNEOS_ROOT.
function devicePath(p) {
	if (p === DEVICE_ENYO || p.startsWith(DEVICE_ENYO + "/")) {
		return ENYO + p.slice(DEVICE_ENYO.length);
	}
	if (LUNEOS_ROOT) {
		return path.join(LUNEOS_ROOT, p);
	}
	throw new NeedsLuneOSRoot(p);
}

// The app directory for an app id or a path.
function appDir(app) {
	const dir = path.isAbsolute(app) ? app : path.join(REPO, app);
	if (!fs.existsSync(path.join(dir, "appinfo.json"))) {
		throw new Error("no appinfo.json in " + dir);
	}
	return dir;
}

const sources = new Map();
function read(file) {
	if (!sources.has(file)) {
		sources.set(file, fs.readFileSync(file, "utf8"));
	}
	return sources.get(file);
}

// The page's <script> tags, in order: {src, attrs, body}.
function pageScripts(html) {
	const out = [];
	for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
		const attrs = {};
		for (const a of m[1].matchAll(/([\w-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
			attrs[a[1].toLowerCase()] = a[3] !== undefined ? a[3] : a[4];
		}
		out.push({src: attrs.src, attrs, body: m[2]});
	}
	return out;
}

// What the page reads from PalmSystem. Methods only record that they were
// called; they are the ones a device's PalmSystem has (mindphone,
// 2026-11-03), so code that checks for one (enyo.string.runTextIndexer, say)
// takes the path it takes on a device.
function fakePalmSystem(calls, identifier) {
	const values = {
		launchParams: "{}",
		identifier,
		locale: "en_us",
		localeRegion: "us",
		phoneRegion: "us",
		timeFormat: "HH24",
		TZ: process.env.TZ,
		deviceInfo: JSON.stringify({modelName: "test", screenWidth: 720, screenHeight: 720}),
		screenOrientation: "up",
		isActivated: true,
		useSimulatedMouseClicks: false
	};
	const methods = ["PmLogInfoWithClock", "PmLogString", "PmTrace", "PmTraceAfter", "PmTraceBefore", "PmTraceItem",
		"activate", "addBannerMessage", "addNewContentIndicator", "applyLaunchFeedback", "clearBannerMessages",
		"close", "containerReady", "copiedToClipboard", "deactivate", "editorFocused", "enableFullScreenMode",
		"focusLayer", "focusOwner", "getIdentifier", "getResource", "hide", "keepAlive", "keyboardHide",
		"keyboardShow", "markFirstUseDone", "onCloseNotify", "paste", "pastedFromClipboard", "platformBack",
		"playSoundNotification", "reloadInjectionData", "removeBannerMessage", "removeNewContentIndicator",
		"serviceCall", "setAlertSound", "setCursor", "setCursorHidden", "setInputRegion", "setKeyMask",
		"setLoadErrorPolicy", "setManualKeyboardEnabled", "setWindowOrientation", "setWindowProperty",
		"simulateMouseClick", "stagePreparing", "stageReady", "updateInjectionData"];
	const ps = Object.assign({}, values);
	for (const m of methods) {
		ps[m] = (...args) => {
			calls.push({method: m, args});
		};
	}
	return ps;
}

// Console output that comes from the host, not the app.
const HOST_NOISE = [
	// Enyo looks for Tellurium (Palm's UI automation hook) under
	// /usr/palm/frameworks/tellurium/, which a device has and a host does not.
	"/usr/palm/frameworks/tellurium/tellurium_config.json"
];

/**
 * Boots a page. options:
 *   app        app id (directory under core-apps) or path; required
 *   page       the page, relative to the app (default "index.html")
 *   now        the page's clock to start with
 *   launch     launch params: also launch() right after booting
 *   windowParams  the page's enyo.windowParams, for a page another one opens
 *   stubWindows   windows the app opens get stand-ins instead of their pages
 *
 * Returns:
 *   window, enyo, luna        the page, its enyo, the fake bus
 *   app, appInfo              the app directory and its appinfo.json
 *   setNow(date | string)     sets the page's clock ("2026-11-04T07:05:00" is local time)
 *   settle()                  waits until the bus is idle and the page's short
 *                             timers (up to SETTLE_TIMER_MS) have run
 *   launch(params)            launches the app with params as WebAppMgr does: the
 *                             first time by running the rest of the page, later
 *                             through Mojo.relaunch
 *   fireActivity(name)        an activity's time comes and its callback runs
 *   create(props)             creates a component, destroyed by close()
 *   tap(control)              taps a rendered control
 *   windows                   the windows the app opened (see installWindowAgent)
 *   windowNamed(name)         one of them, by name
 *   audio, palmSystem         what the app did with media elements and PalmSystem
 *   logs, errors              console output of the app's windows; errors also has
 *                             uncaught exceptions
 *   load(file)                runs a script file in the page
 *   close()                   closes the page and the windows it opened
 */
function boot(options = {}) {
	const app = appDir(options.app);
	const appInfo = JSON.parse(read(path.join(app, "appinfo.json")));
	const identifier = appInfo.id + " 1001";

	// What every window of the app shares.
	const logs = [], errors = [], audio = [], windows = [], palmSystemCalls = [];
	const luna = new Luna();
	// The DB8 kinds the app installs (configuration/db/kinds), for the kinds
	// that extend others.
	const kindDir = path.join(app, "configuration", "db", "kinds");
	for (const f of fs.existsSync(kindDir) ? fs.readdirSync(kindDir) : []) {
		for (const k of [].concat(JSON.parse(fs.readFileSync(path.join(kindDir, f), "utf8")))) {
			if (k.id && k.extends) {
				luna.db.extend(k.id, k.extends);
			}
		}
	}
	const time = {offset: 0};
	// The short timers pending in the app's windows (see createWindow).
	const pending = new Set();
	// The app's localStorage, shared by its windows as on a device.
	const storage = new Map();
	let sender = null; // the window whose scripts are running (see postMessage)

	const reportError = (msg) => {
		if (!HOST_NOISE.some((n) => msg.includes(n))) {
			errors.push(msg);
		}
	};
	const vc = new VirtualConsole();
	vc.on("log", (...a) => logs.push(a.join(" ")));
	vc.on("info", (...a) => logs.push(a.join(" ")));
	vc.on("warn", (...a) => logs.push(a.join(" ")));
	vc.on("error", (...a) => reportError(a.join(" ")));
	vc.on("jsdomError", (e) => {
		// An uncaught exception comes with the page's error as its cause.
		const d = e && (e.cause || e.detail);
		reportError(String(d && d.stack || e && (e.stack || e.message) || e));
	});

	// A window for pageFile, with what WebAppMgr provides installed but none
	// of the page's scripts run yet. Returns {win, ctx, load, ...}.
	function createWindow(pageFile, opener, palmSystemLog) {
		const pageDirectory = path.dirname(pageFile);
		const html = read(pageFile);
		// The page's own markup, without its scripts (they are run below).
		const dom = new JSDOM(html.replace(/<script\b[\s\S]*?<\/script>/gi, ""), {
			url: pathToFileURL(pageFile).href,
			runScripts: "outside-only",
			pretendToBeVisual: true,
			virtualConsole: vc
		});
		const win = dom.window;
		const ctx = dom.getInternalVMContext();
		if (opener) {
			Object.defineProperty(win, "opener", {value: opener, configurable: true, writable: true});
		}
		// jsdom has no window.closed; Enyo takes a window as open only while
		// it is false.
		let isClosed = false;
		const jsdomClose = win.close.bind(win);
		Object.defineProperty(win, "closed", {get: () => isClosed, configurable: true});
		win.close = () => {
			if (!isClosed) {
				isClosed = true;
				jsdomClose();
			}
		};
		const load = (file) => new vm.Script(read(file), {filename: file}).runInContext(ctx);
		// A script the page names but that is not there: on a device the load
		// fails, Enyo's loader logs it (enyo.script's onerror), and the page
		// goes on.
		const loadScript = (file) => {
			if (!fs.existsSync(file)) {
				reportError("Error loading script " + file);
				return;
			}
			load(file);
		};
		// A script src: relative to the page, a device path (/usr/palm/...), or
		// already a host path (Enyo's loader names its own files that way).
		const resolve = (src) => {
			src = src.split("?")[0];
			// Enyo's g11n asks for app files by file:// URL.
			if (src.startsWith("file://")) {
				src = fileURLToPath(src);
			}
			if (src.startsWith("/usr/palm/")) {
				return devicePath(src);
			}
			return path.isAbsolute(src) ? src : path.join(pageDirectory, src);
		};

		// The window's clock, shared with the app's other windows.
		// Short timers the page sets are pending work settle() waits for
		// (a debounced reload, say); longer ones are scheduled for later.
		const realSetTimeout = win.setTimeout.bind(win), realClearTimeout = win.clearTimeout.bind(win);
		const own = new Map();
		win.setTimeout = (fn, ms, ...args) => {
			if (typeof fn !== "function" || Number(ms) > SETTLE_TIMER_MS) {
				return realSetTimeout(fn, ms, ...args);
			}
			const entry = {};
			const id = realSetTimeout((...a) => {
				pending.delete(entry);
				own.delete(id);
				fn(...a);
			}, ms, ...args);
			own.set(id, entry);
			pending.add(entry);
			return id;
		};
		win.clearTimeout = (id) => {
			pending.delete(own.get(id));
			own.delete(id);
			realClearTimeout(id);
		};
		win.addEventListener("unload", () => own.forEach((entry) => pending.delete(entry)));

		const RealDate = win.Date;
		win.Date = class extends RealDate {
			constructor(...args) {
				if (args.length === 0) {
					super(RealDate.now() + time.offset);
				} else {
					super(...args);
				}
			}
			static now() {
				return RealDate.now() + time.offset;
			}
		};

		luna.install(win);
		win.PalmSystem = fakePalmSystem(palmSystemLog, identifier);
		// Device resources (locale files and the like); a missing one is "",
		// as on a device.
		// jsdom has no localStorage for file:// pages; WebAppMgr gives
		// apps one.
		const localStorage = {
			get length() {
				return storage.size;
			},
			key: (i) => [...storage.keys()][i] ?? null,
			getItem: (k) => storage.has(String(k)) ? storage.get(String(k)) : null,
			setItem: (k, v) => {
				storage.set(String(k), String(v));
			},
			removeItem: (k) => {
				storage.delete(String(k));
			},
			clear: () => storage.clear()
		};
		Object.defineProperty(win, "localStorage", {configurable: true, get: () => localStorage});

		win.palmGetResource = (file) => {
			try {
				return fs.readFileSync(resolve(file), "utf8");
			} catch (e) {
				return "";
			}
		};

		// jsdom has no media playback; record what the app does with its media.
		win.HTMLMediaElement.prototype.play = function () {
			audio.push({op: "play", src: this.src});
			return win.Promise.resolve();
		};
		win.HTMLMediaElement.prototype.pause = function () {
			audio.push({op: "pause", src: this.src});
		};
		win.HTMLMediaElement.prototype.load = function () {
			audio.push({op: "load", src: this.src});
		};

		// jsdom leaves a message's source null; a browser sets it to the
		// sender, and Enyo's window manager reads it. The sender is the window
		// whose scripts are running when a page loads (a new window telling its
		// opener it is ready), else the window itself.
		win.postMessage = function (data) {
			const source = sender || win;
			win.setTimeout(() => win.dispatchEvent(new win.MessageEvent("message", {data, source})), 0);
		};

		const page = {win, ctx, load, loadScript, resolve, pageFile, html, launchScripts: []};

		// Enyo's own enyo.js, in debug mode: the loader, then the framework
		// from source. Its document.write is replaced by loading each file
		// right away, which runs everything in the same order. "launch" args
		// on the script tag (nobridge, ...) are honoured; debug/nodebug only
		// pick source or build, and these tests always run the source.
		page.bootEnyo = (tag) => {
			const args = {};
			for (const a of (tag.attrs.launch || "").split("&").filter(Boolean)) {
				const [k, v] = a.split("=");
				args[k] = v === undefined ? true : v;
			}
			// An opener may have put windowParams on window.enyo already.
			win.eval("enyo = window.enyo || {};");
			win.enyo.args = args;
			win.enyo.isBuild = false;
			win.enyo.enyoPath = path.join(ENYO, "framework/source");
			load(path.join(win.enyo.enyoPath, "dependency-loader.js"));
			win.enyo.script = (src) => loadScript(resolve(src));
			win.enyo.sheet = () => {};
			win.eval('enyo.depends("$enyo/enyo");');
			load(resolve(args.app || "depends.js"));
			installWindowAgent(win.enyo, win);
		};

		page.runScript = (s) => {
			if (s.src) {
				loadScript(resolve(s.src));
			} else if (s.body.trim()) {
				new vm.Script(s.body, {filename: pageFile}).runInContext(ctx);
			}
		};

		// Up to and including Enyo, the page loads now; what follows starts
		// the app and is page.launchScripts.
		page.loadUpToEnyo = () => {
			const scripts = pageScripts(html);
			const enyoAt = scripts.findIndex((s) => s.src && /(^|\/)enyo\.js$/.test(s.src));
			if (enyoAt < 0) {
				throw new Error(pageFile + " does not load enyo.js");
			}
			const prev = sender;
			sender = win;
			try {
				scripts.slice(0, enyoAt).forEach(page.runScript);
				page.bootEnyo(scripts[enyoAt]);
			} finally {
				sender = prev;
			}
			page.launchScripts = scripts.slice(enyoAt + 1);
		};
		page.runLaunchScripts = () => {
			const prev = sender;
			sender = win;
			try {
				page.launchScripts.forEach(page.runScript);
			} finally {
				sender = prev;
			}
		};
		return page;
	}

	// The windows the app opens: cards, popups and dashboards. Enyo's window
	// code runs as it is; only its window.open() (enyo.windows.agent.open) is
	// replaced. A page of the app opens as a real window -- its page loads on
	// the next tick, as after a browser's window.open() -- and so does every
	// other window unless options.stubWindows; a page outside the app (or any,
	// with stubWindows) gets a stand-in that records what is posted to it.
	// Each opened window is recorded in windows as { url, name, type ("card",
	// "popupalert", "dashboard"), attributes, info, closed, window (the
	// window or stand-in), palmSystem (calls on its PalmSystem), messages
	// (posted to a stand-in) }.
	function installWindowAgent(enyo, openerWin) {
		enyo.windows.agent.open = (opener, url, name, attributes, info) => {
			const attrs = typeof attributes === "string" ? JSON.parse(attributes) : JSON.parse(JSON.stringify(attributes || {}));
			const absolute = enyo.makeAbsoluteUrl(openerWin, url);
			const file = absolute.startsWith("file://") ? decodeURIComponent(new URL(absolute).pathname) : null;
			const rec = {url: absolute, type: attrs.window, attributes: attrs, info, palmSystem: [], messages: []};
			let w;
			if (file && !options.stubWindows && file.startsWith(app + path.sep) && fs.existsSync(file)) {
				const page = createWindow(file, opener, rec.palmSystem);
				w = page.win;
				w.name = name;
				rec.page = page;
				// After the opener has named it and handed it its params.
				openerWin.setTimeout(() => {
					if (w.closed) {
						return;
					}
					try {
						page.loadUpToEnyo();
						page.runLaunchScripts();
					} catch (e) {
						reportError(String(e && e.stack || e));
					}
					// A new card comes up focused: WebAppMgr activates it.
					if ((attrs.window || "card") === "card") {
						w.setTimeout(() => {
							if (!w.closed && w.Mojo && w.Mojo.stageActivated) {
								try {
									w.Mojo.stageActivated();
								} catch (e) {
									reportError(String(e && e.stack || e));
								}
							}
						}, 0);
					}
				}, 0);
			} else {
				w = {name, closed: false, close() {
					w.closed = true;
				}, postMessage(data) {
					rec.messages.push(data);
				}};
				w.PalmSystem = fakePalmSystem(rec.palmSystem, identifier);
			}
			rec.window = w;
			Object.defineProperty(rec, "name", {get: () => w.name, enumerable: true});
			Object.defineProperty(rec, "closed", {get: () => !!w.closed, enumerable: true});
			windows.push(rec);
			return w;
		};
	}

	const root = createWindow(path.join(app, options.page || "index.html"), null, palmSystemCalls);
	const win = root.win;
	if (options.now) {
		time.offset = new Date(options.now).getTime() - Date.now();
	}
	if (options.windowParams) {
		win.enyo = {windowParams: options.windowParams};
	}
	root.loadUpToEnyo();

	const enyo = win.enyo;
	let launched = false;
	const owned = [];
	const env = {
		window: win,
		enyo,
		luna,
		app,
		appInfo,
		windows,
		audio,
		logs,
		errors,
		palmSystem: palmSystemCalls,
		load: root.load,
		setNow(d) {
			time.offset = new win.Date(d).getTime() - (win.Date.now() - time.offset);
		},
		launch(params = {}) {
			win.PalmSystem.launchParams = JSON.stringify(params);
			if (launched) {
				return win.Mojo.relaunch();
			}
			launched = true;
			root.runLaunchScripts();
			return true;
		},
		fireActivity(name) {
			const cb = luna.activities.fire(name);
			const launchers = ["luna://com.palm.applicationManager/launch", "luna://com.webos.service.applicationManager/launch"];
			if (!launchers.includes(cb.method.replace(/^palm:/, "luna:")) || cb.params.id !== appInfo.id) {
				throw new Error("activity " + name + " does not launch " + appInfo.id + ": " + JSON.stringify(cb));
			}
			return env.launch(cb.params.params);
		},
		// The window the app opened with this name, once its page has loaded.
		windowNamed(name) {
			const rec = windows.find((r) => r.name === name && !r.closed);
			return rec && rec.window;
		},
		create(props) {
			const c = enyo.create(props);
			owned.push(c);
			return c;
		},
		tap(control) {
			const node = control.hasNode();
			if (!node) {
				throw new Error("tap: " + control.name + " is not rendered");
			}
			const w = node.ownerDocument.defaultView;
			for (const type of ["mousedown", "mouseup", "click"]) {
				node.dispatchEvent(new w.MouseEvent(type, {bubbles: true, cancelable: true}));
			}
		},
		async settle() {
			// A page that keeps setting short timers (polling) settles after
			// SETTLE_MAX_MS.
			const deadline = Date.now() + SETTLE_MAX_MS;
			for (let quiet = 0; quiet < 3 && Date.now() < deadline;) {
				await new Promise((r) => setTimeout(r, 2));
				quiet = luna.inflight || pending.size ? 0 : quiet + 1;
			}
		},
		close() {
			for (const c of owned) {
				if (!c.destroyed) {
					c.destroy();
				}
			}
			for (const r of windows) {
				if (r.page && !r.window.closed) {
					r.window.close();
				}
			}
			win.close();
		}
	};
	if (options.launch) {
		env.launch(options.launch);
	}
	return env;
}

module.exports = {boot, REPO, ENYO, LUNEOS_ROOT, NeedsLuneOSRoot, devicePath, pageScripts};
