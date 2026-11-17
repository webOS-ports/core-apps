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

// Email on a phone: the mail card takes the legacy app's layout when the
// device has no tablet UI, and on a phone with a keyboard the search field
// stays away until the user types on the list. The sizes themselves are CSS
// (css/mail.css, .mail-phone); jsdom does no layout, so these tests check
// the classes and the search field's state, not pixels.
"use strict";

const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const {LUNEOS_ROOT} = require("../../../tests/harness/env");
const {usePage, imapAccount} = require("../fixtures");

const needsRoot = LUNEOS_ROOT ? {} : {skip: "set LUNEOS_ROOT to a LuneOS root filesystem"};

// The mail card's errors that are not about this: Mail.checkList's no-layout
// logging (jsdom does no layout).
const NO_LAYOUT = /^(Detected 0-size list component: .*|   mailList height: 0|Scheduling recovery\.|Clearing pending recovery attempt\.)$/;

const PHONE = {tabletUi: false, keyboardAvailable: false};
const PHONE_WITH_KEYBOARD = {tabletUi: false, keyboardAvailable: true};
const TABLET = {tabletUi: true, keyboardAvailable: false};

async function openMailCard(page) {
	page.env.luna.db.seed(imapAccount("acct1", "Work"));
	page.env.launch({});
	await page.env.settle();
	const app = page.env.enyo.application.mailApp;
	const win = page.env.windows.find((w) => w.name === "mail").window;
	// In jsdom the card is still on its first-launch view here; on a device
	// with an account it shows the folders and the list.
	app.selectViewByName("slidingPane", true);
	app.$.slidingPane.selectViewImmediate(app.$.mailSliding);
	// Enyo hears an input's focus and blur through its inline onfocus and
	// onblur attributes ("enyo.bubble(arguments[0])"), which the harness's
	// jsdom does not run (runScripts "outside-only"). Do what they do.
	const input = app.$.mail.$.searchBox.$.input.hasNode();
	for (const type of ["focus", "blur"]) {
		input.addEventListener(type, (e) => win.enyo.bubble(e));
	}
	return {app, mail: app.$.mail, display: app.$.body.$.messageLoader, win};
}

function otherErrors(page) {
	return page.env.errors.splice(0).filter((e) => !NO_LAYOUT.test(e));
}

function key(win, k, extra = {}) {
	const e = new win.KeyboardEvent("keydown", Object.assign({key: k, bubbles: true, cancelable: true}, extra));
	(win.document.activeElement || win.document.body).dispatchEvent(e);
}

const searchState = (mail) => ({
	showing: mail.$.searchBox.getShowing(),
	focused: mail.$.searchBox.hasFocus(),
	value: mail.$.searchBox.getValue(),
	collapsed: mail.$.searchHeader.hasClass("mail-search-collapsed")
});

describe("Email on a tablet", needsRoot, () => {
	const page = usePage({deviceInfo: TABLET});

	it("keeps the tablet layout and its search field", async () => {
		const {mail, display, win} = await openMailCard(page);

		assert.equal(mail.hasClass("mail-phone"), false);
		assert.equal(display.hasClass("mail-phone"), false);
		assert.deepEqual(searchState(mail), {showing: true, focused: false, value: "", collapsed: false});

		// Typing on the list does not take the focus there.
		key(win, "t");
		assert.equal(mail.$.searchBox.hasFocus(), false);
		assert.deepEqual(otherErrors(page), []);
	});
});

describe("Email without deviceInfo.tabletUi", needsRoot, () => {
	// The harness's deviceInfo has no tabletUi, as a desktop browser has no
	// deviceInfo at all: the tablet layout.
	const page = usePage();

	it("keeps the tablet layout", async () => {
		const {mail, display} = await openMailCard(page);

		assert.equal(mail.hasClass("mail-phone"), false);
		assert.equal(display.hasClass("mail-phone"), false);
		assert.equal(mail.$.searchBox.getShowing(), true);
		assert.deepEqual(otherErrors(page), []);
	});
});

