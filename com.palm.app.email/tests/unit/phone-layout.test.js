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

// The mail card's errors that are not about this: MessageDisplay.rendered's
// setRedirects (see launch.test.js) and Mail.checkList's no-layout logging.
const SET_REDIRECTS = /TypeError: this\.\$\.body\.setRedirects is not a function/;
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
	return page.env.errors.splice(0).filter((e) => !SET_REDIRECTS.test(e) && !NO_LAYOUT.test(e));
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

