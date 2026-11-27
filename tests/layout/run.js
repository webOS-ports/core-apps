#!/usr/bin/env node
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

// Lays every core app out on every device and reports what a user could not
// reach: see README.md.
//
//   node tests/layout/run.js [--device q25,sargo] [--app clock] [--view alarms]
"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const {spawn} = require("child_process");

const {connect} = require("./cdp");
const {devices} = require("./devices");
const {shim, check} = require("./page");
const {views} = require("./views");
const {Luna} = require("../harness/luna");

const REPO = path.resolve(__dirname, "../..");
const ENYO = process.env.ENYO || [path.resolve(REPO, "../enyo-1.0-ports"), path.resolve(REPO, "../enyo-1.0")]
	.find((d) => fs.existsSync(path.join(d, "framework/enyo.js")));
const LUNEOS_ROOT = process.env.LUNEOS_ROOT || "";
const CHROME = process.env.CHROME || "chromium";
const OUT = process.env.LAYOUT_OUT || path.join(__dirname, "out");
const MEDIA_NOISE = /^(NotSupportedError: Failed to load because no supported source|NotAllowedError: play\(\) failed)/;
const SETTLE_FIRST_MS = 2000, SETTLE_QUIET_MS = 800, SETTLE_MAX_MS = 15000;
const JOBS = Math.max(1, Number(process.env.LAYOUT_JOBS) || 4);
process.env.TZ = process.env.TEST_TZ || "Europe/Amsterdam";

function args() {
	const a = {device: [], app: [], view: []};
	const argv = process.argv.slice(2);
	for (let i = 0; i < argv.length; i++) {
		const m = /^--(device|app|view)(?:=(.*))?$/.exec(argv[i]);
		if (!m) {
			throw new Error("unknown argument " + argv[i]);
		}
		const v = m[2] !== undefined ? m[2] : argv[++i];
		a[m[1]].push(...v.split(",").filter(Boolean));
	}
	return a;
}

