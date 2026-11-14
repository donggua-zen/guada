# Computer Use

Desktop automation for GuaDa on Windows and macOS. The capability is
implemented as a separate local sidecar process, not inside the Electron
renderer or the NestJS backend process.

## Scope

- Platform: Windows x64 (win32-x64), macOS arm64 (darwin-arm64)
- Observe: screenshot, cursor position, window list, per-application window
  groups, accessibility tree (UI Automation on Windows, AX on macOS)
- Act: element click (by ref or accessible name), element value set, pixel
  click, type, key, scroll, drag, focus window, app launch by absolute path
- Out of scope for this release: Linux, Set-of-Marks overlays, OCR

The capability is opt-in. The plugin is registered as an `extended` plugin, so
it is disabled by default on a fresh install and stays disabled until the user
enables the plugin master switch and grants the toolkit to an agent. The
**Settings → Computer Use** page keeps its switch in sync with the plugin
master switch; the `computerUse.enabled` value is UI state and is **not** a
second execution gate.

## Architecture

```
LLM tool call
  -> backend-ts ComputerPlugin (lazy toolkit, Electron only)
  -> BridgeClient.request("computer_*")
  -> Electron BridgeServer exact handler
  -> ComputerSidecarClient (spawn + NDJSON JSON-RPC)
  -> guada-computer[.exe|-darwin-arm64] --stdio
  -> Windows: UI Automation / SendInput / GDI capture
     macOS: AX API / CGEvent / CoreGraphics capture
```

The Electron main process owns the sidecar lifecycle. The NestJS backend never
spawns it and never needs to know the packaged resources path. The sidecar
listens on stdio only: no TCP port, no token, no network surface.

## Repository and version lock

The sidecar source is maintained as an independent repository placed next to
the main project (never inside it). The recommended checkout path is
`../guada-computer` (a sibling of the main repository); `scripts/build-sidecar.js`
also accepts the legacy in-tree `guada-computer/` path and the
`GUADA_COMPUTER_ROOT` environment variable.

One repository carries both toolchains — Rust workspace at the root, Swift
package under `macos/`:

```
Cargo.toml
crates/core/          # Windows: capture, coordinates, input, keys, windows
crates/a11y/          # Windows: UI Automation engine
crates/sidecar/       # Windows: stdio JSON-RPC binary
build.bat             # Windows: locates Visual Studio C++ tools via vswhere
smoke-rpc.cjs         # protocol smoke test (both platforms)
macos/                # macOS: Swift package (same NDJSON protocol)
  Sources/guada-computer/
    main.swift          # stdio JSON-RPC loop, generation registry, routing
    ScreenCapture.swift # CoreGraphics display capture + cursor
    WindowList.swift    # CGWindowList enumeration
    AXBridge.swift      # AX tree snapshot / press / set_value / ref resolution
    InputEngine.swift   # CGEvent clicks, typing, key combos, scroll, drag
```

The main repository does not track the sidecar checkout. `.gitignore` still
excludes `/guada-computer/` for legacy in-tree checkouts. Instead,
`sidecar.lock.json` pins the repository URL, commit, released version and the
exact binary hash:

```json
{
  "repo": "https://github.com/donggua-zen/guada-computer.git",
  "tag": "v0.1.0",
  "commit": "<full commit sha of the sidecar checkout>",
  "protocol": "1",
  "binaries": {
    "win32-x64": {
      "path": "build-resources/computer-sidecar/guada-computer.exe",
      "sha256": "..."
    },
    "darwin-arm64": {
      "path": "build-resources/computer-sidecar/guada-computer-darwin-arm64",
      "sha256": "..."
    }
  }
}
```

The prebuilt binary is committed under `build-resources/computer-sidecar/` so
normal application builds and CI do not need a Rust toolchain. The sidecar
repository is private (`https://github.com/donggua-zen/guada-computer`) and
`sidecar.lock.json` records the exact commit the bundled binary was built
from; update `commit` whenever the binary is re-baked.

Naming rule: product code, comments, documentation, tests, commit messages and
release notes must not mention the reference project used during design
research. All identifiers use the `guada-*` prefix.

## Building the sidecar

On Windows, `build.bat` finds Visual Studio with `vswhere`, initializes the x64
MSVC environment, and then forwards arguments to cargo:

```bat
build.bat build --release
```

On macOS, the sidecar is the Swift package under `macos/`; `swift build -c
release` produces `macos/.build/release/guada-computer` with the Command Line
Tools alone (no Xcode, no Rust toolchain needed).

