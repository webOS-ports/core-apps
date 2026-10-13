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

// Minimal Chrome DevTools Protocol client (Node 22 built-in WebSocket).
"use strict";

async function connect(wsUrl) {
	const ws = new WebSocket(wsUrl);
	await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
	let id = 0;
	const pending = new Map(), listeners = [];
	ws.onmessage = (m) => {
		const msg = JSON.parse(m.data);
		if (msg.id && pending.has(msg.id)) {
			const {res, rej} = pending.get(msg.id);
			pending.delete(msg.id);
			msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
		} else if (msg.method) {
			listeners.forEach((l) => l(msg));
		}
	};
	const send = (method, params = {}) => new Promise((res, rej) => {
		const i = ++id;
		pending.set(i, {res, rej});
		ws.send(JSON.stringify({id: i, method, params}));
	});
	return {send, on: (fn) => listeners.push(fn), close: () => ws.close()};
}

module.exports = {connect};
