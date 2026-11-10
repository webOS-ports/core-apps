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

/*
 * Signing in to a Community Account, or making one, after setup.
 *
 * First Use offers this as a step that can be skipped, and HP's Accounts app
 * never had a way to sign in afterwards: HP's first use made the account
 * compulsory. This view is that way. It calls the same methods First Use does,
 * on com.palm.accountservices (org.webosports.service.communityaccount):
 * authenticateAccount, createNovaAccount and getTermsAndConditions. Signing in
 * either way names the device's profile account after the member; the
 * Accounts list is fetched again afterwards (AccountManager.signInDone).
 *
 * What the service says back is never shown as it is: a refusal is a
 * sentence for its code, with the code under it in small type. The password
 * fields are cleared as soon as a password is sent.
 */

// What the service's codes mean to the user. The service's own errorText is
// for the log.
var COMMUNITY_ACCOUNT_UNAVAILABLE = $L("Signing in is not available right now. Please try again later.");
var COMMUNITY_ACCOUNT_SENTENCES = {
	"AUTH_FAILED": $L("That e-mail address and password do not match an account."),
	"LOGIN_ERROR": $L("That e-mail address and password do not match an account."),
	"EMAIL_TAKEN": $L("There is already an account with this e-mail address. Sign in with it instead."),
	"INVALID_EMAIL": $L("Please enter a valid e-mail address."),
	"WEAK_PASSWORD": $L("The password needs at least 8 characters."),
	"MISSING_ARGS": $L("Please fill in every field that is needed."),
	"INVALID_REQUEST": $L("The account server could not read the request. Please check what you entered."),
	"ACCOUNT_CREATION_ERROR": $L("The account server could not make the account. Please try again later."),
	"SERVER_UNREACHABLE": $L("The account server cannot be reached. Check that the device is online, then try again."),
	"STATUS_ERROR": $L("The account server had a problem. Please try again later."),
	"SERVER_ERROR": $L("The account server had a problem. Please try again later."),
	"BAD_REPLY": $L("The account server gave an answer this device does not understand. Please try again later."),
	"TERMS_ERROR": $L("The terms of service could not be fetched. Check that the device is online, then try again."),
	"DEVICE_ID_UNAVAILABLE": $L("This device could not identify itself to the account server. Please try again later."),
	"CONNECTOR_EXCEPTION": COMMUNITY_ACCOUNT_UNAVAILABLE
};

// The server's minimum, counted as it counts it: in bytes of UTF-8.
var COMMUNITY_ACCOUNT_MIN_PASSWORD = 8;

