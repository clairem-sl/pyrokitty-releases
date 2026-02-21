## Building

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

## Start

Start the viewer `./build-vc170-64/newview/Release/firestorm-bin.exe`
Note: LEAP support was re-enabled in `llappviewer.cpp` (search for `<FS:Pyrokitty>`). The original Firestorm code had it commented out.

## Compile node-metaverse

```bash
cd C:/DeeDrive/dev/phoenix-firestorm/electron-ui/node-metaverse && npm run build
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
