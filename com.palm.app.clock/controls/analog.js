// @@@LICENSE
//
//      Copyright (c) 2011-2013 LG Electronics, Inc.
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

enyo.kind({
	name: "Analog",
	kind: "Control",
	className:"analog clockbg",
	published: {boolShowSeconds: true},
	components: [
		{ kind: "ApplicationEvents", onUnload: "detachEventHandler", onWindowActivated: "scaleClock", onWindowRotated: "scaleClock" },
		{name: "handHour", className:"clockHand Hour"},
		{name: "handMin", className:"clockHand Min"},
		{name: "handSec", className:"clockHand Sec"},
		{kind: "Control", layoutKind: "HLayout", className: "clockLabel", components: [
			{name: "lblWeekday", className:" weekday"},
			{width: "110px"},
			{name: "lblDay", className:"day"}
			]
		}
	],
	
	create: function ()
	{
		this.inherited(arguments);
		this.log();
		this.local_weekday_formatter = new enyo.g11n.DateFmt({format: "EEE"});	
		this.local_day_formatter = new enyo.g11n.DateFmt({format: "dd"});
		this.scaleClockBound = enyo.bind(this, "scaleClock");
		window.addEventListener("resize", this.scaleClockBound, false);
	},
	rendered: function ()
	{
		this.inherited(arguments);
		this.scaleClock();
	},
	// The face is FACE px square (.clockbg). It is scaled to fit the room its
	// container has, up to 1.5, with a margin all round. It was scaled by
	// window size in steps (0.6, 0.7, 1.0, 1.5), which left it larger than
	// the card on every phone: on the Zinwa Q25 (450x380 CSS px) it ran under
	// the toolbar and its hands covered the Clock/Alarms buttons.
	//
	// A transform does not change the room an element takes, so the margins
	// make its box the scaled size, for the container to centre.
	FACE: 514,
	scaleClock: function ()
	{
		var node = this.hasNode();
		var room = this.container && this.container.hasNode();
		if (!node || !room || !room.clientWidth || !room.clientHeight) {
			// Not laid out, or its view is hidden: scaled once it shows.
			return;
		}
		var fit = Math.min(room.clientWidth, room.clientHeight) * 0.94 / this.FACE;
		var scale = Math.min(fit, 1.5);
		var shrink = Math.round(this.FACE * (scale - 1));
		node.style.transformOrigin = "0 0";
		node.style.transform = "scale(" + scale + ")";
		node.style.margin = "0 " + shrink + "px " + shrink + "px 0";
		node.style.display = "block";
	},
	detachEventHandler: function ()
	{
		window.removeEventListener("resize", this.scaleClockBound);
	},
	tock: function ()
	{
		this.setClockHand(this.$.handHour, enyo.application.utilities.getCurrentHourPartial(false), 12);
		this.setClockHand(this.$.handMin, enyo.application.utilities.getCurrentMinutePartial(),60);
		if (this.boolShowSeconds === true) {
		    this.setClockHand(this.$.handSec, enyo.application.utilities.getCurrentSecond(),60);
		}
		this.setDateDisplay();
	},
	
	setClockHand: function (ctrlHand, intPos, intPosMax)
	{
		var intRotation = (360) * (intPos/intPosMax);
		ctrlHand.applyStyle("transform","rotate(" + intRotation + "deg)");
	},
	
	setDateDisplay: function ()
	{
		this.$.lblWeekday.setContent(this.local_weekday_formatter.format(enyo.application.utilities.now()));
		this.$.lblDay.setContent(this.local_day_formatter.format(enyo.application.utilities.now()));
	},
	
	boolShowSecondsChanged: function ()
	{
		this.$.handSec.setShowing(this.boolShowSeconds);
	}
});
