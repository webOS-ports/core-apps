# Tasks UI tests

`run.js` drives the app the way a user does - real mouse and
keyboard events sent over the Chrome DevTools Protocol - and checks each step
both in the UI and in the database, which it reads through the app's own
`Tasks.Service`. It needs Node 22 or newer (built-in `WebSocket` and `fetch`)
and nothing else.

    node run.js <mode> <target>

| mode      | database              | layout                                  |
|-----------|-----------------------|-----------------------------------------|
| `browser` | mock (`source/mock`)  | desktop browser, wide: all three views  |
| `phone`   | mock                  | desktop browser at 450x380: one view    |
| `device`  | the device's real DB8 | whatever the device shows               |

`<target>` is a DevTools endpoint such as `http://127.0.0.1:9333`, or the
`ws://` URL of one page. Given an endpoint, the Tasks page is looked up; if an
old instance left a second one behind, the page holding the focus is used.

The exit status is 0 when every check passed. Page screenshots and a
`results.json` go to `shots-<mode>/` (or `$SHOTS`).

## In a desktop browser

    ENYO=~/src/enyo-1.0-ports ./browser.sh          # or: ./browser.sh phone

`browser.sh` serves the app together with Enyo under the path the app loads it
from (`/usr/palm/frameworks/enyo/0.10`), starts a headless Chromium on
`index-desktop.html` and runs the suite. `CHROME`, `PORT` and `HTTP_PORT`
override the browser binary and the two ports.

The notes checks (two in `browser`, one in `phone`) fail in a desktop browser
and pass on a device: with native focus in the notes field, the RichText
"Notes..." placeholder ends up in the saved notes.

## On a device

WebAppMgr listens for DevTools on port 9998. Open Tasks on an unlocked device,
forward the port and run:

    adb forward tcp:19998 tcp:9998        # or: ssh -N -L 19998:127.0.0.1:9998 root@<device>
    node run.js device http://127.0.0.1:19998

The screen has to be on and unlocked with Tasks in front: a card that is not
full screen is laid out at card size, and the checks then exercise the wrong
layout.

This runs against the real database. Everything the suite creates is named
`ZT ...`; it deletes lists and unfiled tasks with that prefix before it starts
and when it is done, and touches nothing else.

`FAPFIX=1` patches `enyo.gesture` in the page (see `fapfix.js`) for a device
whose Enyo does not yet clear `_isFocusing` by itself; without either, every
second tap after focusing a text field is swallowed and the run fails early.
`DEBUG=1` logs the scrolling done to reach an element.