From the main repository:

```bash
pnpm run build:sidecar   # build + copy + update sidecar.lock.json
pnpm run verify:sidecar  # existence + sha256 + --version
```

`build:sidecar` expects `guada-computer/` to be cloned next to the main
project. On Windows it copies `target/release/guada-computer.exe` into
`build-resources/computer-sidecar/`; on macOS it copies
`macos/.build/release/guada-computer` to
`build-resources/computer-sidecar/guada-computer-darwin-arm64` (the name the
Electron client resolves for `process.platform-process.arch`).

## Protocol

One JSON object per line. Standard output carries protocol frames only; all
diagnostics go to standard error.

Request:

```json
{"id":"1","method":"a11y.observe","params":{}}
```

Success:

```json
{"id":"1","result":{...}}
```

Failure:

```json
{"id":"1","error":{"code":"STALE_REFERENCE","message":"..."}}
```

Methods:

| Method | Purpose |
| --- | --- |
| `ping` | version, protocol and capabilities |
| `observe` | `screenshot`, `cursor_position`, `list_windows`, `list_apps`, `wait` |
| `a11y.observe` | UI Automation snapshot with `[ref]` entries |
| `input` | click, set_value, drag, type, key, scroll, focus window |
| `launch_app` | start an executable by absolute path |
| `shutdown` | graceful process exit |

Error codes: `UNSUPPORTED`, `NOT_FOUND`, `STALE_REFERENCE`,
`PERMISSION_REQUIRED`, `UNCERTAIN`, `BACKEND`, `UNAVAILABLE`,
`INVALID_REQUEST`.

## Observation lease

Every observation returns a generation:

- screenshot → capture generation
- window list → window generation
- accessibility snapshot → snapshot generation

The backend stores the latest observation kind and generation per session. An
input must carry `expected_generation` and the kind must match:

| Input | Required observation |
| --- | --- |
| `click_element`, `set_value` | accessibility |
| pixel clicks, `mouse_move`, `drag` | screenshot |
| `focus_window` | window list |
| `type`, `key`, `scroll` without coordinates | any |
| `scroll` with coordinates | screenshot |

Any input clears the lease and the sidecar's native caches. The next input must
observe again. Reusing an old ref or coordinate is rejected with
`STALE_REFERENCE`.

## macOS platform notes

- Coordinates: screenshots are captured per display in pixels; CGEvent input
  and CGWindowList bounds are in global points. On the common Retina case
  (scale factor 2) the sidecar reports the pixel `width`/`height` of the PNG
  while `x`/`y` inputs are interpreted in the display's point space; the
  client is expected to use coordinates taken from the screenshot scaled into
  point space exactly like the Windows sidecar's DPI handling.
- Key names: `key` combos accept `cmd`/`ctrl` (both map to Command on macOS),
  `alt`/`option`, `shift`, `fn` plus key names such as `a-z`, `0-9`, `enter`,
  `tab`, `esc`, `delete`, `up/down/left/right`, `home`, `end`, `pageup`,
  `pagedown`, `f1-f12`.
- `focus_window` activates the owning process (`NSRunningApplication.activate`)
  and raises it via the AX `AXRaise` action.
- `click_element`/`set_value` resolve refs by re-walking the AX tree at action
  time; a ref that no longer resolves reports `STALE_REFERENCE`. An AX press
  that reports `UNSUPPORTED` authorizes the same validated pixel fallback as
  Windows.

## Stale-reference validation

Before a `[ref]` action the sidecar validates:

1. snapshot generation
2. element runtime id
3. element and owning-window bounds
4. ancestry chain up to the observed window
5. hit-test at the element center
6. identity and bounds again after the slow reads

If validation fails, no cached coordinate is used for a fallback. A semantic
action that reports `UNSUPPORTED` before dispatch is the only case that
authorizes a validated pixel click at the element center.

## Action policy and approvals

Settings group `computerUse`:

```json
{
  "enabled": true,
  "actions": {
    "screenshot": "allow",
    "a11y_observe": "allow",
    "list_windows": "allow",
    "click_element": "ask",
    "left_click": "ask",
    "right_click": "ask",
    "middle_click": "ask",
    "double_click": "ask",
    "triple_click": "ask",
    "mouse_move": "allow",
    "type": "ask",
    "key": "ask",
    "scroll": "ask",
    "focus_window": "ask",
    "set_value": "ask",
    "drag": "ask",
    "launch_app": "ask"
  }
}
```

