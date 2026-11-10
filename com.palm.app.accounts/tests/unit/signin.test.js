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

// Accounts: signing in to a Community Account, or making one, after setup
// (MyApps.PalmID.SignIn), against com.palm.accountservices as
// org.webosports.service.communityaccount answers it.
"use strict";

const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const {usePage} = require("../../../tests/harness/fixtures");
const templates = require("../../../tests/harness/device/accountTemplates.json");

const SERVICE = "luna://com.palm.accountservices/";

function account(id, templateId, username) {
	const t = templates.find((x) => x.templateId === templateId);
	return {_kind: "com.palm.account:1", _id: id, templateId, username, alias: t.loc_name, beingDeleted: false,
		icon: t.icon, capabilityProviders: t.capabilityProviders.map((c) => ({capability: c.capability, id: c.id}))};
}
const PROFILE = account("profile", "com.palm.palmprofile", "LuneOS");

const NO_TOKEN = () => ({returnValue: false, errorCode: "NO_TOKEN", errorText: "not signed in to a Community Account"});
const TOKEN = () => ({returnValue: true, accountAlias: "ada@example.org", accountUsername: "ada", token: "TK", accountState: "ACTIVE"});
const TERMS = "Terms of Service\n\nBe kind.";

const text = (control) => control.hasNode().textContent.replace(/\s+/g, " ").trim();

