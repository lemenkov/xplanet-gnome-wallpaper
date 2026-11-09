<!--
SPDX-FileCopyrightText: 2026 Peter Lemenkov <lemenkov@gmail.com>
SPDX-License-Identifier: Apache-2.0
-->

# xplanet Live Earth for GNOME

A live satellite view of Earth as the GNOME desktop background.

A small Python renderer downloads the newest NASA VIIRS true-colour mosaic,
fills the gaps where the sensor saw nothing with Blue Marble, and has
[xplanet](https://xplanet.sourceforge.net/) draw one frame per distinct
monitor size. A GNOME Shell extension puts the newest frame on every monitor
and crossfades between refreshes. The ISS — and any other NORAD object you
list — is drawn on the globe from live TLEs.

## How it works

| Piece | What it does |
|---|---|
| `xplanet-wall-render` | Probes NASA GIBS for the newest complete mosaic, composites the day and night maps, and renders `~/.cache/xplanet-wall/frames/<W>x<H>/<epoch>.png` |
| `systemd/xplanet-wall.timer` | Runs the renderer 20 s after login and every five minutes |
| `extension/` | Polls the frame cache every 10 s and gives each monitor its own `Meta.Background`, preserving each screen's aspect ratio |

Every network step is cached and idempotent, and frames are published
atomically, so a refresh that cannot reach NASA or Celestrak leaves the
previous frames on screen.

## Requirements

- Linux with a GNOME Shell 50 session (Wayland or X11)
- [xplanet](https://xplanet.sourceforge.net/), including its stock Blue Marble
  maps (`/usr/share/xplanet/images/{earth,night}.jpg`) and built-in SGP4
- Python 3.11+, Pillow and NumPy for the VIIRS compositing path, and PyGObject
  for monitor detection

On Fedora:

    sudo dnf install xplanet python3-pillow python3-numpy python3-gobject

Without Pillow and NumPy, set `use_viirs = 0` to render Blue Marble only.
Without PyGObject, monitor detection falls back to a guess; list the sizes in
the config instead.

## Install

    git clone <repository-url>
    cd xplanet-gnome-wallpaper
    ./install.sh

`install.sh` copies the renderer to `~/.local/bin`, the extension to
`~/.local/share/gnome-shell/extensions/xplanet-wall@petro`, and the units to
`~/.config/systemd/user` (honouring the `XDG_*` overrides). It then renders
the first frames and enables both the timer and the extension. Log out and
back in if the desktop does not change.

## Configuration

Optional. Create `~/.config/xplanet-wall/config` with `key = value` lines;
anything unset keeps its default:

| Key | Default | Meaning |
|---|---|---|
| `longitude` | `auto` | View centre; `auto` follows the system time zone |
| `latitude` | `20` | View centre latitude |
| `scale` | `0.90` | Globe diameter as a fraction of the shorter screen side |
| `keep` | `2` | Frames kept per monitor size |
| `use_viirs` | `1` | `0` disables the NASA download (Blue Marble only) |
| `max_holes` | `0.30` | Reject mosaics with more no-data than this |
| `monitors` | detected | Fixed sizes, e.g. `3840x2160,1080x1920` |
| `satellites` | `25544` | NORAD IDs to draw; empty disables the layer |
| `satellite_trail` | `ground` | `ground`, `orbit`, `both` or `none` |

The full set of keys, with comments, is in `DEFAULT_CONFIG` at the top of
`xplanet-wall-render`.

## Usage

    xplanet-wall-render --status          # mosaic date, TLE age, frames
    xplanet-wall-render --list-monitors   # sizes the renderer would target
    xplanet-wall-render --no-network      # Blue Marble and cached TLEs only
    xplanet-wall-render --satellites 25544,48274

## Uninstall

    systemctl --user disable --now xplanet-wall.timer
    gnome-extensions disable xplanet-wall@petro
    rm -f  ~/.local/bin/xplanet-wall-render
    rm -rf ~/.local/share/gnome-shell/extensions/xplanet-wall@petro
    rm -f  ~/.config/systemd/user/xplanet-wall.{service,timer}
    rm -rf ~/.cache/xplanet-wall
    systemctl --user daemon-reload

## License

Apache-2.0. The tree is [REUSE](https://reuse.software/) compliant: every file
carries SPDX copyright and licence information, and the full text is in
`LICENSES/Apache-2.0.txt`.