// The device's paths, served: the apps from this repository, Enyo from its
// checkout, and the rest (MojoLoader, the Calendar libraries,
// locale files) from a LuneOS rootfs when there is one.
const TYPES = {".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json",
	".png": "image/png", ".jpg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml",
	".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".wav": "audio/wav", ".mp3": "audio/mpeg"};

function fileFor(urlPath) {
	const p = path.posix.normalize(decodeURIComponent(urlPath));
	let m;
	if ((m = /^\/usr\/palm\/applications\/(com\.palm\.app\.[^/]+)(\/.*)?$/.exec(p)) &&
		fs.existsSync(path.join(REPO, m[1]))) {
		return path.join(REPO, m[1], m[2] || "/");
	}
	if ((m = /^\/usr\/palm\/frameworks\/enyo\/(?:0\.10|1\.0)(\/.*)?$/.exec(p))) {
		return path.join(ENYO, m[1] || "/");
	}
	return LUNEOS_ROOT ? path.join(LUNEOS_ROOT, p) : null;
}

// An Enyo checkout has no build/ (Yocto makes it), and the pages load
// build/enyo-build.js. In its place: what enyo.js does in debug mode, the
// framework from source, as the jsdom tests run it. The scripts it writes go
// in ahead of the app's depends.js, which enyo.js wrote after this one.
const ENYO_FROM_SOURCE = `
enyo.enyoPath = enyo.enyoPath.slice(0, enyo.enyoPath.lastIndexOf("/build")) + "/source";
enyo.isBuild = false;
document.write('<script src="' + enyo.enyoPath + '/dependency-loader.js"></script>');
document.write('<script>enyo.depends("$enyo/enyo");</script>');
`;

function serve() {
	const server = http.createServer((req, res) => {
		const urlPath = new URL(req.url, "http://x").pathname;
		if (/^\/usr\/palm\/frameworks\/enyo\/(0\.10|1\.0)\/framework\/build\/enyo-build\.js$/.test(urlPath) &&
			!fs.existsSync(path.join(ENYO, "framework/build/enyo-build.js"))) {
			res.writeHead(200, {"Content-Type": "text/javascript"});
			res.end(ENYO_FROM_SOURCE);
			return;
		}
		const file = fileFor(urlPath);
		fs.readFile(file || "", (err, data) => {
			if (err) {
				res.writeHead(404);
				res.end();
				return;
			}
			res.writeHead(200, {"Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
				"Cache-Control": "max-age=3600"});
			res.end(data);
		});
	});
	return new Promise((res) => server.listen(0, "127.0.0.1", () => res(server)));
}

async function startChrome() {
	const profile = path.join(OUT, "profile");
	fs.mkdirSync(profile, {recursive: true});
	const portFile = path.join(profile, "DevToolsActivePort");
	fs.rmSync(portFile, {force: true});
	const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
		"--hide-scrollbars", "--mute-audio", "--disable-popup-blocking", "--autoplay-policy=no-user-gesture-required", "--remote-debugging-port=0", "--user-data-dir=" + profile,
		"--force-color-profile=srgb", "--font-render-hinting=none", "about:blank"], {stdio: "ignore"});
	for (let i = 0; i < 150 && !fs.existsSync(portFile); i++) {
		await new Promise((r) => setTimeout(r, 100));
	}
	if (!fs.existsSync(portFile)) {
		proc.kill();
		throw new Error(CHROME + " did not start (no " + portFile + ")");
	}
	const [port, wsPath] = fs.readFileSync(portFile, "utf8").trim().split("\n");
	return {proc, ws: "ws://127.0.0.1:" + port + wsPath};
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One app in one window size: its windows attached as they open, each given
// the shim and the device's size, the bus answered by a fresh fake.
async function runView(cdp, base, device, view, appInfo) {
	const luna = new Luna();
	luna.win = {Date, setTimeout, closed: false};
	if (view.setup) {
		view.setup(luna);
	}
	const ctx = (await cdp.send("Target.createBrowserContext", {disposeOnDetach: true})).browserContextId;
	const windows = [];  // {sessionId, targetId, url}
	const errors = [], media = [];
	let lastBus = Date.now();
	const bridges = new Map();

	const cfg = {
		launchParams: JSON.stringify((typeof view.launch === "function" ? view.launch() : view.launch) || {}),
		identifier: appInfo.id + " 1001",
		TZ: process.env.TZ,
		deviceInfo: {modelName: device.name, screenWidth: device.panel[0], screenHeight: device.panel[1],
			minimumCardWidth: device.css[0], minimumCardHeight: device.css[1],
			maximumCardWidth: device.css[0], maximumCardHeight: device.css[1],
			keyboardAvailable: device.name === "q25", keyboardSlider: false, keyboardType: "QWERTY",
			tabletUi: !!device.tabletUi, platformVersion: "3.0.5"}
	};

	const onEvent = async (msg) => {
		const s = msg.sessionId;
		// Views run side by side in one browser: only this one's windows.
		if (s && !windows.some((x) => x.sessionId === s)) {
			if (process.env.DEBUG && msg.method === "Runtime.bindingCalled") {
				console.log("       [dropped] " + s.slice(0, 8) + " " + msg.params.payload.slice(0, 100));
			}
			return;
		}
		if (msg.method === "Target.attachedToTarget") {
			const {sessionId, targetInfo} = msg.params;
			if (targetInfo.browserContextId !== ctx || targetInfo.type !== "page") {
				return;
			}
			// A window committing its first page is attached again, on a new
			// session: the target stays, its session is the new one.
			const known = windows.find((x) => x.targetId === targetInfo.targetId);
			if (known) {
				if (process.env.DEBUG) {
					console.log("       [reattach] " + targetInfo.url + " " + known.sessionId.slice(0, 8) + " -> " + sessionId.slice(0, 8));
				}
				known.sessionId = sessionId;
				known.url = targetInfo.url;
				known.detached = false;
			} else {
				windows.push({sessionId, targetId: targetInfo.targetId, url: targetInfo.url});
			}
			try {
				await setUp(sessionId);
			} catch (e) {
				// Swapped for a new session before it was set up: that one
				// is set up when it attaches.
				if (!/Session with given id not found/.test(e.message)) {
					errors.push("attach: " + e.message);
				}
			}
		} else if (msg.method === "Target.detachedFromTarget") {
			const i = windows.findIndex((x) => x.sessionId === msg.params.sessionId);
			// Closed, or about to be attached again on a new session (above).
			if (i >= 0) {
				windows[i].detached = true;
			}
		} else if (msg.method === "Target.targetDestroyed") {
			const i = windows.findIndex((x) => x.targetId === msg.params.targetId);
			if (i >= 0) {
				windows.splice(i, 1);
			}
		} else if (msg.method === "Target.targetInfoChanged") {
			const w = windows.find((x) => x.targetId === msg.params.targetInfo.targetId);
			if (w) {
				w.url = msg.params.targetInfo.url;
			}
		} else if (msg.method === "Runtime.bindingCalled" && msg.params.name === "__lunaCall" && s) {
			lastBus = Date.now();
			const c = JSON.parse(msg.params.payload);
			const key = s + ":" + c.id;
			if (c.op === "cancel") {
				const b = bridges.get(key);
				if (b) {
					b.cancel();
				}
				return;
			}
			let b = bridges.get(key);
			if (!b) {
				b = {
					win: luna.win,
					cancelled: false,
					onservicecallback: (response) => {
						lastBus = Date.now();
						if (process.env.DEBUG) {
							console.log("       [bus] " + c.uri + " <- " + JSON.stringify(response).slice(0, 160));
						}
						// What the page's callback throws comes back here, not as
						// Runtime.exceptionThrown.
						cdp.send("Runtime.evaluate", {expression: "window.__lunaDeliver && __lunaDeliver(" + c.id + ", " +
							JSON.stringify(response) + ")"}, s).then((r) => {
							const d = r && r.exceptionDetails;
							if (d) {
								errors.push((d.exception && d.exception.description || d.text).split("\n")[0] +
									" (answering " + c.uri + ")");
							}
						}).catch(() => {});
					},
					cancel() {
						this.cancelled = true;
						luna.subscriptions = luna.subscriptions.filter((x) => x.bridge !== this);
					}
				};
				bridges.set(key, b);
			}
			if (process.env.DEBUG) {
				console.log("       [bus] " + c.uri + " -> " + String(c.json).slice(0, 120));
			}
			try {
				luna.dispatch(b, c.uri, c.json);
			} catch (e) {
				errors.push("bus " + c.uri + ": " + e.message);
			}
		} else if (msg.method === "Runtime.consoleAPICalled" && s && process.env.DEBUG) {
			console.log("       [" + msg.params.type + "] " + msg.params.args.map((x) =>
				x.value !== undefined ? String(x.value) : x.description || x.type).join(" ").slice(0, 300));
		} else if (msg.method === "Target.targetCreated" && process.env.DEBUG) {
			console.log("       [target] " + msg.params.targetInfo.type + " " + msg.params.targetInfo.url);
		} else if (msg.method === "Runtime.exceptionThrown" && s) {
			const d = msg.params.exceptionDetails;
			const text = d.exception && d.exception.description || d.text;
			// A ringtone the host cannot play (a device path, or a codec this
			// Chromium lacks) is no layout matter; the jsdom tests check what
			// the app plays.
			if (MEDIA_NOISE.test(text)) {
				media.push(text.split("\n")[0]);
				return;
			}
			errors.push((d.exception && d.exception.description || d.text).split("\n")[0] +
				(d.url ? " (" + d.url.replace(base, "") + ":" + d.lineNumber + ")" : ""));
		}
	};

	async function setUp(sessionId) {
		const send = (m, p) => cdp.send(m, p, sessionId);
		await send("Emulation.setDeviceMetricsOverride", {width: device.css[0], height: device.css[1],
			deviceScaleFactor: device.zoom, mobile: false});
		await send("Runtime.addBinding", {name: "__lunaCall"});
		await send("Page.enable");
		await send("Page.addScriptToEvaluateOnNewDocument", {source: "(" + shim.toString() + ")(" + JSON.stringify(cfg) + ");"});
		await send("Runtime.enable");
		await send("Runtime.runIfWaitingForDebugger");
	}

	const listener = (msg) => {
		onEvent(msg).catch((e) => errors.push(e.message));
	};
	cdp.on(listener);

	await cdp.send("Target.createTarget", {url: "about:blank", browserContextId: ctx});
	for (let i = 0; i < 50 && !windows.length; i++) {
		await sleep(50);
	}
	if (!windows.length) {
		throw new Error("no window attached");
	}
	await sleep(100);
	await cdp.send("Page.navigate", {url: base + "/usr/palm/applications/" + appInfo.id + "/" + (appInfo.main || "index.html")},
		windows[0].sessionId);

	async function settle(min = 0) {
		const start = Date.now();
		await sleep(min);
		lastBus = Date.now();
		while (Date.now() - start < SETTLE_MAX_MS) {
			await sleep(100);
			if (luna.inflight === 0 && Date.now() - lastBus > SETTLE_QUIET_MS) {
				break;
			}
		}
		await sleep(300);
	}
	// At least SETTLE_FIRST_MS for the first layout: fonts, images and the
	// app's own startup timers, which no bus call announces.
	await settle(SETTLE_FIRST_MS);

	// The card: the window the user sees. An app whose first page opens no
	// window of its own (noWindow, as Clock's launcher) shows the last one it
	// opened - once it has: with several devices loading at once it can take
	// longer than the first settle, and the check then measured the empty
	// launcher page and found nothing wrong.
	const evalIn = async (w, expression) => {
		const r = await cdp.send("Runtime.evaluate", {expression, awaitPromise: true, returnByValue: true}, w.sessionId);
		if (r.exceptionDetails) {
			throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text).split("\n")[0]);
		}
		return r.result.value;
	};
	const live = () => windows.filter((x) => !x.detached);
	const card = () => {
		const l = live();
		return appInfo.noWindow && l.length > 1 ? l[l.length - 1] : l[0];
	};
	if (appInfo.noWindow && !view.window) {
		for (const t = Date.now(); live().length < 2 && Date.now() - t < SETTLE_MAX_MS;) {
			await sleep(100);
		}
		if (live().length < 2) {
			errors.push("the app opened no card");
		} else {
			await loaded(card());
		}
		// A card still loading Enyo makes no bus calls for a while: as long
		// as the first page gets, not just a quiet bus.
		await settle(SETTLE_FIRST_MS);
	}

	// Until the window's page has loaded (Enyo writes its scripts in), or
	// SETTLE_MAX_MS.
	async function loaded(win) {
		for (const t = Date.now(); Date.now() - t < SETTLE_MAX_MS; await sleep(100)) {
			try {
				if (await evalIn(win, "document.readyState") === "complete") {
					return;
				}
			} catch (e) {
				// not there yet
			}
		}
	}

	for (const step of view.steps || []) {
		try {
			await evalIn(card(), "(function(){" + step + "})()");
		} catch (e) {
			errors.push("step: " + e.message);
		}
		await settle();
	}

	// A view of another window (a popup alert): the last one whose page
	// matches. It is as wide as the shell shows popups (devices.js) and as
	// tall as its opener asked, in the page's pixels (window.open's
	// "height="), which WebAppMgr zooms with the page.
	let w = card();
	if (view.window) {
		const re = new RegExp(view.window);
		// The popup can open late too.
		let match = [];
		for (const t = Date.now(); Date.now() - t < SETTLE_MAX_MS; await sleep(100)) {
			match = live().filter((x) => re.test(x.url));
			if (match.length) {
				break;
			}
		}
		if (match.length) {
			await settle();
		}
		if (!match.length) {
			errors.push("no window " + view.window + " (" + windows.map((x) => x.url.replace(base, "")).join(", ") + ")");
		} else {
			w = match[match.length - 1];
			let opened = [];
			try {
				opened = await evalIn(live()[0], "window.__opened || []");
			} catch (e) {
				errors.push("opened: " + e.message);
			}
			const asked = opened.filter((o) => re.test(o.url)).pop();
			const h = asked && /(?:^|,)\s*height=(\d+)/.exec(asked.features);
			if (h) {
				await cdp.send("Emulation.setDeviceMetricsOverride", {width: device.popupWidth, height: Number(h[1]),
					deviceScaleFactor: device.zoom, mobile: false}, w.sessionId);
			}
			// A popup's page is transparent over the shell's black panel.
			await cdp.send("Emulation.setDefaultBackgroundColorOverride", {color: {r: 0, g: 0, b: 0, a: 1}}, w.sessionId);
			await sleep(300);
		}
	}
	let result;
	try {
		result = await evalIn(w, "(" + check.toString() + ")(" + JSON.stringify(view.check || {}) + ")");
	} catch (e) {
		result = {issues: [], error: e.message};
	}
	// Nothing to check is not a clean layout: the wrong window, or a page
	// that did not come up.
	if (!result.error && !result.controls) {
		result.issues.push({issue: "no-controls", detail: "no control found in " + w.url.replace(base, "")});
	}
	const shotDir = path.join(OUT, "shots", device.name);
	fs.mkdirSync(shotDir, {recursive: true});
	const shot = path.join(shotDir, view.app.replace("com.palm.app.", "") + "-" + view.name + ".png");
	try {
		const img = await cdp.send("Page.captureScreenshot", {format: "png"}, w.sessionId);
		fs.writeFileSync(shot, Buffer.from(img.data, "base64"));
	} catch (e) {
		errors.push("screenshot: " + e.message);
	}

	const opened = live().length;
	await cdp.send("Target.disposeBrowserContext", {browserContextId: ctx}).catch(() => {});
	cdp.off(listener);
	return Object.assign(result, {window: w.url.replace(base, ""), windows: opened, errors, media, shot: path.relative(OUT, shot)});
}

