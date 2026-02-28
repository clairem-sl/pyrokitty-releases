## Godot

Path: `godot-viewer/Godot_v4.6.1-stable_mono_win64/Godot_v4.6.1-stable_mono_win64.exe`

Run tests (headless, no window):

```bash
cd godot-viewer && ./Godot_v4.6.1-stable_mono_win64/Godot_v4.6.1-stable_mono_win64_console.exe --headless --quit-after 5 --scene tests/test_prim_mesh.tscn
```

## Building (Windows)

Configure (with debug symbols for crash analysis)
`SKIP_NSIS=1 autobuild configure -A 64 -c ReleaseFS_open -- --chan PyroKitty --avx2 --jobs 1 --fmodstudio --package -DLL_TESTS:BOOL=FALSE -DSKIP_DEBUG_SYMBOLS:BOOL=FALSE`

Build
`SKIP_NSIS=1 SKIP_SYMBOLS=1 autobuild build -A 64 -c ReleaseFS_open --no-configure -- --chan PyroKitty --avx2 --jobs 1 --fmodstudio --package -DLL_TESTS:BOOL=FALSE`

Build with captured output (autobuild spawns a subprocess that bypasses stdout capture - use source instead)

```
cd build-vc170-64 && SKIP_NSIS=1 SKIP_SYMBOLS=1 bash -c 'source ../scripts/configure_firestorm.sh --build --jobs 1 --platform windows --avx2 --fmodstudio --package'
```

Build errors are also written to: `build-vc170-64/logs/FirestormBuild_win-64.err`

PDB output: `build-vc170-64/newview/Release/firestorm-bin.pdb`
WER crash dumps: `C:\Users\callcolor\AppData\Local\CrashDumps\`

## Building (Linux via Podman)

Uses `Containerfile.linux-build` + `scripts/build-linux-podman.sh`. Runs inside an Ubuntu 22.04 container; no Linux machine needed.

**One-time setup:**

```bash
# Ensure podman machine is running
podman machine start

# Build the container image (once, or after Containerfile changes)
scripts/build-linux-podman.sh --build-image
```

**Build:**

```bash
scripts/build-linux-podman.sh            # configure + build (first time)
scripts/build-linux-podman.sh build      # incremental build only (subsequent)
scripts/build-linux-podman.sh configure  # re-configure only
```

Output: `dist/linux/Phoenix-FirestormOS-PyroKitty_AVX2-*.tar.xz`

**Key details:**

- Build dir lives in Podman named volume `pyrokitty-linux-build-cache` (native Linux ext4, not NTFS) — required to avoid autobuild package conflict bugs on NTFS mounts
- Package cache in `pyrokitty-autobuild-cache` — packages don't re-download on incremental builds
- Config: `ReleaseFS_open` (no KDU/FMOD), AVX2, 8 jobs
- WSL2 memory set to 24GB via `~/.wslconfig`
- `fs-build-variables` repo expected at `../fs-build-variables`

## Start

Start the viewer `./build-vc170-64/newview/Release/firestorm-bin.exe`
Note: LEAP support was re-enabled in `llappviewer.cpp` (search for `<FS:Pyrokitty>`). The original Firestorm code had it commented out.

## Compile node-metaverse

```bash
cd ./electron-ui/node-metaverse && npm run build
```

## External Login Mode

Launch viewer in external login mode (waits for session handoff via WebSocket):

```bash
./build-vc170-64/newview/Release/firestorm-bin.exe --external-login --set PKWebSocketPort 9001
```

Test the handoff with node_metaverse:

```bash
cd electron-ui && npx tsx scripts/test-viewer-handoff.ts
```

**Status:** Working. 3D world renders, avatar appearance loads, inventory fetches via background fetch. See `docs/PYROKITTY-CHANGES.md` section 7.

## Inventory Maintenance

Fix duplicate system folders (common in old/merged accounts):

```bash
cd electron-ui && npx tsx scripts/fix-inventory-duplicates.ts --dry-run  # Check first
cd electron-ui && npx tsx scripts/fix-inventory-duplicates.ts            # Actually fix
```

## Test Accounts

See `electron-ui/data/accounts.json` for login credentials (BonnieBelle81, BonnieBelle82, ostiabs).

## Architecture Docs

See `docs/architecture/` for system documentation and performance optimizations.

## Logs

- **Viewer**: `C:\Users\callcolor\AppData\Roaming\PyroKitty_x64\logs\PyroKitty.log`
- **Electron main process + voice sidecar**: `C:\Users\callcolor\AppData\Roaming\pyrokitty-ui\pyrokitty.log` (tee'd from console.log/warn/error; voice lines prefixed `[VoiceSidecar]`)

## Voice Sidecar

Build: `cd electron-ui/voice && dotnet build`

The voice sidecar (`electron-ui/voice/`) is a C# .NET 8 process using SIPSorcery + Concentus Opus for WebRTC voice. See `docs/architecture/voice-system.md` for architecture details.

## OpenSimulator Reference

Server source at `..\opensim` — useful for understanding server-side handling of agent control flags, physics, and protocol behavior.

## OpenJPEG WASM (J2K decoder)

Fork: `..\pyrokitty-openjpeg` → `https://github.com/pyrokitty64/openjpeg`

Rebuild WASM (requires podman, uses Emscripten container):

```bash
cd C:/DeeDrive/dev/pyrokitty-openjpeg
rm -rf build
MSYS_NO_PATHCONV=1 podman run --rm -v "$(cygpath -w $(pwd)):/openjpegjs" -w /openjpegjs openjpegjsbuild bash -c "scripts/wasm-build.sh"
```

Then rebuild the npm package and reinstall:

```bash
cd C:/DeeDrive/dev/pyrokitty-openjpeg/packages/2.5.4-decoder && npm run build
cd C:/DeeDrive/dev/phoenix-firestorm/electron-ui && npm install @abasb75/jpeg2000-decoder
```

**Gotchas:**

- WASM uses Emscripten's custom `binaryDecode` string encoding (NOT base64). Bundlers (esbuild, tsup) mangle it if they inline the file. The tsup config marks `openjpegjs.js` as external and copies it raw to `dist/`.
- `scripts/wasm-build.sh` line endings must be LF (not CRLF) or the container will fail with "bad interpreter". Fix with `sed -i 's/\r$//' scripts/wasm-build.sh`.
- The Dockerfile's `emscripten/emsdk:latest` base image already has user `emscripten` (UID 1000). Don't try to create another UID 1000.
- SIMD enabled via `-msimd128` on C and CXX flags. Produces ~1200 SIMD instructions in the wavelet/entropy loops.
