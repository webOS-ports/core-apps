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

// Drives com.palm.app.tasks through real mouse/keyboard events over the Chrome
// DevTools Protocol and checks the results in the UI and in the database
// (through the app's own Tasks.Service, so on a device it is the real DB8 with
// the app's permissions). See README.md.
//
//   node run.js browser <target>     mock DB (index-desktop.html), wide window
//   node run.js phone   <target>     the same at 450x380: the one-view layout
//   node run.js device  <target>     real DB8; only touches lists named "ZT ..."
//
// <target> is a DevTools endpoint (http://127.0.0.1:9333) or a page's ws:// URL.
"use strict";
const {connect} = require("./cdp");
const fs = require("fs");

const MODE = process.argv[2], TARGET = process.argv[3];
if (["browser", "phone", "device"].indexOf(MODE) < 0 || !TARGET) {
	console.error("usage: node run.js browser|phone|device <DevTools http endpoint or page ws URL>");
	process.exit(2);
}
const DEVICE = MODE === "device", PHONE = MODE === "phone";
const SHOTS = process.env.SHOTS || __dirname + "/shots-" + MODE;
fs.mkdirSync(SHOTS, {recursive: true});

let cdp, results = [], consoleErrors = [], shotNo = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ev(expr) {
	const r = await cdp.send("Runtime.evaluate", {expression: expr, awaitPromise: true, returnByValue: true});
	if (r.exceptionDetails) {
		throw new Error("eval failed: " + expr.slice(0, 120) + " -> " +
			(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
	}
	return r.result.value;
}

async function waitFor(expr, ms = 4000) {
	const end = Date.now() + ms * (DEVICE ? 2 : 1);
	let v;
	while (Date.now() < end) {
		try {
			v = await ev(expr);
			if (v) {
				return v;
			}
		} catch (e) {}
		await sleep(100);
	}
	return v;
}

function check(name, ok, detail) {
	results.push({name, ok: !!ok, detail});
	console.log((ok ? "PASS " : "FAIL ") + name + (detail !== undefined && !ok ? "  -> " + JSON.stringify(detail) : ""));
}

async function shot(label) {
	const r = await cdp.send("Page.captureScreenshot", {format: "png"});
	const f = `${SHOTS}/${String(++shotNo).padStart(2, "0")}-${label}.png`;
	fs.writeFileSync(f, Buffer.from(r.data, "base64"));
}

// ---- input

async function mouse(type, x, y, extra = {}) {
	await cdp.send("Input.dispatchMouseEvent", Object.assign({type, x, y, button: "left", clickCount: 1,
		buttons: type === "mouseReleased" ? 0 : 1}, extra));
}

async function tapAt(x, y) {
	await mouse("mouseMoved", x, y, {buttons: 0});
	await mouse("mousePressed", x, y);
	await sleep(40);
	await mouse("mouseReleased", x, y);
	await sleep(250);
}

// expr evaluates (in the page) to a DOM node or an Enyo control.
async function rectOf(expr) {
	return ev(`(function(){var n=(${expr}); if(n&&n.hasNode) n=n.hasNode(); if(!n) return null;
		var r=n.getBoundingClientRect(); if(!r.width||!r.height) return null;
		return {x:r.left+r.width/2, y:r.top+r.height/2, w:r.width, h:r.height, l:r.left, t:r.top};})()`);
}

// Taps the centre of an element once it is visible and not covered (by a
// closing dialog's scrim, for instance).
// One-view (phone) layout: get to the view holding the element first, the way
// a user would: back gestures to the lists or tasks, a tap for the rest.
async function reach(expr) {
	if (!(await ev("__t.mv().singleView"))) {
		return;
	}
	for (let i = 0; i < 3; i++) {
		const want = await ev(`(function(){var n=(${expr}); if(n&&n.hasNode) n=n.hasNode(); if(!n) return null;
			var vs=["listsView","tasksView","detailsView"];
			for (var i=0;i<vs.length;i++){ var v=__t.c(vs[i]).hasNode(); if (v && v.contains(n)) return vs[i]; }
			return "other";})()`);
		const cur = await ev("__t.view()");
		if (!want || want === "other" || want === cur) {
			return;
		}
		if (want === "listsView" || (want === "tasksView" && cur === "detailsView")) {
			await key("Escape");
			await waitFor(`__t.view() !== ${J(cur)} && __t.onScreen(__t.view())`, 2500);
		} else {
			return;
		}
	}
}

// Drags the enclosing scroller (finger-style) until the element is on screen.
async function scrollTo(expr) {
	for (let i = 0; i < 6; i++) {
		const st = await ev(`(function(){var n=(${expr}); if(n&&n.hasNode) n=n.hasNode(); if(!n) return null;
			var r=n.getBoundingClientRect(), sc=null;
			for (var e=n; e; e=e.parentElement) { var c=enyo.$[e.id]; if (c && c instanceof enyo.Scroller) { sc=e; break; } }
			if (!sc) return null;
			var b=sc.getBoundingClientRect();
			var top=Math.max(b.top,0), bottom=Math.min(b.bottom,innerHeight);
			var cx=r.left+r.width/2, cy=r.top+Math.min(r.height/2, 20), h=document.elementFromPoint(cx, cy);
			if (r.top >= top && cy <= bottom && h && (h === n || n.contains(h))) return null;
			return {x: b.left + b.width / 2, top: top + 20, bottom: bottom - 20, down: r.top > bottom};})()`);
		if (process.env.DEBUG) {
			console.log("  scrollTo", JSON.stringify(st), await ev(`(function(){var n=(${expr}); if(n&&n.hasNode) n=n.hasNode(); if(!n) return "no node"; var r=n.getBoundingClientRect(); var h=document.elementFromPoint(r.left+r.width/2, r.top+Math.min(r.height/2,20)); return [r.top|0, r.bottom|0, h&&(h.id||h.className)].join(" ");})()`));
		}
		if (!st) {
			return;
		}
		const from = st.down ? st.bottom : st.top, to = st.down ? st.top : st.bottom;
		await drag(st.x, from, st.x, to, 0, 10);
		await sleep(900);
	}
}

async function tap(expr, label) {
	await reach(expr);
	await scrollTo(expr);
	let r = null;
	const end = Date.now() + 2500;
	while (Date.now() < end) {
		if (await ev(`!!__t.c("pane").isAnimating()`)) {
			await sleep(100);
			continue;
		}
		await scrollTo(expr);
		r = await rectOf(expr);
		// Aim at the part a user would see: no lower than 20px into the element.
		const ty = r && Math.min(r.y, r.t + 20);
		if (r && await ev(`(function(){var n=(${expr}); if(n&&n.hasNode) n=n.hasNode();
			var h=document.elementFromPoint(${r.x},${ty}); return !!h && (n===h || n.contains(h));})()`)) {
			await tapAt(r.x, ty);
			return r;
		}
		await sleep(150);
	}
	const diag = await ev(`JSON.stringify({vp: innerWidth + "x" + innerHeight, view: __t.view(), single: __t.mv().singleView,
		views: ["listsView","tasksView","detailsView"].map(function(v){var r=__t.c(v).hasNode().getBoundingClientRect(); return v+":"+[r.left|0,r.top|0,r.width|0,r.height|0];}),
		hit: (function(){ var n=(${expr}); if(n&&n.hasNode) n=n.hasNode(); if(!n) return null; var r=n.getBoundingClientRect(); var h=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2); return [r.left|0,r.top|0,r.width|0,r.height|0, h && (h.id || h.className)]; })()})`).catch((e) => String(e));
	throw new Error((r ? "covered: " : "not visible: ") + (label || expr) + " " + diag);
}

async function tapText(text, within) {
	return tap(`__t.byText(${JSON.stringify(text)}, ${JSON.stringify(within || "")})`, "text " + text);
}

async function type(text) {
	await cdp.send("Input.insertText", {text});
	await sleep(100);
}

const KEYS = {
	Enter: {key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: "\r"},
	Escape: {key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27},
	Backspace: {key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8},
	SelectAll: {key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2, commands: ["selectAll"]}
};

async function key(name) {
	const k = KEYS[name];
	await cdp.send("Input.dispatchKeyEvent", Object.assign({type: k.text ? "keyDown" : "rawKeyDown"}, k));
	await cdp.send("Input.dispatchKeyEvent", Object.assign({type: "keyUp"}, k, {text: undefined}));
	await sleep(150);
}

async function clearField() {
	await key("SelectAll");
	await key("Backspace");
}

async function drag(x1, y1, x2, y2, holdMs, steps = 12) {
	await mouse("mouseMoved", x1, y1, {buttons: 0});
	await mouse("mousePressed", x1, y1);
	await sleep(holdMs);
	for (let i = 1; i <= steps; i++) {
		await mouse("mouseMoved", x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps);
		await sleep(30);
	}
	await mouse("mouseReleased", x2, y2);
	await sleep(400);
}

// ---- page helpers

const HELPERS = `window.__t = {
	mv: function () {
		for (var id in enyo.$) {
			var c = enyo.$[id];
			if (c && c.kindName === "Tasks.MainView" && !c.destroyed) return c;
		}
	},
	c: function (path) {
		return path.split(".").reduce(function (o, k) { return o && o.$[k]; }, __t.mv());
	},
	visible: function (n) {
		var r = n.getBoundingClientRect();
		if (!r.width || !r.height || r.right <= 0 || r.left >= innerWidth || r.bottom <= 0 || r.top >= innerHeight) return false;
		for (var e = n; e && e.nodeType === 1; e = e.parentElement) {
			var s = getComputedStyle(e);
			if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
		}
		return true;
	},
	// Last visible element whose own text is exactly text (popups are appended last).
	byText: function (text, within) {
		var root = within ? __t.c(within).hasNode() : document.body, best = null;
		var all = root.querySelectorAll("*");
		for (var i = 0; i < all.length; i++) {
			var n = all[i];
			if ((n.textContent || "").trim() === text && __t.visible(n)) {
				var kids = Array.prototype.some.call(n.children, function (k) { return (k.textContent || "").trim() === text && __t.visible(k); });
				if (!kids) best = n;
			}
		}
		return best;
	},
	rows: function () {
		return __t.c("tasksView.rows").getControls().filter(function (r) { return r.kindName === "Tasks.TaskRow"; });
	},
	row: function (subject) {
		return __t.rows().filter(function (r) { return Tasks.Task.displaySubject(r.task) === subject; })[0];
	},
	rowSubjects: function () {
		return __t.rows().filter(function (r) { return __t.visible(r.hasNode()); }).map(function (r) {
			return r.$.subject.showing ? r.$.subject.getValue() : r.$.label.hasNode().textContent;
		});
	},
	listRow: function (name) {
		return __t.c("listsView.rows").getControls().filter(function (r) { return r.list && Tasks.List.displayName(r.list) === name; })[0];
	},
	listNames: function () {
		return __t.c("listsView.rows").getControls().filter(function (r) { return r.list; }).map(function (r) { return Tasks.List.displayName(r.list); });
	},
	db: function (method, params) {
		return new Promise(function (res) { Tasks.Service.call(Tasks.DB_SERVICE + method, params, res); });
	},
	find: function (query) {
		return __t.db("find", {query: query}).then(function (r) { return r.results || r; });
	},
	lists: function () { return __t.find({from: "com.palm.tasklist:1"}); },
	listByName: function (name) {
		return __t.lists().then(function (ls) { return ls.filter(function (l) { return l.name === name; })[0] || null; });
	},
	tasksOf: function (listId) {
		return __t.find({from: "com.palm.task:1", where: [{prop: "taskListId", op: "=", val: listId}]}).then(function (ts) {
			return ts.sort(function (a, b) { return a.position - b.position; });
		});
	},
	focusedIn: function (path) {
		var n = __t.c(path).hasNode();
		return !!n && n.contains(document.activeElement);
	},
	// The view really covering the middle of the window, not just the pane's idea of it.
	onScreen: function (v) {
		var h = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
		return !!h && __t.c(v).hasNode().contains(h);
	},
	view: function () {
		var v = __t.c("pane").getView();
		return v && v.name;
	}
};
true`;

async function install() {
	await waitFor("!!(window.enyo && window.Tasks && window.enyo.$)", 15000);
	await ev(HELPERS);
	await waitFor("!!(__t.mv() && __t.mv().data && __t.mv().data.allTasks)", 15000);
	await ev(`(function(){ var mv=__t.mv(), t0=Date.now(); window.__rl=[];
		var o1=mv.tasksChangedInDb, o2=mv.$.tasksView.reload;
		mv.tasksChangedInDb=function(){ __rl.push("db+"+(Date.now()-t0)); return o1.apply(this, arguments); };
		window.__wl=[]; var oc=Tasks.Service.call; var wn=0;
		Tasks.Service.call=function(uri, params, cb, sub){ if (params && params.watch) { var n=++wn, q=params.query, tag="w"+n+"("+(q.where?q.where[0].val:q.from)+")"; __wl.push("+"+(Date.now()-t0)+" ARM "+tag); var c=cb; cb=function(r){ __wl.push("+"+(Date.now()-t0)+" "+tag+" "+(r.fired?"FIRED":r.returnValue===false?"ERR "+JSON.stringify(r):"initial")); return c.apply(this, arguments); };
			var h=oc.call(this, uri, params, cb, sub); var cn=h.cancel; h.cancel=function(){ __wl.push("+"+(Date.now()-t0)+" cancel "+tag); return cn.apply(this, arguments); }; return h; }
			return oc.apply(this, arguments); };
		mv.$.tasksView.reload=function(){ var e=this.editingRow(); __rl.push("reload+"+(Date.now()-t0)+(e?" EDITING "+e.task.subject:"")); return o2.apply(this, arguments); };
		return 1; })()`);
	await sleep(500);
}

const J = JSON.stringify;
const listP = (name) => `__t.listByName(${J(name)})`;
const tasksP = (name) => `${listP(name)}.then(function(l){ return l ? __t.tasksOf(l._id) : []; })`;

// ---- scenarios

async function newList(name) {
	await tap(`document.querySelector(".tasks-new-list-button")`, "new list button");
	const focused = await waitFor(`__t.focusedIn("tasksView.name")`, 2000);
	await type(name);
	return focused;
}

async function addTasks(subjects) {
	// The name field's Enter (or the + button) starts the first row.
	for (let i = 0; i < subjects.length; i++) {
		await waitFor(`__t.rows().some(function(r){ return !r.task._id && r.hasFocus(); })`, 3000);
		await type(subjects[i]);
		await key("Enter");
		await waitFor(`__t.rows().filter(function(r){ return r.task._id; }).length >= ${i + 1}`, 3000);
	}
}

async function blurAll() {
	// Tap the empty paper below the rows (the list end), then away to the header title area.
	await ev(`document.activeElement && document.activeElement.blur && document.activeElement.blur(), true`);
	await sleep(400);
}

async function openTask(subject) {
	await tap(`(function(){var r=__t.row(${J(subject)}); return r.$.due.showing ? r.$.due : r.$.info;})()`, "open " + subject);
	return waitFor(`__t.c("detailsView").getTask() && __t.c("detailsView").getTask().subject === ${J(subject)}`, 3000);
}

async function selectList(name) {
	for (let i = 0; i < 3; i++) {
		if (name === "List all tasks") {
			await tap(`__t.c("listsView.allTasks")`, "All tasks");
		} else {
			await tap(`__t.listRow(${J(name)})`, "list " + name);
		}
		if (await waitFor(`Tasks.List.displayName(__t.c("tasksView").getList()) === ${J(name)}`, 1500)) {
			if (i) {
				console.log("  (list tap needed " + (i + 1) + " tries)");
			}
			return true;
		}
	}
	throw new Error("could not switch to list " + name);
}

async function chooseInSelector(selectorPath, caption) {
	await tap(`__t.c(${J(selectorPath)})`, selectorPath);
	await sleep(400);
	await tapText(caption);
	await sleep(500);
}

async function menuCommand(caption) {
	await tap(`__t.c("tasksView.menuButton")`, "list menu");
	await sleep(400);
	await tapText(caption);
	await sleep(500);
}

async function confirmDialog(caption) {
	await tapText(caption);
	await waitFor(`!document.querySelector(".enyo-scrim") || !__t.visible(document.querySelector(".enyo-scrim"))`, 2000);
	await sleep(300);
}

async function swipeRow(expr) {
	await reach(expr);
	await waitFor(`!__t.c("pane").isAnimating()`, 2000);
	await sleep(200);
	const r = await rectOf(expr);
	await drag(r.l + r.w * 0.2, r.y, r.l + r.w * 0.9, r.y, 0, 10);
	await sleep(400);
}

async function scenarios() {
	const today = await ev("Tasks.Dates.today()");
	const P = DEVICE ? "ZT " : "";
	const L1 = P + "Groceries", L1b = P + "Shopping", L2 = P + "Work", L3 = P + "Scratch";

	// 1. start up
	check("start: lists view shows List all tasks", await ev(`!!__t.byText("List all tasks")`));
	if (!DEVICE) {
		check("start: empty list hint shown", await ev(`__t.c("listsView.empty").showing`));
		const kinds = await ev(`Promise.all([__t.find({from:"com.palm.tasklist.unfiled:1"}),__t.find({from:"com.palm.tasklist.alltasks:1"})]).then(function(r){return [r[0].length,r[1].length];})`);
		check("start: Unfiled and All tasks lists created once", kinds[0] === 1 && kinds[1] === 1, kinds);
	}
	check(DEVICE ? "start: no back buttons on a device" : "start: no back button visible on the lists",
		await ev(`!Array.prototype.some.call(document.querySelectorAll(".tasks-back-button"), function(n){ return __t.visible(n); })`));
	if (DEVICE) {
		check("device: back buttons never shown", await ev(`!__t.c("tasksView.backButton").showing && !__t.c("detailsView.backButton").showing`));
	}
	await shot("start");

	// 2. new list, name field
	const focused = await newList(L1);
	check("new list: name field gets focus", focused);
	check("new list: focused name field shows the edit frame",
		await ev(`__t.c("tasksView.name").hasClass("enyo-input-focus")`));
	await shot("new-list-name-focused");
	await key("Enter");
	const l1 = await waitFor(listP(L1), 3000);
	check("new list: Enter saves the list", l1 && l1.visible === true && l1.order === "position", l1);
	check("new list: list appears in lists view", await waitFor(`__t.listNames().indexOf(${J(L1)}) >= 0`, 3000));
	check("new list: Enter starts a new task row", await waitFor(`__t.rows().some(function(r){return !r.task._id && r.hasFocus();})`, 2000));

	// 3. inline task entry
	await addTasks(["Milk", "Eggs", "Bread"]);
	await blurAll();
	let ts = await waitFor(`${tasksP(L1)}.then(function(t){return t.length>=3 && t;})`, 3000);
	check("add: three tasks saved in list order", ts && ts.map((t) => t.subject).join() === "Milk,Eggs,Bread", ts && ts.map((t) => t.subject));
	check("add: positions increase", ts && ts[0].position < ts[1].position && ts[1].position < ts[2].position, ts && ts.map((t) => t.position));
	check("add: defaults (normal priority, no due, not completed)", ts && ts.every((t) => t.priority === 2 && t.dueDate === null && t.completed === false));
	check("add: empty trailing row discarded on blur", await waitFor(`__t.rows().every(function(r){return !!r.task._id;})`, 2000),
		await ev(`__t.rows().map(function(r){return [r.task._id||null, r.getSubject()];})`));
	check("add: rows shown in order", (await ev(`__t.rowSubjects()`)).join() === "Milk,Eggs,Bread", await ev(`__t.rowSubjects()`));
	await shot("three-tasks");

	// 4. + button with nothing typed adds nothing
	await tap(`document.querySelector(".tasks-new-task-button")`, "+ button");
	await waitFor(`__t.rows().some(function(r){return !r.task._id && r.hasFocus();})`, 2000);
	await blurAll();
	await sleep(500);
	check("add: + then leaving it empty creates no task", (await ev(tasksP(L1))).length === 3);

	// 5. rename the list
	await tap(`__t.c("tasksView.name")`, "name");
	check("rename: tapping the name shows the edit frame", await waitFor(`__t.c("tasksView.name").hasClass("enyo-input-focus")`, 1500));
	await clearField();
	await type(L1b);
	await blurAll();
	check("rename: new name saved", await waitFor(`${listP(L1b)}.then(function(l){return !!l;})`, 3000));
	check("rename: lists view updated", await waitFor(`__t.listNames().indexOf(${J(L1b)}) >= 0 && __t.listNames().indexOf(${J(L1)}) < 0`, 3000), await ev(`__t.listNames()`));
	check("rename: frame gone after leaving the field", !(await ev(`__t.c("tasksView.name").hasClass("enyo-input-focus")`)));

	// 6. clearing the name keeps the old one
	await tap(`__t.c("tasksView.name")`, "name");
	await clearField();
	await blurAll();
	await sleep(600);
	check("rename: empty name not saved", !!(await ev(listP(L1b))));
	const shownName = await ev(`__t.c("tasksView.name").getValue()`);
	check("rename: empty name restored in the field", shownName === L1b, shownName);

	// 7. complete via checkbox
	await tap(`__t.row("Milk").$.check`, "check Milk");
	let milk = await waitFor(`${tasksP(L1b)}.then(function(t){var m=t.filter(function(x){return x.subject==="Milk";})[0]; return m&&m.completed&&m;})`, 3000);
	check("complete: checkbox saves completed + completedDate", milk && milk.completed === true && milk.completedDate > 0, milk);
	check("complete: row styled completed", await ev(`__t.row("Milk").hasClass("tasks-completed")`));
	await tap(`__t.row("Milk").$.check`, "uncheck Milk");
	milk = await waitFor(`${tasksP(L1b)}.then(function(t){var m=t.filter(function(x){return x.subject==="Milk";})[0]; return m&&!m.completed&&m;})`, 3000);
	check("complete: unchecking clears completed + completedDate", milk && milk.completedDate === null, milk);
	await tap(`__t.row("Milk").$.check`, "check Milk again");
	await sleep(500);

	// 8. inline subject edit
	await tap(`__t.row("Bread").$.subject`, "Bread subject");
	await clearField();
	await type("Rye bread");
	await blurAll();
	check("edit: inline subject edit saved", await waitFor(`${tasksP(L1b)}.then(function(t){return t.some(function(x){return x.subject==="Rye bread";});})`, 3000));

	// 9. details: priority, due, notes, subject
	check("details: opens from the row arrow", await openTask("Eggs"));
	await shot("details");
	await chooseInSelector("detailsView.priority", "High");
	let eggs = await waitFor(`${tasksP(L1b)}.then(function(t){var e=t.filter(function(x){return x.subject==="Eggs";})[0]; return e&&e.priority===1&&e;})`, 3000);
	check("details: priority High saved", !!eggs, eggs);
	check("details: row checkbox turns high-priority", await waitFor(`__t.row("Eggs").$.check.hasClass("tasks-check-high")`, 2000),
		await ev(`JSON.stringify({rl: __rl.slice(-8), active: document.activeElement.id || document.activeElement.tagName, needsReload: __t.c("tasksView").needsReload, watch: !!__t.mv().taskWatch, list: Tasks.List.displayName(__t.mv().currentList)})`));

	await tap(`__t.c("detailsView.dueRow")`, "due row");
	await sleep(400);
	await tapText("Today");
	eggs = await waitFor(`${tasksP(L1b)}.then(function(t){var e=t.filter(function(x){return x.subject==="Eggs";})[0]; return e&&e.dueDate===${today}&&e;})`, 3000);
	check("details: due Today saved", !!eggs, eggs);
	check("details: row shows Today", await waitFor(`__t.row("Eggs").$.due.showing && __t.row("Eggs").$.due.hasNode().textContent === "Today"`, 2000));
	check("due count: badge on the list", await waitFor(`(__t.listRow(${J(L1b)}).list.dueItemCount||0) === 1`, 4000),
		await ev(`__t.listRow(${J(L1b)}) && __t.listRow(${J(L1b)}).list.dueItemCount`));
	check("due count: total on List all tasks", await waitFor(`(__t.mv().data.allTasks.dueItemCount||0) >= 1`, 3000));

	await tap(`__t.c("detailsView.dueRow")`, "due row");
	await sleep(400);
	await tapText("Tomorrow");
	eggs = await waitFor(`${tasksP(L1b)}.then(function(t){var e=t.filter(function(x){return x.subject==="Eggs";})[0]; return e&&e.dueDate===${today + 86400000}&&e;})`, 3000);
	check("details: due Tomorrow saved", !!eggs, eggs);
	check("due count: badge cleared when not due", await waitFor(`!(__t.listRow(${J(L1b)}).list.dueItemCount)`, 4000));

	await tap(`__t.c("detailsView.dueRow")`, "due row");
	await sleep(400);
	await tapText("No due date");
	check("details: No due date clears it", await waitFor(`${tasksP(L1b)}.then(function(t){return t.filter(function(x){return x.subject==="Eggs";})[0].dueDate===null;})`, 3000));

	await tap(`__t.c("detailsView.notes")`, "notes");
	await type("Free range, 12 pack");
	await tap(`__t.c("detailsView.subject")`, "details subject");
	await clearField();
	await type("Eggs (large)");
	await tap(`__t.c("detailsView.title")`, "details title");
	await blurAll();
	eggs = await waitFor(`${tasksP(L1b)}.then(function(t){var e=t.filter(function(x){return x.subject==="Eggs (large)";})[0]; return e&&e;})`, 3000);
	check("details: subject and notes saved", eggs && eggs.notes === "Free range, 12 pack", eggs);
	check("details: row shows new subject", await waitFor(`!!__t.row("Eggs (large)")`, 3000), await ev(`__t.rowSubjects()`));

	// 10. back gesture closes the details (tablet layout)
	await key("Escape");
	check("back: closes the details", await waitFor(`!__t.c("detailsView").getTask()`, 2000));

	// 11. second list and moving a task to it
	await newList(L2);
	await key("Enter");
	await addTasks(["Report"]);
	await blurAll();
	check("list 2: created with a task", await waitFor(`${tasksP(L2)}.then(function(t){return t.length===1;})`, 3000));
	await selectList(L1b);
	await openTask("Rye bread");
	await chooseInSelector("detailsView.list", L2);
	const l2 = await ev(listP(L2));
	check("move: task moved to the other list in the DB", await waitFor(`${tasksP(L2)}.then(function(t){return t.some(function(x){return x.subject==="Rye bread";});})`, 3000));
	check("move: task gone from the current list's rows", await waitFor(`!__t.row("Rye bread")`, 3000), await ev(`__t.rowSubjects()`));
	await key("Escape");
	await sleep(400);

	// 12. sort orders
	await selectList(L2);
	await addTasksViaPlus(["Alpha", "Bravo"]);
	await setPriorityOf("Bravo", "Low");
	await setDueOf("Alpha", "Tomorrow");
	await key("Escape");
	await sleep(300);
	await chooseInSelector("tasksView.order", "Priority");
	check("sort: priority saved on the list", await waitFor(`${listP(L2)}.then(function(l){return l.order==="priority";})`, 3000));
	let order = await ev(`__t.rowSubjects()`);
	check("sort: priority order (normal before low)", order[order.length - 1] === "Bravo", order);
	check("sort: priority dividers shown", await ev(`__t.c("tasksView.rows").getControls().some(function(c){return c.kindName==="enyo.Divider";})`));
	await shot("sorted-priority");
	await chooseInSelector("tasksView.order", "Due Date");
	order = await waitFor(`__t.rowSubjects()[0]==="Alpha" && __t.rowSubjects()`, 2000);
	check("sort: due date order puts the dated task first", !!order, await ev(`__t.rowSubjects()`));
	check("sort: reorder disabled outside My Order", !(await ev(`__t.c("tasksView.rows").reorderable`)));
	await chooseInSelector("tasksView.order", "My Order");
	order = await ev(`__t.rowSubjects()`);
	check("sort: My Order restores entry order", order.join() === "Report,Rye bread,Alpha,Bravo", order);

	// 13. search
	await tap(`__t.c("tasksView.filter")`, "search");
	await type("br");
	await sleep(600);
	order = await ev(`__t.rowSubjects()`);
	check("search: filters rows", order.join() === "Rye bread,Bravo", order);
	check("search: match highlighted", await ev(`!!document.querySelector(".tasks-tasks-view .tasks-highlight")`));
	await shot("search");
	await clearField();
	await blurAll();
	await sleep(500);
	check("search: clearing shows all rows", (await ev(`__t.rowSubjects()`)).length === 4, await ev(`__t.rowSubjects()`));

	// 14. hide/show completed, mark all
	await tap(`__t.row("Alpha").$.check`, "check Alpha");
	await sleep(600);
	await menuCommand("Hide Completed");
	check("hide completed: saved on the list", await waitFor(`${listP(L2)}.then(function(l){return l.show==="remaining";})`, 3000));
	check("hide completed: completed task hidden", await waitFor(`__t.rowSubjects().indexOf("Alpha")<0`, 2000), await ev(`__t.rowSubjects()`));
	await menuCommand("Show Completed");
	check("show completed: task back", await waitFor(`__t.rowSubjects().indexOf("Alpha")>=0`, 2000));
	await menuCommand("Mark all completed");
	check("mark all completed (this list only)", await waitFor(`Promise.all([${tasksP(L2)},${tasksP(L1b)}]).then(function(r){return r[0].every(function(t){return t.completed;}) && r[1].some(function(t){return !t.completed;});})`, 3000));
	await menuCommand("Mark all incomplete");
	check("mark all incomplete", await waitFor(`${tasksP(L2)}.then(function(t){return t.every(function(x){return !x.completed && x.completedDate===null;});})`, 3000));

	// 15. set due for all
	await menuCommand("Set due date for all...");
	await sleep(400);
	await tapText("Set due date");
	check("due for all: every task in the list due today", await waitFor(`${tasksP(L2)}.then(function(t){return t.every(function(x){return x.dueDate===${today};});})`, 3000),
		await ev(`${tasksP(L2)}.then(function(t){return t.map(function(x){return x.dueDate;});})`));
	check("due for all: badge shows 4", await waitFor(`__t.listRow(${J(L2)}).list.dueItemCount===4`, 4000), await ev(`__t.listRow(${J(L2)}).list.dueItemCount`));
	await menuCommand("Set due date for all...");
	await sleep(400);
	await tapText("No due date");
	check("due for all: No due date clears all", await waitFor(`${tasksP(L2)}.then(function(t){return t.every(function(x){return x.dueDate===null;});})`, 3000));

	// 16. purge completed
	await tap(`__t.row("Alpha").$.check`, "check Alpha");
	await tap(`__t.row("Bravo").$.check`, "check Bravo");
	await sleep(600);
	await menuCommand("Delete completed tasks");
	await confirmDialog("Delete Completed");
	check("purge: completed tasks deleted", await waitFor(`${tasksP(L2)}.then(function(t){return t.map(function(x){return x.subject;}).sort().join()==="Report,Rye bread";})`, 3000),
		await ev(`${tasksP(L2)}.then(function(t){return t.map(function(x){return x.subject;});})`));

	// 17. delete from details (cancel first, then confirm)
	await openTask("Report");
	await tap(`__t.c("detailsView.deleteButton")`, "Delete Task");
	await confirmDialog("Cancel");
	check("delete task: Cancel keeps it", (await ev(tasksP(L2))).some((t) => t.subject === "Report"));
	await tap(`__t.c("detailsView.deleteButton")`, "Delete Task");
	await confirmDialog("Delete");
	check("delete task: Delete removes it", await waitFor(`${tasksP(L2)}.then(function(t){return !t.some(function(x){return x.subject==="Report";});})`, 3000));
	check("delete task: details closed", await waitFor(`!__t.c("detailsView").getTask()`, 2000));

	// 18. swipe to delete a row
	await selectList(L1b);
	await swipeRow(`__t.row("Milk")`);
	await shot("swipe");
	const swiped = await waitFor(`__t.row("Milk") && __t.row("Milk").confirmShowing`, 1500);
	check("swipe: shows the delete prompt", !!swiped);
	if (swiped) {
		await tapText("Delete", "tasksView");
		check("swipe: Delete removes the task", await waitFor(`${tasksP(L1b)}.then(function(t){return !t.some(function(x){return x.subject==="Milk";});})`, 3000));
	}

	// 19. reorder by hold and drag
	await selectList(L1b);
	await addTasksViaPlus(["One", "Two"]);
	let before = await ev(`__t.rowSubjects()`);
	const rOne = await rectOf(`__t.row(${J(before[before.length - 1])})`), rTop = await rectOf(`__t.row(${J(before[0])})`);
	await drag(rOne.x, rOne.y, rOne.x, rTop.t + 4, 700, 15);
	await sleep(800);
	let after = await ev(`__t.rowSubjects()`);
	check("reorder: drag moves the last task to the top", after[0] === before[before.length - 1], {before, after});
	const dbOrder = await ev(`${tasksP(L1b)}.then(function(t){return t.map(function(x){return x.subject;});})`);
	check("reorder: new order stored", dbOrder.join() === after.join(), {dbOrder, after});

	// 20. escaping
	await newList(P + "<b>x</b> & y");
	await key("Enter");
	await blurAll();
	await sleep(800);
	check("escaping: HTML in a list name is shown as text", await waitFor(`!!__t.listRow(${J(P + "<b>x</b> & y")}) && __t.listRow(${J(P + "<b>x</b> & y")}).hasNode().textContent.indexOf("<b>x</b> & y")>=0`, 3000));

	// 21. list search, list reorder, list delete
	await tap(`__t.c("listsView.filter")`, "list search");
	await type(DEVICE ? "ZT W" : "wor");
	await sleep(500);
	check("list search: filters lists", (await ev(`__t.c("listsView").visibleLists().map(function(l){return Tasks.List.displayName(l);})`)).join() === L2,
		await ev(`__t.c("listsView").visibleLists().map(function(l){return Tasks.List.displayName(l);})`));
	await clearField();
	await blurAll();
	await sleep(400);

	const names0 = await ev(`__t.listNames()`);
	const a = names0.indexOf(L2), b = names0.indexOf(L1b);
	const ra = await rectOf(`__t.listRow(${J(L2)})`), rb = await rectOf(`__t.listRow(${J(L1b)})`);
	await drag(ra.x, ra.y, rb.x, rb.y + (a < b ? rb.h / 3 : -rb.h / 3), 700, 15);
	await sleep(1200);
	const names1 = await ev(`__t.listNames()`);
	check("list reorder: drag swaps two lists", names1.indexOf(L2) !== a, {names0, names1});
	await ev(`__t.mv().loadLists()`);
	await sleep(800);
	const names2 = await ev(`__t.listNames()`);
	check("list reorder: order kept after reload", names2.join() === names1.join(), {names1, names2});

	await swipeRow(`__t.listRow(${J(P + "<b>x</b> & y")})`);
	await tapText("Delete", "listsView");
	check("list delete: swipe + Delete removes the list", await waitFor(`${listP(P + "<b>x</b> & y")}.then(function(l){return !l;})`, 3000));

	await selectList(L2);
	await menuCommand("Delete list");
	await confirmDialog("Delete");
	check("list delete: menu deletes the list", await waitFor(`${listP(L2)}.then(function(l){return !l;})`, 3000));
	check("list delete: its tasks are deleted too", (await ev(`__t.find({from:"com.palm.task:1",where:[{prop:"taskListId",op:"=",val:${J(l2._id)}}]})`)).length === 0);
	check("list delete: view falls back to List all tasks", await waitFor(`Tasks.List.isAllTasks(__t.c("tasksView").getList())`, 2000));

	// 22. All tasks + Unfiled
	await selectList("List all tasks");
	const allRows = await ev(`__t.rowSubjects()`);
	check("all tasks: shows tasks of every list", allRows.indexOf("One") >= 0, allRows);
	await tap(`document.querySelector(".tasks-new-task-button")`, "+ in All tasks");
	await waitFor(`__t.rows().some(function(r){return !r.task._id && r.hasFocus();})`, 2000);
	await type(P + "Loose end");
	await key("Enter");
	await blurAll();
	check("all tasks: new task is Unfiled", await waitFor(`__t.find({from:"com.palm.task:1",where:[{prop:"taskListId",op:"=",val:null}]}).then(function(t){return t.some(function(x){return x.subject===${J(P + "Loose end")};});})`, 3000));
	check("unfiled: Unfiled list appears", await waitFor(`__t.listNames().indexOf("Unfiled")>=0`, 4000), await ev(`__t.listNames()`));
	await selectList("Unfiled");
	check("unfiled: name is read-only", await ev(`__t.c("tasksView.name").getDisabled()`));
	check("unfiled: no Delete list in the menu", await (async () => {
		await tap(`__t.c("tasksView.menuButton")`);
		await sleep(400);
		const v = await ev(`!__t.c("tasksView.menuDeleteList").showing`);
		await key("Escape");
		check("back: closes an open menu", await waitFor(`!__t.c("tasksView.listMenu").isOpen`, 1500));
		check("back: closing the menu does not navigate", Tasks_is_unfiled(await ev(`__t.c("tasksView").getList()._kind`)));
		return v;
	})());
	await openTask(P + "Loose end");
	await tap(`__t.c("detailsView.deleteButton")`);
	await confirmDialog("Delete");
	check("unfiled: hidden again once empty", await waitFor(`__t.listNames().indexOf("Unfiled")<0`, 4000) || (await ev(`__t.find({from:"com.palm.task:1",where:[{prop:"taskListId",op:"=",val:null}]})`)).length > 0);

	// 23. persistence (browser: reload the page)
	if (!DEVICE) {
		await cdp.send("Page.reload", {});
		await sleep(1500);
		await install();
		check("reload: lists persist", await waitFor(`__t.listNames().indexOf(${J(L1b)})>=0`, 4000), await ev(`__t.listNames()`));
	}

	// 24. phone layout and the back gesture
	if (!DEVICE && !PHONE) {
		await cdp.send("Emulation.setDeviceMetricsOverride", {width: 360, height: 640, deviceScaleFactor: 1, mobile: false});
		await sleep(1200);
		check("phone: starts on the list of lists", await waitFor(`__t.view()==="listsView" && __t.onScreen("listsView")`, 2000), await ev(`__t.view()`));
		await shot("phone-lists");
		await selectList(L1b);
		check("phone: tapping a list shows its tasks", await waitFor(`__t.view()==="tasksView" && __t.onScreen("tasksView")`, 2000), await ev(`__t.view()`));
		check("phone: tasks view is full width", await ev(`__t.c("tasksView").hasNode().getBoundingClientRect().width >= 350`), await ev(`__t.c("tasksView").hasNode().getBoundingClientRect().width`));
		await shot("phone-tasks");
		await openTask("One");
		check("phone: details view shown", await waitFor(`__t.view()==="detailsView" && __t.onScreen("detailsView")`, 2000));
		await tap(`__t.c("detailsView.notes")`);
		await type("typed on phone");
		await shot("phone-details");
		check("phone (desktop): back button shown on the details", await ev(`__t.visible(__t.c("detailsView.backButton").hasNode())`));
		await tap(`__t.c("detailsView.backButton")`, "details back button");
		check("phone: back from details goes to tasks", await waitFor(`__t.view()==="tasksView" && __t.onScreen("tasksView")`, 2000), await ev(`__t.view()`));
		check("phone: notes typed before back were saved", await waitFor(`${tasksP(L1b)}.then(function(t){return t.some(function(x){return x.notes==="typed on phone";});})`, 3000));
		check("phone (desktop): back button shown on the tasks", await ev(`__t.visible(__t.c("tasksView.backButton").hasNode())`));
		await key("Escape");
		check("phone: back from tasks goes to lists", await waitFor(`__t.view()==="listsView" && __t.onScreen("listsView")`, 2000), await ev(`__t.view()`));
		await cdp.send("Emulation.clearDeviceMetricsOverride", {});
		await sleep(800);
	}

	// 25. one-view layout: two quick back gestures from the details
	if (await ev("__t.mv().singleView") || !DEVICE) {
		const wide = !(await ev("__t.mv().singleView"));
		if (wide) {
			await cdp.send("Emulation.setDeviceMetricsOverride", {width: 450, height: 380, deviceScaleFactor: 1, mobile: false});
			await sleep(1200);
		}
		await selectList(L1b);
		await waitFor(`__t.onScreen("tasksView")`, 2000);
		await openTask("One");
		await waitFor(`__t.onScreen("detailsView")`, 2000);
		await key("Escape");
		await sleep(150);
		await key("Escape");
		check("quick double back: ends on the lists, really on screen", await waitFor(`__t.view()==="listsView" && __t.onScreen("listsView")`, 3500),
			await ev(`[__t.view(), ["listsView","tasksView","detailsView"].filter(function(v){return __t.onScreen(v);})]`));
		await shot("double-back");
		if (wide) {
			await cdp.send("Emulation.clearDeviceMetricsOverride", {});
			await sleep(800);
		}
	}

	// cleanup on the device: remove what the run created
	if (DEVICE) {
		await ev(`__t.lists().then(function(ls){ return Promise.all(ls.filter(function(l){return /^ZT /.test(l.name||"");}).map(function(l){
			return new Promise(function(res){ __t.mv().db.deleteTaskList(l, res); }); })); }).then(function(){ return __t.mv().loadLists(), true; })`);
		await sleep(1000);
		check("cleanup: no ZT lists left", (await ev(`__t.lists().then(function(ls){return ls.filter(function(l){return /^ZT /.test(l.name||"");}).length;})`)) === 0);
	}
}

function Tasks_is_unfiled(kind) {
	return kind === "com.palm.tasklist.unfiled:1";
}

async function prioScenario() {
	await newList("ZT Probe");
	await key("Enter");
	await addTasks(["P1", "P2"]);
	await blurAll();
	await sleep(1000);
	await openTask("P2");
	const state = () => ev(`JSON.stringify({rows: __t.rows().map(function(r){return [r.task.subject, r.task.priority, r.$.check.hasClass("tasks-check-high"), r.id];}),
		details: __t.c("detailsView").getTask() && [__t.c("detailsView").getTask().subject, __t.c("detailsView").getTask().priority],
		rl: __rl.slice(-4), view: __t.view()})`);
	console.log("before", await state());
	await chooseInSelector("detailsView.priority", "High");
	for (let i = 0; i < 6; i++) {
		await sleep(1000);
		console.log("+" + (i + 1) + "s", await state(), await ev(`${tasksP("ZT Probe")}.then(function(t){return JSON.stringify(t.map(function(x){return [x.subject,x.priority];}));})`));
	}
	console.log("watch log:\n  " + (await ev(`__wl.join("\\n  ")`)));
}

async function addTasksViaPlus(subjects) {
	await tap(`document.querySelector(".tasks-new-task-button")`, "+ button");
	await addTasks(subjects);
	await blurAll();
	await sleep(500);
}

async function setPriorityOf(subject, caption) {
	await openTask(subject);
	await chooseInSelector("detailsView.priority", caption);
	await sleep(400);
}

async function setDueOf(subject, caption) {
	await openTask(subject);
	await tap(`__t.c("detailsView.dueRow")`);
	await sleep(400);
	await tapText(caption);
	await sleep(500);
}

// The Tasks page behind a DevTools endpoint. Closing the app can leave pages of
// an old instance behind, so with several the one holding the focus wins.
async function resolveTarget(target) {
	if (/^wss?:/.test(target)) {
		return target;
	}
	const list = await (await fetch(target.replace(/\/+$/, "") + "/json/list")).json();
	const pages = list.filter((p) => p.type === "page" &&
		/\/com\.palm\.app\.tasks\/(main|index-desktop)\.html/.test(p.url));
	if (pages.length > 1) {
		for (const p of pages) {
			const c = await connect(p.webSocketDebuggerUrl);
			const r = await c.send("Runtime.evaluate", {expression: "document.hasFocus()", returnByValue: true});
			c.close();
			if (r.result.value) {
				return p.webSocketDebuggerUrl;
			}
		}
	}
	if (!pages.length) {
		throw new Error("no Tasks page at " + target + " (is the app open?)");
	}
	return pages[0].webSocketDebuggerUrl;
}

(async () => {
	cdp = await connect(await resolveTarget(TARGET));
	cdp.on((m) => {
		if (m.method === "Runtime.exceptionThrown") {
			consoleErrors.push("exception: " + (m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text));
		} else if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) {
			consoleErrors.push(m.params.type + ": " + m.params.args.map((a) => a.value !== undefined ? a.value : a.description).join(" "));
		}
	});
	await cdp.send("Runtime.enable");
	await cdp.send("Page.enable");
	await cdp.send("Network.enable");
	await cdp.send("Network.setCacheDisabled", {cacheDisabled: true});
	if (PHONE) {
		await cdp.send("Emulation.setDeviceMetricsOverride", {width: 450, height: 380, deviceScaleFactor: 1, mobile: false});
	} else if (!DEVICE) {
		await cdp.send("Emulation.clearDeviceMetricsOverride", {});
	}
	if (!DEVICE) {
		await ev("localStorage.clear(), true");
		await cdp.send("Page.reload", {ignoreCache: true});
		await sleep(1500);
	}
	await install();
	if (process.env.FAPFIX) {
		console.log("page-only workaround for the stuck enyo.gesture._isFocusing: " + await ev(fs.readFileSync(__dirname + "/fapfix.js", "utf8")));
	}
	if (DEVICE) {
		// leftovers of an earlier, aborted run
		await ev(`__t.lists().then(function(ls){ return Promise.all(ls.filter(function(l){return /^ZT /.test(l.name||"");}).map(function(l){
			return new Promise(function(res){ __t.mv().db.deleteTaskList(l, res); }); })); }).then(function(){ __t.mv().selectList(null, __t.mv().data.allTasks, true); return true; })`);
		await ev(`__t.find({from:"com.palm.task:1",where:[{prop:"taskListId",op:"=",val:null}]}).then(function(t){ var ids=t.filter(function(x){return /^ZT /.test(x.subject||"");}).map(function(x){return x._id;}); return ids.length ? __t.db("del",{ids:ids}) : 0; }).then(function(){ return true; })`);
		await sleep(1500);
	}
	try {
		await (process.env.ONLY === "prio" ? prioScenario() : process.env.ONLY === "unfiled" ? tap(`__t.listRow("Unfiled")`, "Unfiled") : scenarios());
	} catch (e) {
		check("run aborted", false, String(e && e.stack || e));
		await shot("aborted").catch(() => {});
	}
	const failed = results.filter((r) => !r.ok);
	console.log(`\n${results.length - failed.length}/${results.length} passed`);
	console.log("console errors/warnings:\n  " + (consoleErrors.join("\n  ") || "(none)"));
	fs.writeFileSync(`${SHOTS}/results.json`, JSON.stringify({results, consoleErrors}, null, 1));
	cdp.close();
	process.exit(failed.length ? 1 : 0);
})();
