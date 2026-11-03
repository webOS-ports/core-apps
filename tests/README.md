# Tests

The core apps are tested in Node, with no browser and no device. Each test
loads an app's page into [jsdom](https://github.com/jsdom/jsdom) together with
Enyo 1.0 (from source), and fakes everything WebAppMgr and the luna bus would
provide. The tests run with `node:test`, Node's built-in runner.

    npm install
    npm test                      # every app
    npm run coverage              # the same, with a coverage summary

    node --test com.palm.app.clock/tests/unit/alarm.test.js    # one file

Node 22 or newer is needed. jsdom is pinned to 29.1.1, because jsdom 30
needs Node 22.22.2 or newer.

## What it needs

| variable      | what for                                                       |
|---------------|----------------------------------------------------------------|
| `ENYO`        | the Enyo 1.0 checkout. Default: `../enyo-1.0-ports` or `../enyo-1.0` next to this repository, or the one in `LUNEOS_ROOT` |
| `LUNEOS_ROOT` | a LuneOS root filesystem: a Yocto image's `rootfs` directory, or a copy of a device's. It provides `/usr/palm/*` other than Enyo: MojoLoader and the Calendar and Contacts libraries it loads. Optional; tests that need it are skipped without it |
| `TEST_TZ`     | the time zone the tests run in. Default `Europe/Amsterdam`; the tests' local times and DST changes assume it |

Without `LUNEOS_ROOT`, Calendar, Contacts and part of Email are skipped.
Example:

    LUNEOS_ROOT=.../tmp/work/qemux86_64-webos-linux/luneos-dev-image/1.0/rootfs npm test

## Layout

    tests/harness/               shared by every app
      env.js                     boot(): a page, its windows, the fake PalmSystem
      luna.js                    the fake luna bus, DB8, activitymanager
      fixtures.js                usePage() and small helpers
      jasmine.js                 runs the old Jasmine 1.x specs
      device/                    answers recorded from a device
      *.test.js                  tests of the harness itself
    com.palm.app.<app>/tests/
      unit/*.test.js             the app's tests
      legacy/                    the Jasmine specs that came with the app
      legacy.test.js             runs them (see "Old Jasmine specs")
      fixtures.js                the app's own setup, where it has some

`npm test` runs `tests/harness/*.test.js` and every
`com.palm.app.*/tests/**/*.test.js`. Tasks also has its own DevTools suite
(`com.palm.app.tasks/tests/run.js`, see its README) that drives the app in
Chromium or on a device.

## Writing a test

```js
const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const {usePage, plain} = require("../../../tests/harness/fixtures");