describe("Email on a phone without a keyboard", needsRoot, () => {
	const page = usePage({deviceInfo: PHONE});

	it("takes the phone layout and keeps the search field on show", async () => {
		const {mail, display, win} = await openMailCard(page);

		assert.equal(mail.hasClass("mail-phone"), true);
		assert.equal(display.hasClass("mail-phone"), true);
		assert.deepEqual(searchState(mail), {showing: true, focused: false, value: "", collapsed: false});

		key(win, "t");
		assert.equal(mail.$.searchBox.hasFocus(), false);
		assert.equal(mail.closeSearch(), false);
		assert.equal(mail.$.searchBox.getShowing(), true);
		assert.deepEqual(otherErrors(page), []);
	});
});

describe("Email on a phone with a keyboard", needsRoot, () => {
	const page = usePage({deviceInfo: PHONE_WITH_KEYBOARD});

	it("takes the phone layout with the search field put away", async () => {
		const {mail, display} = await openMailCard(page);

		assert.equal(mail.hasClass("mail-phone"), true);
		assert.equal(display.hasClass("mail-phone"), true);
		assert.deepEqual(searchState(mail), {showing: false, focused: false, value: "", collapsed: true});
		assert.deepEqual(otherErrors(page), []);
	});

	it("brings up the search field, focused, when a letter is typed on the list", async () => {
		const {mail, win} = await openMailCard(page);

		key(win, "t");
		assert.deepEqual(searchState(mail), {showing: true, focused: true, value: "", collapsed: false});
		assert.equal(win.document.activeElement, mail.$.searchBox.$.input.hasNode());
		assert.deepEqual(otherErrors(page), []);
	});

	it("leaves it away for keys that are not text, or with a modifier", async () => {
		const {mail, win} = await openMailCard(page);

		for (const [k, extra] of [["Shift", {}], ["Enter", {}], ["ArrowDown", {}], [" ", {}],
			["c", {ctrlKey: true}], ["v", {metaKey: true}], ["x", {altKey: true}]]) {
			key(win, k, extra);
			assert.equal(mail.$.searchBox.getShowing(), false, JSON.stringify([k, extra]));
		}
		assert.deepEqual(otherErrors(page), []);
	});

	it("leaves it away while a popup is open", async () => {
		const {mail, win} = await openMailCard(page);

		mail.$.aboutFolderPopup.open();
		key(win, "t");
		assert.equal(mail.$.searchBox.getShowing(), false);

		mail.$.aboutFolderPopup.close();
		key(win, "t");
		assert.equal(mail.$.searchBox.getShowing(), true);
		assert.deepEqual(otherErrors(page), []);
	});

	it("leaves it away while a message fills the screen", async () => {
		const {app, mail, win} = await openMailCard(page);

		app.$.slidingPane.setMultiView(false);
		app.$.slidingPane.selectViewImmediate(app.$.bodySliding);
		key(win, "t");
		assert.equal(mail.$.searchBox.getShowing(), false);

		app.$.slidingPane.selectViewImmediate(app.$.mailSliding);
		key(win, "t");
		assert.equal(mail.$.searchBox.getShowing(), true);
		assert.deepEqual(otherErrors(page), []);
	});

	it("keeps the field while it holds a search, and puts it away once empty and left", async () => {
		const {mail, win} = await openMailCard(page);

		key(win, "t");
		mail.$.searchBox.setValue("tofe");
		mail.filterMail();
		mail.$.searchBox.forceBlur(null, true);
		assert.deepEqual(searchState(mail), {showing: true, focused: false, value: "tofe", collapsed: false});

		mail.$.searchBox.setValue("");
		mail.filterMail();
		assert.deepEqual(searchState(mail), {showing: false, focused: false, value: "", collapsed: true});
		assert.deepEqual(otherErrors(page), []);
	});

	it("ends the search on back, before back leaves the list", async () => {
		const {app, mail, win} = await openMailCard(page);
		// SlidingPane.back itself is not under test (and loops in jsdom's
		// pane state here); only whether back gets to it.
		let paneBacks = 0;
		app.$.slidingPane.back = () => {
			paneBacks++;
		};

		key(win, "t");
		mail.$.searchBox.setValue("tofe");
		mail.filterMail();
		let prevented = false;
		app.backHandler(null, {preventDefault: () => {
			prevented = true;
		}});
		assert.equal(prevented, true);
		assert.equal(paneBacks, 0);
		assert.deepEqual(searchState(mail), {showing: false, focused: false, value: "", collapsed: true});

		// With the field away, back goes on to the pane as before.
		app.backHandler(null, {preventDefault: () => {}});
		assert.equal(paneBacks, 1);
		assert.deepEqual(otherErrors(page), []);
	});

	it("puts it away when another folder is chosen", async () => {
		page.env.luna.db.seed([{_kind: "com.palm.folder:1", _id: "acct1-inbox", accountId: "acct1", displayName: "Inbox", favorite: true}]);
		const {app, mail, win} = await openMailCard(page);

		key(win, "t");
		mail.$.searchBox.setValue("tofe");
		mail.filterMail();
		mail.$.searchBox.forceBlur(null, true);
		app.folderChosen(null, page.env.enyo.application.folderProcessor.getFolder("acct1-inbox"));
		await page.env.settle();
		assert.deepEqual(searchState(mail), {showing: false, focused: false, value: "", collapsed: true});
		assert.deepEqual(otherErrors(page), []);
	});
});

