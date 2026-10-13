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

/*global enyo */

/**
 * A container of rows that can be reordered by holding a row and dragging it,
 * like the Mojo reorderable lists of the legacy app. Rows are the direct
 * children with a rowIndex; a row with reorderable: false can not be picked up.
 * Fires onReorder(fromIndex, toIndex).
 */
enyo.kind({
	name: "Tasks.ReorderList",
	kind: enyo.Control,
	published: {
		reorderable: true
	},
	events: {
		onReorder: ""
	},

	rows: function () {
		return this.getControls().filter(function (c) {
			return c.rowIndex !== undefined && c.showing;
		});
	},

	rowFromEvent: function (inEvent) {
		var c = inEvent.dispatchTarget;
		while (c && c.parent !== this) {
			c = c.parent;
		}
		return c && c.rowIndex !== undefined ? c : null;
	},

	mouseholdHandler: function (inSender, inEvent) {
		var row = this.reorderable && this.rowFromEvent(inEvent);
		if (!row || row.reorderable === false || !row.hasNode()) {
			return;
		}
		this.dragRow = row;
		this.dragRows = this.rows();
		this.dragFrom = this.dragRows.indexOf(row);
		this.dragTo = this.dragFrom;
		this.dragHeight = row.node.offsetHeight;
		row.addClass("tasks-reordering");
		return true;
	},

	mouseupHandler: function () {
		if (this.dragRow && !this.dragging) {
			this.endReorder();
		}
	},

	dragstartHandler: function (inSender, inEvent) {
		if (this.dragRow) {
			this.dragging = true;
			return true;
		}
	},

	dragHandler: function (inSender, inEvent) {
		if (!this.dragging) {
			return;
		}
		var rows = this.dragRows, from = this.dragFrom, h = this.dragHeight;
		var to = Math.max(0, Math.min(rows.length - 1, from + Math.round(inEvent.dy / h)));
		this.dragTo = to;
		this.dragRow.applyStyle("-webkit-transform", "translate3d(0," + inEvent.dy + "px,0)");
		this.dragRow.applyStyle("transform", "translate3d(0," + inEvent.dy + "px,0)");
		for (var i = 0; i < rows.length; i++) {
			if (i === from) {
				continue;
			}
			var shift = (i > from && i <= to) ? -h : (i < from && i >= to) ? h : 0;
			rows[i].applyStyle("-webkit-transform", shift ? "translate3d(0," + shift + "px,0)" : null);
			rows[i].applyStyle("transform", shift ? "translate3d(0," + shift + "px,0)" : null);
		}
		return true;
	},

	dragfinishHandler: function (inSender, inEvent) {
		if (!this.dragging) {
			return;
		}
		if (inEvent.preventClick) {
			inEvent.preventClick();
		}
		var from = this.dragFrom, to = this.dragTo;
		this.endReorder();
		if (from !== to) {
			this.doReorder(from, to);
		}
		return true;
	},

	endReorder: function () {
		(this.dragRows || []).forEach(function (r) {
			r.applyStyle("-webkit-transform", null);
			r.applyStyle("transform", null);
		});
		if (this.dragRow) {
			this.dragRow.removeClass("tasks-reordering");
		}
		this.dragRow = this.dragRows = null;
		this.dragging = false;
	}
});

/**
 * Positions for moving one item of a sorted list, the way the legacy app did:
 * the moved item gets a position between its new neighbours, and when there is
 * no room left between them the following items are pushed along.
 *
 * items: objects with _id and position in display order (after the move is NOT
 * applied yet). step is negative for lists sorted descending.
 * Returns [{_id, position}] to merge.
 */
Tasks.movePositions = function (items, from, to, step) {
	var moved = items[from];
	var rest = items.slice(0, from).concat(items.slice(from + 1));
	var before = rest[to - 1], after = rest[to];
	var changes = [];
	if (!before && !after) {
		return changes;
	}
	var shift = function (from) {
		for (var i = from; i < rest.length; i++) {
			rest[i].position += step;
			changes.push({_id: rest[i]._id, position: rest[i].position});
		}
	};
	// Positions stay above 0: 0 or no position marks a task that still needs one.
	var position;
	if (!before) {
		position = after.position - step;
		if (position <= 0) {
			position = Math.floor(after.position / 2);
		}
		if (position <= 0) {
			shift(0);
			position = Math.floor(rest[0].position / 2);
		}
	} else if (!after) {
		position = before.position + step;
		if (position <= 0) {
			position = Math.floor(before.position / 2);
		}
	} else if (Math.abs(after.position - before.position) >= 2) {
		position = Math.floor((before.position + after.position) / 2);
	} else {
		// No room: shift everything from the new slot on by one step.
		shift(to);
		position = Math.floor((before.position + rest[to].position) / 2);
	}
	moved.position = position;
	changes.push({_id: moved._id, position: position});
	return changes;
};