enyo.kind({
	name: "MyApps.PalmID.SignIn",
	kind: enyo.VFlexBox,
	className: "enyo-bg",
	events: {
		// inSignedIn: true once the device is signed in.
		onSignIn_Done: ""
	},
	components: [
		{kind: "PalmService", name: "authenticate", service: "palm://com.palm.accountservices/",
			method: "authenticateAccount", onSuccess: "signedIn", onFailure: "refused"},
		{kind: "PalmService", name: "createAccount", service: "palm://com.palm.accountservices/",
			method: "createNovaAccount", onSuccess: "signedIn", onFailure: "refused"},
		{kind: "PalmService", name: "getTerms", service: "palm://com.palm.accountservices/",
			method: "getTermsAndConditions", onSuccess: "gotTerms", onFailure: "noTerms"},

		{kind: "Toolbar", className: "enyo-toolbar-light accounts-header", pack: "center", components: [
			{kind: "Image", src: "images/acounts-48x48.png"},
			{kind: "Control", content: $L("Community Account")}
		]},
		{className: "accounts-header-shadow"},
		{kind: enyo.Scroller, name: "scroller", flex: 1, components: [
			{kind: "Control", className: "box-center", components: [

				// Signing in.
				{name: "signInPart", components: [
					{className: "enyo-paragraph", content: $L("Sign in with your Community Account to use it on this device.")},
					{kind: "RowGroup", className: "accounts-group", caption: $L("EMAIL OR USERNAME"), components: [
						{kind: "Input", name: "signInEmail", autoCapitalize: "lowercase", autocorrect: false,
							spellcheck: false, onkeypress: "signInKey"}
					]},
					{kind: "RowGroup", className: "accounts-group", caption: $L("PASSWORD"), components: [
						{kind: "PasswordInput", name: "signInPassword", onkeypress: "signInKey"}
					]},
					{kind: "Button", name: "signInButton", className: "enyo-button-affirmative accounts-btn",
						caption: $L("Sign In"), onclick: "signIn"},
					{name: "toCreate", className: "enyo-paragraph accounts-link", content: $L("New here? Create a Community Account"),
						onclick: "showCreate"},
					{className: "enyo-paragraph accounts-note", content: $L("Your e-mail address and password are sent over an encrypted connection to the Community Account service at appcatalog.webosarchive.org. The password is not stored on this device.")}
				]},

				// Making an account.
				{name: "createPart", showing: false, components: [
					{className: "enyo-paragraph", content: $L("Create a Community Account. You are signed in with it on this device straight away.")},
					{kind: "RowGroup", className: "accounts-group", caption: $L("NAME"), components: [
						{kind: "Input", name: "createFirstName", hint: $L("First name"), autoCapitalize: "title", autocorrect: false},
						{kind: "Input", name: "createLastName", hint: $L("Last name (optional)"), autoCapitalize: "title", autocorrect: false}
					]},
					{kind: "RowGroup", className: "accounts-group", caption: $L("EMAIL"), components: [
						{kind: "Input", name: "createEmail", autoCapitalize: "lowercase", autocorrect: false, spellcheck: false}
					]},
					{kind: "RowGroup", className: "accounts-group", caption: $L("PASSWORD"), components: [
						{kind: "PasswordInput", name: "createPassword", hint: $L("At least 8 characters")}
					]},
					{kind: "HFlexBox", align: "center", className: "accounts-agree", components: [
						{kind: "CheckBox", name: "createAgree", disabled: true, onChange: "updateCreate"},
						{flex: 1, name: "agreeLabel", content: $L("I agree to the Terms of Service"), onclick: "toggleAgree"}
					]},
					{name: "readTerms", className: "enyo-paragraph accounts-link", content: $L("Fetching the Terms of Service..."),
						onclick: "readTerms"},
					{kind: "Button", name: "createButton", className: "enyo-button-affirmative accounts-btn",
						caption: $L("Create Account"), disabled: true, onclick: "createNow"},
					{name: "toSignIn", className: "enyo-paragraph accounts-link", content: $L("Already have an account? Sign in"),
						onclick: "showSignIn"},
					{className: "enyo-paragraph accounts-note", content: $L("Your name, e-mail address and password are sent over an encrypted connection to the Community Account service at appcatalog.webosarchive.org, which keeps your name and e-mail address. The password is not stored on this device.")}
				]},

				// What went wrong: a sentence, and the service's code under it.
				{name: "status", showing: false, className: "enyo-paragraph", components: [
					{name: "statusText", className: "enyo-text-error"},
					{name: "statusCode", className: "accounts-status-code"}
				]}
			]}
		]},
		{className: "accounts-footer-shadow"},
		{kind: "Toolbar", className: "enyo-toolbar-light", components: [
			{kind: "Button", name: "backButton", className: "accounts-toolbar-btn", caption: $L("Back"), onclick: "goBack"}
		]},

		{kind: "ModalDialog", name: "termsDialog", caption: $L("Terms of Service"), lazy: false, components: [
			{kind: enyo.Scroller, name: "termsScroller", className: "accounts-terms", components: [
				{name: "termsText", className: "accounts-terms-text"}
			]},
			{kind: "HFlexBox", components: [
				{kind: "Button", caption: $L("Close"), flex: 1, onclick: "closeTerms"},
				{kind: "Button", name: "agreeButton", caption: $L("I Agree"), flex: 1, className: "enyo-button-affirmative", onclick: "agreeToTerms"}
			]}
		]},
		{kind: "MyApps.PalmID.SpinnerOverlayPopup", name: "spinnerOverlay"}
	],

	busy: false,
	// The server's terms, as plain text; "" until they are in.
	terms: "",
	termsAsked: false,

	// Opened from the Accounts list: sign in, with nothing left from last time.
	beginSignIn: function() {
		this.$.signInEmail.setValue("");
		this.$.signInPassword.setValue("");
		this.$.createFirstName.setValue("");
		this.$.createLastName.setValue("");
		this.$.createEmail.setValue("");
		this.$.createPassword.setValue("");
		this.$.createAgree.setChecked(false);
		this.setBusy(false);
		this.showSignIn();
	},

	showSignIn: function() {
		this.$.createPart.hide();
		this.$.signInPart.show();
		this.clearStatus();
	},

	showCreate: function() {
		this.$.signInPart.hide();
		this.$.createPart.show();
		this.clearStatus();
		// The address typed to sign in is likely the one to make the account with.
		if (this.$.createEmail.getValue() === "")
			this.$.createEmail.setValue(this.$.signInEmail.getValue());
		if (this.terms === "" && !this.termsAsked)
			this.fetchTerms();
		this.updateCreate();
	},

	goBack: function() {
		if (this.busy)
			return;
		if (this.$.createPart.getShowing()) {
			this.showSignIn();
			return;
		}
		this.doSignIn_Done(false);
	},

	signInKey: function(inSender, inEvent) {
		if (inEvent && inEvent.keyCode === 13)
			this.signIn();
	},

	signIn: function() {
		if (this.busy)
			return;
		var email = this.trim(this.$.signInEmail.getValue());
		var password = this.$.signInPassword.getValue();
		if (email === "" || password === "") {
			this.showStatus(COMMUNITY_ACCOUNT_SENTENCES["MISSING_ARGS"], "");
			return;
		}
		this.clearStatus();
		this.setBusy(true);
		this.$.authenticate.call({email: email, password: password, application: "ACCT_SRV"});
		// Sent: it is not kept here.
		this.$.signInPassword.setValue("");
	},

	createNow: function() {
		if (this.busy || !this.canCreate())
			return;
		var firstName = this.trim(this.$.createFirstName.getValue());
		var lastName = this.trim(this.$.createLastName.getValue());
		var email = this.trim(this.$.createEmail.getValue());
		var password = this.$.createPassword.getValue();
		if (firstName === "" || email === "" || password === "") {
			this.showStatus(COMMUNITY_ACCOUNT_SENTENCES["MISSING_ARGS"], "");
			return;
		}
		if (this.utf8Length(password) < COMMUNITY_ACCOUNT_MIN_PASSWORD) {
			this.showStatus(COMMUNITY_ACCOUNT_SENTENCES["WEAK_PASSWORD"], "");
			return;
		}
		this.clearStatus();
		this.setBusy(true);
		var args = {email: email, password: password, firstName: firstName};
		if (lastName !== "")
			args.lastName = lastName;
		this.$.createAccount.call(args);
		this.$.createPassword.setValue("");
	},

	signedIn: function(inSender, inResponse) {
		this.setBusy(false);
		if (!inResponse || inResponse.returnValue !== true) {
			this.refused(inSender, inResponse);
			return;
		}
		this.doSignIn_Done(true);
	},

	refused: function(inSender, inResponse) {
		this.setBusy(false);
		var r = this.refusal(inResponse);
		this.showStatus(r.text, r.code);
	},

	// {text, code} for a reply that is not a success. A code is shown only when
	// it is a short word; anything else is not passed on.
	refusal: function(inResponse) {
		var raw = inResponse && inResponse.errorCode !== undefined ? String(inResponse.errorCode) : "";
		var code = /^[A-Za-z0-9_-]{1,40}$/.test(raw) ? raw : "";
		var text = COMMUNITY_ACCOUNT_SENTENCES.hasOwnProperty(code) ? COMMUNITY_ACCOUNT_SENTENCES[code] : COMMUNITY_ACCOUNT_UNAVAILABLE;
		return {text: text, code: code !== "" ? code : (inResponse ? "UNKNOWN" : "BAD_REPLY")};
	},

	fetchTerms: function() {
		this.termsAsked = true;
		this.$.readTerms.setContent($L("Fetching the Terms of Service..."));
		this.$.getTerms.call({});
	},

	gotTerms: function(inSender, inResponse) {
		var t = inResponse && typeof inResponse.terms === "string" ? inResponse.terms : "";
		if (t.replace(/\s+/g, "") === "") {
			this.noTerms(inSender, {errorCode: "TERMS_ERROR"});
			return;
		}
		this.terms = t;
		// Plain text from a third party, shown as text: a control's content is
		// escaped by Enyo (allowHtml is false), so nothing in it is markup.
		this.$.termsText.setContent(t);
		this.$.readTerms.setContent($L("Read the Terms of Service"));
		if (this.$.status.getShowing() && this.$.statusCode.getContent() === "TERMS_ERROR")
			this.clearStatus();
		this.updateCreate();
	},

	noTerms: function(inSender, inResponse) {
		this.termsAsked = false;
		this.$.readTerms.setContent($L("The Terms of Service could not be fetched. Tap to try again."));
		this.showStatus(COMMUNITY_ACCOUNT_SENTENCES["TERMS_ERROR"], "TERMS_ERROR");
		this.updateCreate();
	},

	readTerms: function() {
		if (this.terms === "") {
			if (!this.termsAsked)
				this.fetchTerms();
			return;
		}
		this.$.termsDialog.openAtCenter();
	},

	closeTerms: function() {
		this.$.termsDialog.close();
	},

	agreeToTerms: function() {
		this.$.termsDialog.close();
		this.$.createAgree.setChecked(true);
		this.updateCreate();
	},

	toggleAgree: function() {
		if (this.terms === "")
			return;
		this.$.createAgree.setChecked(!this.$.createAgree.getChecked());
		this.updateCreate();
	},

	canCreate: function() {
		return !this.busy && this.terms !== "" && this.$.createAgree.getChecked();
	},

	// The box can only be ticked once the terms are there; Create, only once it is.
	updateCreate: function() {
		this.$.createAgree.setDisabled(this.terms === "" || this.busy);
		this.$.createButton.setDisabled(!this.canCreate());
	},

	setBusy: function(busy) {
		this.busy = busy;
		this.$.signInButton.setDisabled(busy);
		this.$.backButton.setDisabled(busy);
		this.updateCreate();
		if (busy)
			this.$.spinnerOverlay.openAtCenter();
		else
			this.$.spinnerOverlay.close();
	},

	showStatus: function(text, code) {
		this.$.statusText.setContent(text);
		this.$.statusCode.setContent(code || "");
		this.$.statusCode.setShowing(!!code);
		this.$.status.show();
	},

	clearStatus: function() {
		this.$.status.hide();
		this.$.statusText.setContent("");
		this.$.statusCode.setContent("");
	},

	trim: function(s) {
		return String(s || "").replace(/^\s+|\s+$/g, "");
	},

	// What the server counts: bytes of UTF-8.
	utf8Length: function(s) {
		return unescape(encodeURIComponent(s)).length;
	}
});