describe("Email's message view", needsRoot, () => {
	const page = usePage({deviceInfo: PHONE_WITH_KEYBOARD});

	// A message the pane can show, without going through the database.
	function showMessage(pane, flags) {
		pane.$.messageLoader.email = {
			canModifyEmail: () => true,
			getFlags: () => flags
		};
		pane.$.pane.selectViewByName("message", true);
	}

	function setHeight(win, height) {
		Object.defineProperty(win, "innerHeight", {configurable: true, value: height});
		win.dispatchEvent(new win.Event("resize"));
	}

	const topBar = (pane) => ["bodyHeader", "bodyHeaderShadow", "placeholderHeader", "placeholderHeaderShadow"]
		.map((n) => pane.$[n].getShowing());

	const menu = (app) => {
		app.openAppMenu();
		const shown = {};
		for (const item of app.$.appMenu.getControls()) {
			if (item.getShowing()) {
				shown[item.name] = item.getCaption ? item.getCaption() : item.caption;
			}
		}
		app.$.appMenu.close();
		return shown;
	};

	it("keeps print, move, flag and mark-unread on the top toolbar on a tall screen", async () => {
		const {app, win} = await openMailCard(page);
		const pane = app.$.body;
		setHeight(win, 640);
		showMessage(pane, {read: true, flagged: false});

		assert.deepEqual(topBar(pane), [true, true, true, true]);
		const shown = menu(app);
		for (const name of ["markReadMenuItem", "flagMenuItem", "moveToFolderMenuItem"]) {
			assert.equal(name in shown, false, name);
		}
		assert.deepEqual(otherErrors(page), []);
	});

	it("puts them in the app menu on a short screen, as the legacy app had them", async () => {
		const {app, win} = await openMailCard(page);
		const pane = app.$.body;
		setHeight(win, 379); // the Q25's card
		app.$.slidingPane.setMultiView(false);
		app.$.slidingPane.selectViewImmediate(app.$.bodySliding);
		showMessage(pane, {read: true, flagged: false});

		assert.deepEqual(topBar(pane), [false, false, false, false]);
		let shown = menu(app);
		assert.equal(shown.markReadMenuItem, "Mark as Unread");
		assert.equal(shown.flagMenuItem, "Set Flag");
		assert.equal(shown.moveToFolderMenuItem, "Move to Folder...");
		assert.equal(shown.printMenuItem, "Print");

		showMessage(pane, {read: false, flagged: true});
		shown = menu(app);
		assert.equal(shown.markReadMenuItem, "Mark as Read");
		assert.equal(shown.flagMenuItem, "Remove Flag");

		// Not for the list, nor for a message that cannot be changed.
		app.$.slidingPane.selectViewImmediate(app.$.mailSliding);
		assert.equal("flagMenuItem" in menu(app), false);
		app.$.slidingPane.selectViewImmediate(app.$.bodySliding);
		pane.$.messageLoader.email.canModifyEmail = () => false;
		assert.equal("flagMenuItem" in menu(app), false);

		// Taller again (turned back upright): the toolbar returns.
		setHeight(win, 640);
		assert.deepEqual(topBar(pane), [true, true, true, true]);
		assert.deepEqual(otherErrors(page), []);
	});

	it("runs the menu items' actions on the message", async () => {
		const {app, win} = await openMailCard(page);
		const pane = app.$.body;
		setHeight(win, 379);
		const done = [];
		const flags = {read: true, flagged: false};
		pane.$.messageLoader.email = {
			canModifyEmail: () => true,
			getFlags: () => flags,
			setRead: (v) => done.push(["read", v]),
			setFlagged: (v) => done.push(["flagged", v])
		};
		pane.updateMenu = () => {};
		pane.$.pane.selectViewByName("message", true);
		app.openAppMenu();
		const items = Object.fromEntries(app.$.appMenu.getControls().map((i) => [i.name, i]));
		items.markReadMenuItem.owner[items.markReadMenuItem.onclick]();
		items.flagMenuItem.owner[items.flagMenuItem.onclick]();
		app.$.appMenu.close();

		assert.deepEqual(done, [["read", false], ["flagged", true]]);
		assert.equal(items.moveToFolderMenuItem.onclick, "moveToFolderClick");
		assert.equal(items.moveToFolderMenuItem.owner, pane);
		assert.deepEqual(otherErrors(page), []);
	});

	it("does not open file: links from a message, and opens the others", async () => {
		const {app} = await openMailCard(page);
		const display = app.$.body.$.messageLoader;
		const opens = () => page.env.luna.callsTo("palm://com.palm.applicationManager/open").map((c) => c.payload.target);

		display.openLink(null, "file:///media/internal/secret.txt");
		display.openLink(null, "FILE:///etc/passwd");
		display.openLink(null, "https://example.org/");
		await page.env.settle();
		assert.deepEqual(opens(), ["https://example.org/"]);
		assert.deepEqual(otherErrors(page), []);
	});

	it("clears the card when it is hidden, without the WebView it no longer has", async () => {
		page.env.luna.db.seed([{_kind: "com.palm.folder:1", _id: "acct1-inbox", accountId: "acct1", displayName: "Inbox", favorite: true}]);
		const {app} = await openMailCard(page);
		app.folderChosen(null, page.env.enyo.application.folderProcessor.getFolder("acct1-inbox"));
		await page.env.settle();
		assert.ok(app.$.mail.folder);

		app.windowHiddenHandler();
		assert.equal(app.$.mail.folder, undefined);
		assert.deepEqual(otherErrors(page), []);
	});
});