async function main() {
	const a = args();
	if (!ENYO) {
		throw new Error("no Enyo 1.0: set ENYO to an enyo-1.0-ports checkout");
	}
	const devs = devices(a.device);
	const todo = views(REPO).filter((v) => (!a.app.length || a.app.some((x) => v.app.endsWith(x))) &&
		(!a.view.length || a.view.includes(v.name)));
	const server = await serve();
	const base = "http://127.0.0.1:" + server.address().port;
	const chrome = await startChrome();
	const cdp = await connect(chrome.ws);
	// Every window any app opens is attached before its scripts run; each view
	// takes those of its own browser context.
	await cdp.send("Target.setAutoAttach", {autoAttach: true, waitForDebuggerOnStart: true, flatten: true});
	await cdp.send("Target.setDiscoverTargets", {discover: true});
	const results = [];
	let failed = 0;
	try {
		for (const view of todo) {
			const appInfo = JSON.parse(fs.readFileSync(path.join(REPO, view.app, "appinfo.json"), "utf8"));
			if (view.needsRootfs && !LUNEOS_ROOT) {
				console.log("SKIP " + view.app + " " + view.name + ": needs LUNEOS_ROOT");
				continue;
			}
			// LAYOUT_JOBS devices at a time, each in its own browser context.
			const runs = [];
			for (let k = 0; k < devs.length; k += JOBS) {
				runs.push(...await Promise.all(devs.slice(k, k + JOBS).map((d) => runView(cdp, base, d, view, appInfo)
					.catch((e) => ({issues: [], errors: [e.message], error: e.message})))));
			}
			for (let k = 0; k < devs.length; k++) {
				const d = devs[k], r = runs[k];
				r.device = d.name;
				r.app = view.app;
				r.view = view.name;
				results.push(r);
				const bad = r.issues.length || r.error || r.errors.length;
				failed += bad ? 1 : 0;
				console.log((bad ? "FAIL " : "ok   ") + d.name.padEnd(12) + view.app.replace("com.palm.app.", "").padEnd(10) +
					view.name.padEnd(14) + (r.width ? r.width + "x" + r.height : "") +
					(r.error ? "  error: " + r.error : ""));
				for (const i of r.issues) {
					console.log("       " + i.issue.padEnd(14) + (i.kind ? i.kind + (i.name ? " " + i.name : "") : "") +
						(i.text ? " \"" + i.text + "\"" : "") + (i.rect ? " at " + i.rect.join(",") : "") +
						(i.detail ? "  (" + i.detail + ")" : ""));
				}
				for (const e of r.errors.slice(0, 3)) {
					console.log("       page error: " + e);
				}
			}
		}
	} finally {
		cdp.close();
		chrome.proc.kill();
		server.close();
	}
	fs.mkdirSync(OUT, {recursive: true});
	fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({devices: devs, results}, null, 1));
	console.log("\n" + (results.length - failed) + " of " + results.length + " layouts clean; screenshots in " +
		path.join(OUT, "shots"));
	process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
	console.error(e.stack || e.message);
	process.exitCode = 2;
});
