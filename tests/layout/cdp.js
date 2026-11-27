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

// A Chrome DevTools Protocol client on the browser's own endpoint, with
// flattened sessions: one socket for the browser and every page in it, so the
// windows an app opens can be attached to before their scripts run.
"use strict";

async function connect(wsUrl) {
	const ws = new WebSocket(wsUrl);
	await new Promise((res, rej) => {
		ws.onopen = res;
		ws.onerror = rej;
	});
	let id = 0;
	const pending = new Map(), listeners = [];
	ws.onmessage = (m) => {
		const msg = JSON.parse(m.data);
		if (msg.id && pending.has(msg.id)) {
			const {res, rej, method} = pending.get(msg.id);
			pending.delete(msg.id);
			msg.error ? rej(new Error(method + ": " + JSON.stringify(msg.error))) : res(msg.result);
		} else if (msg.method) {
			for (const l of listeners) {
				l(msg);
			}
		}
	};
	ws.onclose = () => {
		for (const {rej, method} of pending.values()) {
			rej(new Error(method + ": the browser went away"));
		}
		pending.clear();
	};
	// send(method, params) on the browser; send(method, params, sessionId) on
	// one attached target.
	const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
		const i = ++id;
		pending.set(i, {res, rej, method});
		const msg = {id: i, method, params};
		if (sessionId) {
			msg.sessionId = sessionId;
		}
		ws.send(JSON.stringify(msg));
	});
	const off = (fn) => {
		const i = listeners.indexOf(fn);
		if (i >= 0) {
			listeners.splice(i, 1);
		}
	};
	return {send, on: (fn) => listeners.push(fn), off, close: () => ws.close()};
}

module.exports = {connect};
