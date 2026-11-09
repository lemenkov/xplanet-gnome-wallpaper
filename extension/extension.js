// SPDX-FileCopyrightText: © 2026 Peter Lemenkov
// SPDX-License-Identifier: Apache-2.0

// xplanet Live Earth — show the newest xplanet frame on every monitor.
//
// Why this is not a one-liner: gnome-shell forces `monitorIndex = 0` for
// non-XML backgrounds (background.js, BackgroundSource.getBackground), so all
// monitors share a single Meta.Background.  Setting a file on it would give
// every screen the same image, cropped differently.  Instead we give each
// monitor its own Meta.Background and attach it to that monitor's
// BackgroundActor content.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import GDesktopEnums from 'gi://GDesktopEnums';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const STYLE = GDesktopEnums.BackgroundStyle.ZOOM;
const POLL_MS = 10 * 1000;
const FADE_MS = 900;
const FADE_STEP_MS = 45;

const FRAMES_DIR = 'xplanet-wall/frames';

export default class XplanetWallExtension extends Extension {
    enable() {
        this._backgrounds = new Map();   // monitorIndex -> our Meta.Background
        this._applied = new Map();       // monitorIndex -> {actor, path}
        this._fades = new Map();         // monitorIndex -> GLib source id
        this._timerId = 0;
        this._reapplyId = 0;
        this._monitorsChangedId = 0;

        this._monitorsChangedId = Main.layoutManager.connect(
            'monitors-changed', () => this._scheduleReapply());

        this._tick();
        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_MS, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });

        console.log(`xplanet-wall: enabled, ` +
            `${Main.layoutManager.monitors.length} monitor(s)`);
    }

    disable() {
        console.log('xplanet-wall: disabling');
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
        if (this._reapplyId) {
            GLib.source_remove(this._reapplyId);
            this._reapplyId = 0;
        }
        for (const id of this._fades.values())
            GLib.source_remove(id);
        this._fades.clear();

        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = 0;
        }

        this._restore();
        this._backgrounds.clear();
        this._applied.clear();
    }

    // -- internals ---------------------------------------------------------

    _scheduleReapply() {
        // New monitors appear after the layout manager has rebuilt.
        if (this._reapplyId)
            GLib.source_remove(this._reapplyId);
        this._reapplyId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
            this._reapplyId = 0;
            this._tick();
            return GLib.SOURCE_REMOVE;
        });
    }

    _framesDir(width, height) {
        return Gio.File.new_for_path(GLib.build_filenamev([
            GLib.get_user_cache_dir(), FRAMES_DIR, `${width}x${height}`,
        ]));
    }

    _newestFrame(width, height) {
        const dir = this._framesDir(width, height);
        let best = null;
        let enumerator;
        try {
            enumerator = dir.enumerate_children('standard::name',
                Gio.FileQueryInfoFlags.NONE, null);
        } catch (e) {
            return null;        // no frames rendered for this size yet
        }

        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            const name = info.get_name();
            if (!name.endsWith('.png'))
                continue;
            // Frame names are zero-padded epochs, so string order is time order.
            if (best === null || name > best)
                best = name;
        }
        enumerator.close(null);
        return best === null ? null : dir.get_child(best);
    }

    _tick() {
        const managers = Main.layoutManager._bgManagers;
        if (!managers)
            return;

        for (const manager of managers) {
            try {
                this._applyForMonitor(manager);
            } catch (e) {
                logError(e, 'xplanet-wall: failed to apply background');
            }
        }
    }

    _applyForMonitor(manager) {
        const index = manager._monitorIndex ?? 0;
        const actor = manager.backgroundActor;
        const monitor = Main.layoutManager.monitors[index];
        if (!actor || !monitor)
            return;

        const file = this._newestFrame(monitor.width, monitor.height);
        if (!file)
            return;

        const path = file.get_path();
        const prev = this._applied.get(index);

        // Nothing changed and the shell has not rebuilt the actor underneath us.
        if (prev && prev.actor === actor && prev.path === path)
            return;

        const content = actor.content;
        if (!content || typeof content.set_background !== 'function')
            return;

        let background = this._backgrounds.get(index);
        if (!background) {
            background = new Meta.Background({meta_display: global.display});
            this._backgrounds.set(index, background);
        }

        // Show the new frame, then take over the actor.
        const previousPath = prev && prev.actor === actor ? prev.path : null;
        this._transition(index, background, previousPath, path);
        content.set_background(background);

        this._applied.set(index, {actor, path});
        console.log(`xplanet-wall: monitor ${index} ` +
            `(${monitor.width}x${monitor.height}) -> ${path}`);
    }

    _transition(index, background, previousPath, newPath) {
        const newFile = Gio.File.new_for_path(newPath);

        const running = this._fades.get(index);
        if (running) {
            GLib.source_remove(running);
            this._fades.delete(index);
        }

        if (!previousPath || previousPath === newPath ||
            !GLib.file_test(previousPath, GLib.FileTest.EXISTS)) {
            background.set_file(newFile, STYLE);
            return;
        }

        const oldFile = Gio.File.new_for_path(previousPath);
        const startedAt = GLib.get_monotonic_time();

        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FADE_STEP_MS, () => {
            const elapsedMs = (GLib.get_monotonic_time() - startedAt) / 1000;
            const t = Math.min(elapsedMs / FADE_MS, 1.0);
            const eased = t * t * (3 - 2 * t);      // smoothstep

            try {
                background.set_blend(oldFile, newFile, eased, STYLE);
            } catch (e) {
                logError(e, 'xplanet-wall: blend failed, hard cut instead');
                this._fades.delete(index);
                try {
                    background.set_file(newFile, STYLE);
                } catch (err) {
                    logError(err, 'xplanet-wall: could not set frame');
                }
                return GLib.SOURCE_REMOVE;
            }

            if (t >= 1.0) {
                background.set_file(newFile, STYLE);
                this._fades.delete(index);
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });

        this._fades.set(index, id);
    }

    _restore() {
        const managers = Main.layoutManager._bgManagers ?? [];
        for (const manager of managers) {
            try {
                const content = manager.backgroundActor?.content;
                const shared = manager._backgroundSource?.getBackground(
                    manager._monitorIndex ?? 0);
                if (content && shared &&
                    typeof content.set_background === 'function')
                    content.set_background(shared);
            } catch (e) {
                logError(e, 'xplanet-wall: could not restore background');
            }
        }
    }
}
