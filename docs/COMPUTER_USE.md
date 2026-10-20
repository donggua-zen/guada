# Computer Use

Windows desktop automation for GuaDa. The capability is implemented as a
separate local sidecar process, not inside the Electron renderer or the NestJS
backend process.

## Scope

- Platform: Windows x64 (first release)
- Observe: screenshot, cursor position, window list, UI Automation tree
- Act: element click, pixel click, type, key, scroll, focus window
- Out of scope for this release: application launch, drag, macOS, Linux,
  Set-of-Marks overlays, OCR

The capability is opt-in. It is disabled until the user enables the plugin
master switch and grants the toolkit to an agent. The **Settings → Computer
Use** page keeps its switch in sync with the plugin master switch; the
`computerUse.enabled` value is UI state and is **not** a second execution gate.

## Architecture

```
LLM tool call
  -> backend-ts ComputerPlugin (lazy toolkit, Electron only)
  -> BridgeClient.request("computer_*")
  -> Electron BridgeServer exact handler
  -> ComputerSidecarClient (spawn + NDJSON JSON-RPC)
  -> guada-computer.exe --stdio
  -> UI Automation / SendInput / GDI capture
```

The Electron main process owns the sidecar lifecycle. The NestJS backend never
spawns it and never needs to know the packaged resources path. The sidecar
listens on stdio only: no TCP port, no token, no network surface.

## Repository and version lock

The sidecar source is maintained as an independent repository next to the main
project:

```
guada-computer/
  Cargo.toml
  crates/core/        # capture, coordinates, input, keys, windows
  crates/a11y/        # Windows UI Automation engine
  crates/sidecar/     # stdio JSON-RPC binary
  build.bat           # locates Visual Studio C++ tools via vswhere
  smoke-rpc.cjs
```

The main repository does not track the sidecar checkout. `.gitignore` excludes
`/guada-computer/`. Instead, `sidecar.lock.json` pins the released version and
the exact binary hash:

```json
{
  "tag": "v0.1.0",
  "protocol": "1",
  "binaries": {
    "win32-x64": {
      "path": "build-resources/computer-sidecar/guada-computer.exe",
      "sha256": "..."
    }
  }
}
```

The prebuilt binary is committed under `build-resources/computer-sidecar/` so
normal application builds and CI do not need a Rust toolchain. After creating
the independent repository, fill `repo` and `commit` in the lockfile.

Naming rule: product code, comments, documentation, tests, commit messages and
release notes must not mention the reference project used during design
research. All identifiers use the `guada-*` prefix.

## Building the sidecar

On Windows, `build.bat` finds Visual Studio with `vswhere`, initializes the x64
MSVC environment, and then forwards arguments to cargo:

```bat
build.bat build --release
```

From the main repository:

```bash
pnpm run build:sidecar   # build + copy + update sidecar.lock.json
pnpm run verify:sidecar  # existence + sha256 + --version
```

`build:sidecar` expects `guada-computer/` to be cloned next to the main
project. It copies `target/release/guada-computer.exe` into
`build-resources/computer-sidecar/`.

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
| `observe` | `screenshot`, `cursor_position`, `list_windows`, `wait` |
| `a11y.observe` | UI Automation snapshot with `[ref]` entries |
| `input` | click, type, key, scroll, focus window |
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
| `click_element` | accessibility |
| pixel clicks, `mouse_move` | screenshot |
| `focus_window` | window list |
| `type`, `key`, `scroll` without coordinates | any |
| `scroll` with coordinates | screenshot |

Any input clears the lease and the sidecar's native caches. The next input must
observe again. Reusing an old ref or coordinate is rejected with
`STALE_REFERENCE`.

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
    "focus_window": "ask"
  }
}
```

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
pnpm run test:computer-sidecar:electron   # Electron client + real sidecar + screenshot/UIA
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
  target** (`build.win.extraResources`). macOS builds must not carry the
  Windows PE binary, otherwise `codesign --deep` can fail.
- The sidecar is spawned with the bundled `resources/vc-runtime` on `PATH`, the
  same as the backend, so a clean Windows machine does not need a system-wide
  VC++ runtime.
- `scripts/after-pack-handler.js` fixes executable permissions before macOS
  signing (Windows does not need chmod).
- `scripts/verify-asar-layout.js` checks the packaged Windows binary and runs
  `--version`.
- The sidecar is version-locked to the app. It is never downloaded at runtime.

## Roadmap

- macOS AX backend, TCC permission attribution and notarization
- Drag and application launch
- Screenshot retention controls
- Optional Set-of-Marks overlay and OCR

These are deliberately outside the first Windows release.
