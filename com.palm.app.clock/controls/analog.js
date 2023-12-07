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
		this.scaleClock();
		window.addEventListener ("resize", this.scaleClock, false);
	},

	scaleClock: function () 
	{
		var scale, marginL, marginR, marginT;
		marginT = "";
		if (window.innerWidth < 600 || window.innerHeight < 600) {
			scale = "scale(0.7)";
			marginL = "-100px";
			marginR = "-100px";
			if (window.innerHeight < 550) {
				scale = "scale(0.6)";
				marginT = "-100px";
			}
		}
		else if (window.innerWidth > 1200 || window.innerHeight >= 900) {
			scale = "scale(1.5)";
		}
		else {
			scale = "scale(1.0)";
		}

		var clocks = document.getElementsByClassName("analog");
		for (var i=0;i<clocks.length;i++) {
			clocks[i].style.marginLeft = marginL;
			clocks[i].style.marginRight = marginR;
			clocks[i].style.marginTop = marginT;
			clocks[i].style.transform = scale;
			clocks[i].style.display = "block";
		}
	},

	detachEventHandler: function ()
	{
		window.removeEventListener("resize", this.scaleClock);
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
