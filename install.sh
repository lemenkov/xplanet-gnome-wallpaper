#!/bin/sh
# SPDX-FileCopyrightText: © 2026 Peter Lemenkov
# SPDX-License-Identifier: Apache-2.0

# Install the xplanet live-Earth wallpaper: renderer, systemd timer, and
# the GNOME Shell extension.  Nothing is enabled until the last step.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
bin_dir="${XDG_BIN_HOME:-$HOME/.local/bin}"
ext_dir="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/xplanet-wall@petro"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

say() { printf '  %s\n' "$*"; }

printf 'Installing xplanet-wall\n'

mkdir -p "$bin_dir" "$ext_dir" "$unit_dir"

install -m 0755 "$here/xplanet-wall-render" "$bin_dir/xplanet-wall-render"
say "renderer    -> $bin_dir/xplanet-wall-render"

install -m 0644 "$here/extension/metadata.json" "$ext_dir/metadata.json"
install -m 0644 "$here/extension/extension.js" "$ext_dir/extension.js"
say "extension   -> $ext_dir"

install -m 0644 "$here/systemd/xplanet-wall.service" "$unit_dir/"
install -m 0644 "$here/systemd/xplanet-wall.timer" "$unit_dir/"
say "units       -> $unit_dir"

systemctl --user daemon-reload

printf '\nRendering the first frames (this may take a few seconds)\n'
"$bin_dir/xplanet-wall-render" || true

printf '\nEnabling the timer\n'
systemctl --user enable --now xplanet-wall.timer
say "timer       -> $(systemctl --user is-active xplanet-wall.timer)"

printf '\nEnabling the extension\n'
if gnome-extensions enable xplanet-wall@petro 2>/dev/null; then
    say "extension   -> $(gnome-extensions info xplanet-wall@petro | grep -i '^  State' || true)"
else
    say "extension not enabled automatically; run: gnome-extensions enable xplanet-wall@petro"
fi

printf '\nDone.  Log out and back in if the desktop does not change.\n'
printf 'Status:  xplanet-wall-render --status\n'
printf 'Undo:    systemctl --user disable --now xplanet-wall.timer\n'
printf '         gnome-extensions disable xplanet-wall@petro\n'