describe("Email's message viewer card", needsRoot, () => {
	// The card that opens an .eml file. Its first resize (from rendered) and
	// every activation used to throw: they called a MessagePane method that
	// does not exist.
	// launch: the harness runs a page's scripts after enyo.js on its launch.
	const page = usePage({page: "emailviewer/index.html", windowParams: {}, launch: {}, deviceInfo: PHONE_WITH_KEYBOARD});

	const viewer = (env) => Object.values(env.enyo.$).find((c) => c.kindName === "EmailViewerWindow");

	it("opens, resizes and activates without errors", async () => {
		await page.env.settle();
		const v = viewer(page.env);
		assert.ok(v);
		v.windowActivatedHandler();
		v.resizeHandler();
		assert.deepEqual(page.env.errors.splice(0), []);
	});

	it("puts its top toolbar away on a short screen", async () => {
		await page.env.settle();
		const win = page.env.window, pane = viewer(page.env).$.messageView;
		assert.equal(pane.$.bodyHeader.getShowing(), true);
		Object.defineProperty(win, "innerHeight", {configurable: true, value: 379});
		win.dispatchEvent(new win.Event("resize"));
		assert.equal(pane.$.bodyHeader.getShowing(), false);
		assert.deepEqual(page.env.errors.splice(0), []);
	});
});