- `launch_app` is a separate tool (`computer_launch`) with its own policy key;
  it only accepts absolute executable paths and never forwards arguments.
- `allow`: execute without a card.
- `ask`: show the `computer-use-approval` card. Options are "allow once",
  "allow for this turn" and "deny".
- `deny`: reject before touching the sidecar.

Sessions without an answer surface (sub-agents, bots) fail closed for `ask`
actions. Read-only tools are allowed in plan mode; `computer_input` is not.

## Permissions and safety

- The sidecar runs as the current user and has the same desktop access as the
  GuaDa process.
- Windows normally needs no additional system permission. Elevated (UIPI)
  windows cannot be controlled; the error is reported instead of bypassed.
- macOS needs two TCC grants attributed to the host app: **Screen Recording**
  (screenshots) and **Accessibility** (AX tree + input synthesis). Without
  them the sidecar answers `ping` with `capabilities.screenshot=false` /
  `a11y=false` and fails tool calls with `PERMISSION_REQUIRED`. The Settings
  → Computer Use page detects the missing grants from `a11y_error` and offers
  a button that opens the Privacy & Security pane
  (`computer-use:open-privacy-settings` IPC). Users must re-launch the app
  after granting. The packaged sidecar binary is codesigned together with the
  app so the TCC attribution sticks.
- The sidecar does not open a network listener.
- Screenshots are written to the session workspace under
  `computer-screenshots/` and are not uploaded automatically.
- Foreground activation uses the standard Win32 path plus a bounded fallback
  that temporarily clears the foreground-lock timeout and restores it
  immediately.
- UIA work runs on one MTA actor thread; element handles never cross threads.

## Testing

Sidecar:

```bash
cd guada-computer
build.bat test --workspace
node smoke-rpc.cjs target/release/guada-computer.exe
```

Main repository:

```bash
pnpm run verify:sidecar
pnpm run test:computer-sidecar
pnpm run test:computer-sidecar:electron   # Electron client + real sidecar + screenshot/a11y
pnpm --dir backend-ts exec jest test/computer test/plugins/computer.plugin.spec.ts --runInBand
pnpm --dir frontend exec vitest run src/utils/computerUse.test.ts
```

Manual acceptance:

1. Enable Computer Use in Settings.
2. Open Notepad.
3. Ask the agent to observe the screen, click the editor, type two lines, and
   take a screenshot.
4. Verify the text appears and the screenshot shows it.
5. Repeat at 125% / 150% display scaling and on a secondary monitor.
6. Remove the sidecar binary and confirm the tool reports "unavailable"
   without crashing the app.

## Packaging

- `build-resources/computer-sidecar/guada-computer.exe` is copied by
  electron-builder to `resources/computer-sidecar/` **only for the Windows
  target** (`build.win.extraResources`). macOS builds copy only the Mach-O
  binaries matching `guada-computer-darwin-*`
  (`build.mac.extraResources` filter) so the Windows PE binary never ships in
  a mac bundle and `codesign --deep` cannot trip over it.
- On macOS the after-pack handler chmods the sidecar executable (extraResources
  copies do not preserve the Unix exec bit) and the signing step signs each
  sidecar binary with the app identity before strict verification; an unsigned
  foreign Mach-O inside Resources would fail `codesign --verify --deep`.
- The sidecar is spawned with the bundled `resources/vc-runtime` on `PATH`, the
  same as the backend, so a clean Windows machine does not need a system-wide
  VC++ runtime.
- `scripts/after-pack-handler.js` fixes executable permissions before macOS
  signing (Windows does not need chmod) and signs the sidecar binaries.
- `scripts/verify-asar-layout.js` checks the packaged binary for the running
  platform (`guada-computer.exe` on Windows,
  `guada-computer-darwin-arm64` on Apple silicon) and runs `--version`.
- The sidecar is version-locked to the app. It is never downloaded at runtime.

## Roadmap

- Notarized builds + hardened-runtime entitlements for the mac sidecar
- Screenshot retention controls
- Optional Set-of-Marks overlay and OCR
- Batched multi-step actions with automatic re-verification (a `run_steps`
  style tool that carries window, screenshot and snapshot state across steps)
- Window-scoped coordinates and window-relative screenshots

Drag and application launch shipped in v0.1.0 of the sidecar's second
revision. The remaining items are deliberately outside the current release.