describe("Accounts: Community Account sign-in", () => {
	const page = usePage({app: "com.palm.app.accounts"});
	const manager = () => page.env.enyo.$.accountManager;
	const signIn = () => manager().$.signIn;
	const calls = (method) => page.env.luna.callsTo(SERVICE + method);
	const launch = async () => {
		page.env.luna.db.seed([PROFILE]);
		page.env.launch({});
		await page.env.settle();
	};
	const open = async () => {
		page.env.luna.on(SERVICE + "getAccountToken", NO_TOKEN);
		await launch();
		page.env.tap(manager().$.palmProfileItem);
		await page.env.settle();
	};
	// The device as the service leaves it once signed in: the token, and the
	// profile account named after the member.
	const signedInNow = () => {
		page.env.luna.on(SERVICE + "getAccountToken", TOKEN);
		page.env.luna.db.handle("merge", {objects: [{_id: "profile", username: "Ada Lovelace"}]});
	};
	const showCreate = async (terms = () => ({returnValue: true, terms: TERMS})) => {
		page.env.luna.on(SERVICE + "getTermsAndConditions", terms);
		page.env.tap(signIn().$.toCreate);
		await page.env.settle();
	};
	const fillCreate = (password = "correct horse") => {
		signIn().$.createFirstName.setValue(" Ada ");
		signIn().$.createLastName.setValue("Lovelace");
		signIn().$.createEmail.setValue(" ada@example.org ");
		signIn().$.createPassword.setValue(password);
	};

	it("offers to sign in when the service is there and nobody is signed in", async () => {
		page.env.luna.on(SERVICE + "getAccountToken", NO_TOKEN);
		await launch();

		assert.equal(manager().$.palmProfileGroup.getCaption(), "Local Account");
		assert.equal(manager().$.palmProfileItem.getDisabled(), false);
		assert.equal(manager().$.palmProfileHint.getShowing(), true);
	});

	it("offers nothing without the service", async () => {
		await launch();

		assert.equal(manager().$.palmProfileItem.getDisabled(), true);
		assert.equal(manager().$.palmProfileHint.getShowing(), false);
	});

	it("opens signing in, not the profile, from the Local Account row", async () => {
		await open();

		assert.equal(manager().getViewName(), "signIn");
		assert.equal(signIn().$.signInPart.getShowing(), true);
		assert.equal(page.env.luna.callsTo(SERVICE + "getAggregatedAccountInfo").length, 0);
	});

	it("signs in, forgets the password, and comes back to the list as the Community Account", async () => {
		await open();
		page.env.luna.on(SERVICE + "authenticateAccount", () => {
			signedInNow();
			return {returnValue: true, accountAlias: "ada@example.org", username: "Ada Lovelace", profileNamed: true};
		});
		signIn().$.signInEmail.setValue(" ada@example.org ");
		signIn().$.signInPassword.setValue("correct horse");
		page.env.tap(signIn().$.signInButton);
		assert.equal(signIn().$.signInPassword.getValue(), "", "the password is not kept once sent");
		await page.env.settle();

		assert.deepEqual(calls("authenticateAccount").map((c) => c.payload),
			[{email: "ada@example.org", password: "correct horse", application: "ACCT_SRV"}]);
		assert.equal(manager().getViewName(), "prefsAndAccounts");
		assert.equal(manager().$.palmProfileGroup.getCaption(), "Community Account");
		assert.equal(text(manager().$.palmProfileName), "Ada Lovelace");
		assert.equal(manager().$.palmProfileHint.getShowing(), false);
	});

	it("says what a refusal means, with its code, and not the service's text", async () => {
		await open();
		page.env.luna.on(SERVICE + "authenticateAccount", () =>
			({returnValue: false, errorCode: "AUTH_FAILED", errorText: "wrong e-mail address or password <b>x</b>"}));
		signIn().$.signInEmail.setValue("ada@example.org");
		signIn().$.signInPassword.setValue("nope");
		page.env.tap(signIn().$.signInButton);
		await page.env.settle();

		assert.equal(manager().getViewName(), "signIn");
		assert.equal(text(signIn().$.statusText), "That e-mail address and password do not match an account.");
		assert.equal(text(signIn().$.statusCode), "AUTH_FAILED");
		assert.doesNotMatch(text(signIn().$.status), /wrong e-mail|<b>/);
		assert.equal(signIn().$.signInButton.getDisabled(), false, "can try again");
	});

	it("does not send a sign-in with a field empty", async () => {
		await open();
		signIn().$.signInEmail.setValue("ada@example.org");
		page.env.tap(signIn().$.signInButton);
		await page.env.settle();

		assert.equal(calls("authenticateAccount").length, 0);
		assert.equal(text(signIn().$.statusText), "Please fill in every field that is needed.");
	});

	it("goes back to the list with Back, still offering to sign in", async () => {
		await open();
		page.env.tap(signIn().$.backButton);
		await page.env.settle();

		assert.equal(manager().getViewName(), "prefsAndAccounts");
		assert.equal(manager().$.palmProfileItem.getDisabled(), false);
		assert.equal(calls("authenticateAccount").length, 0);
	});

	it("fetches the terms for a new account, and makes it only once they are agreed to", async () => {
		await open();
		await showCreate();

		assert.equal(calls("getTermsAndConditions").length, 1);
		assert.equal(signIn().$.createPart.getShowing(), true);
		assert.equal(signIn().$.createAgree.getDisabled(), false, "the box can be ticked once the terms are in");
		assert.equal(signIn().$.createButton.getDisabled(), true, "not before it is ticked");

		page.env.tap(signIn().$.readTerms);
		await page.env.settle();
		page.env.tap(signIn().$.agreeButton);
		await page.env.settle();
		assert.equal(signIn().$.createAgree.getChecked(), true);
		assert.equal(signIn().$.createButton.getDisabled(), false);

		page.env.luna.on(SERVICE + "createNovaAccount", () => {
			signedInNow();
			return {returnValue: true, accountAlias: "ada@example.org", username: "Ada Lovelace", profileNamed: true};
		});
		fillCreate();
		page.env.tap(signIn().$.createButton);
		assert.equal(signIn().$.createPassword.getValue(), "", "the password is not kept once sent");
		await page.env.settle();

		assert.deepEqual(calls("createNovaAccount").map((c) => c.payload),
			[{email: "ada@example.org", password: "correct horse", firstName: "Ada", lastName: "Lovelace"}]);
		assert.equal(manager().getViewName(), "prefsAndAccounts");
		assert.equal(manager().$.palmProfileGroup.getCaption(), "Community Account");
	});

	it("cannot agree to terms it does not have, and fetches them again when asked", async () => {
		await open();
		await showCreate(() => ({returnValue: false, errorCode: "TERMS_ERROR", errorText: "no terms"}));

		assert.equal(signIn().$.createAgree.getDisabled(), true);
		page.env.tap(signIn().$.agreeLabel);
		assert.equal(signIn().$.createAgree.getChecked(), false);
		assert.equal(signIn().$.createButton.getDisabled(), true);
		assert.equal(text(signIn().$.statusCode), "TERMS_ERROR");

		page.env.luna.on(SERVICE + "getTermsAndConditions", () => ({returnValue: true, terms: TERMS}));
		page.env.tap(signIn().$.readTerms);
		await page.env.settle();
		assert.equal(calls("getTermsAndConditions").length, 2);
		assert.equal(signIn().$.createAgree.getDisabled(), false);
		assert.equal(signIn().$.status.getShowing(), false, "the terms error is gone once they are in");
	});

	it("takes a blank answer for no terms", async () => {
		await open();
		await showCreate(() => ({returnValue: true, terms: "  \n "}));

		assert.equal(signIn().$.createAgree.getDisabled(), true);
		assert.equal(text(signIn().$.statusCode), "TERMS_ERROR");
	});

	it("shows the terms as text, never as markup", async () => {
		await open();
		await showCreate(() => ({returnValue: true, terms: "<img src=\"https://example.org/x.png\"> & more"}));

		page.env.tap(signIn().$.readTerms);
		await page.env.settle();
		const node = signIn().$.termsText.hasNode();
		assert.ok(node, "the terms are on the page");
		assert.equal(node.textContent, "<img src=\"https://example.org/x.png\"> & more", "as written, once");
		assert.equal(node.querySelector("img"), null, "no element made from them");
	});

	it("turns down a password shorter than the server takes, counted in bytes", async () => {
		await open();
		await showCreate();
		page.env.tap(signIn().$.agreeLabel);
		fillCreate("short");
		page.env.tap(signIn().$.createButton);
		await page.env.settle();

		assert.equal(calls("createNovaAccount").length, 0);
		assert.equal(text(signIn().$.statusText), "The password needs at least 8 characters.");

		// Four characters, eight bytes: the server's strlen takes it.
		page.env.luna.on(SERVICE + "createNovaAccount", () => ({returnValue: false, errorCode: "EMAIL_TAKEN"}));
		fillCreate("éééé");
		page.env.tap(signIn().$.createButton);
		await page.env.settle();
		assert.equal(calls("createNovaAccount").length, 1);
		assert.equal(text(signIn().$.statusText), "There is already an account with this e-mail address. Sign in with it instead.");
	});

	it("shows no code that is not a short word", async () => {
		await open();
		page.env.luna.on(SERVICE + "authenticateAccount", () => ({returnValue: false, errorCode: "<script>x</script>"}));
		signIn().$.signInEmail.setValue("ada@example.org");
		signIn().$.signInPassword.setValue("correct horse");
		page.env.tap(signIn().$.signInButton);
		await page.env.settle();

		assert.equal(text(signIn().$.statusText), "Signing in is not available right now. Please try again later.");
		assert.equal(text(signIn().$.statusCode), "UNKNOWN");
	});
});