describe("Notes", () => {
	// A fresh page before each test; the test fails if the page logs an
	// error or throws.
	const page = usePage({app: "com.palm.app.notes"});

	it("shows the stored memos", async () => {
		page.env.luna.db.seed([{_kind: "com.palm.note:1", title: "Hi", text: "Hi", position: "a"}]);
		page.env.launch({});
		await page.env.settle();

		const grid = page.env.window.app.appView.$.grid;
		assert.deepEqual(plain(grid.agent.getMemos().map((m) => m.title)), ["Hi"]);
	});
});
```

Objects made in the page belong to another JavaScript realm: compare them
with `plain(value)` (a JSON copy), not directly with `deepEqual`.

### boot(options)

`usePage` calls `boot` from `env.js`. Options:

- `app`: the app id (its directory here), required
- `page`: the page to load, default `index.html`
- `now`: the clock to start at, e.g. `"2026-11-03T07:00:00"` (local time)
- `launch`: launch params; the app is launched right after booting
- `windowParams`: `enyo.windowParams` for a page another page opens
- `stubWindows`: windows the app opens get stand-ins that record what they are
  sent, instead of loading their own pages

Booting runs the page's scripts up to and including `enyo.js` and the app's
`depends.js`. `launch(params)` runs the rest of the page the first time and
calls `Mojo.relaunch` after that, as WebAppMgr does.

The environment it returns has:

- `window`, `enyo`: the page
- `luna`: the fake bus (below)
- `launch(params)`, `settle()`: launch the app; wait until the bus is idle and
  the page's short timers (up to 500 ms) have run
- `setNow(date)`: move the clock of every window of the app
- `fireActivity(name)`: a scheduled activity's time comes, and the app is
  launched with its callback's params
- `windows`, `windowNamed(name)`: the cards, dashboards and pop-up alerts the
  app opened. Pages of the app open as real windows, sharing the bus and the
  clock; a new card is activated once its page has loaded
- `create(props)`, `tap(control)`: make a component, tap a rendered control
- `audio`, `palmSystem`: what the app did with media elements and PalmSystem
- `logs`, `errors`: console output of all the app's windows; `errors` also has
  uncaught exceptions and scripts that failed to load
- `close()`

### The fake bus

`env.luna` answers every service call. Every call is recorded:
`luna.callsTo("luna://com.palm.db/find")`. A test can answer a service itself
with `luna.on(prefix, (payload, call) => response)`, and send to open
subscriptions with `luna.push(prefix, response)`.

- `luna.db`, `luna.tempdb`: DB8. `seed(objects)` stores objects; `all(kind)` and
  `get(prop, value)` read them back. It supports `find` (with `watch` and
  `count`), `search`, `watch`, `put`, `merge`, `del`, `get` and `batch`; the
  operators `=` `!=` `<` `<=` `>` `>=` `%` `?`; `orderBy`, `desc` and `limit`. Values
  of different types compare as DB8 compares them (`null` is never `>= 0`),
  a property path through an array matches any element, and objects without
  the property match nothing. Kinds that extend others (from the app's
  `configuration/db/kinds`) are included in their parent kind. A watch fires
  once, when its answer changes.
- `luna.activities`: activitymanager. `scheduled()`, `get(name)`; `create`,
  `complete`, `cancel` and `getDetails` answer the way a device does.
- Common services (account templates, connection status, preferences, time,
  time zone rules) answer with the fields a device's answer has. The account
  templates are a LuneOS image's, in `device/accountTemplates.json`.
  `com.palm.accountservices` answers as a missing service does.
- Anything else answers `{"returnValue": true}`.

`PalmSystem` has the methods and values a device's has. `localStorage` is
shared by the app's windows.

## Old Jasmine specs

The apps' old specs (Jasmine 1.x, once run with Ruby, `rake jasmine` and a
browser) are in `tests/legacy/`. `legacy.test.js` runs each spec file in the
app's page, with `describe`, `it`, `expect`, `spyOn`, `runs`, `waitsFor` and
the other Jasmine 1.x functions:

```js
legacySuite({
	app: "com.palm.app.calendar",
	specs: [
		"tests/legacy/DataHubSpec.js",
		{file: "tests/legacy/CacheManagerSpec.js", launch: {}}   // in the launched app
	],
	skip: {"Suite name spec name": "why it is not run"},
	todo: {"Suite name spec name": "the known bug it shows"}
});
```

Every spec that is not run says why in `skip`. A `todo` spec runs and is
reported, but its failure does not fail the run; it marks a known bug.

## Known bugs the tests show

These are reported as `todo`, so they show up in every run until they are
fixed:

- Email: `MessageDisplay.rendered` calls `this.$.body.setRedirects`, but the
  body is a `DivHtmlView`, which has no `redirects`, so the mail card throws
  when it renders (`com.palm.app.email/mail/source/MessageDisplay.js`).
- Contacts: `depends.js` names `app/Ringtones.js` and
  `app/dialogs/NameDetails.js`, which are not in the tree.
- Accounts: the app throws when there is no `com.palm.palmprofile` account
  (`source/AccountManager.js`). Every device has one.

## Limits

jsdom does no layout: elements have no size, so `VirtualList`s render no rows
and code that measures the page sees zeros. Tests that need rows either stub
the list's row fetch or check the data behind the list.
