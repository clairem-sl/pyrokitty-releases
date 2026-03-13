# Build System Architecture

## Overview

The Firestorm build uses `autobuild` which wraps CMake and platform-specific build tools (MSBuild on Windows, make/ninja on Linux/macOS).

## Key Files

- `firestorm/scripts/configure_firestorm.sh` - Main build orchestration script
- `firestorm/indra/cmake/00-Common.cmake` - Common compiler flags
- `firestorm/indra/cmake/Variables.cmake` - Build variables
- `firestorm/indra/newview/CMakeLists.txt` - Main viewer CMake config
- `firestorm/indra/newview/viewer_manifest.py` - Packaging and installer creation
- `firestorm/indra/newview/fs_viewer_manifest.py` - Firestorm-specific packaging

## Build Commands

### Configure
```bash
autobuild configure -A 64 -c ReleaseFS_open -- --chan <channel> --avx2 --fmodstudio --package -DLL_TESTS:BOOL=FALSE
```

### Build
```bash
autobuild build -A 64 -c ReleaseFS_open --no-configure -- --chan <channel> --avx2 --fmodstudio --package -DLL_TESTS:BOOL=FALSE
```

### Build with Captured Output
Autobuild spawns a subprocess that bypasses stdout capture. Use source instead:
```bash
cd firestorm/build-vc170-64 && bash -c 'source ../scripts/configure_firestorm.sh --build --jobs 1 --platform windows --avx2 --fmodstudio --package'
```

## Parallelism Control

### Windows (MSBuild + cl.exe)

Two levels of parallelism:
1. **MSBuild project parallelism**: `-m:N` flag (controlled by `--jobs N`)
2. **Compiler parallelism**: `/MP` flag in `firestorm/indra/cmake/00-Common.cmake`

To limit to 8 total cl.exe processes:
- Set `/MP8` in 00-Common.cmake (8 threads per project)
- Use `--jobs 1` (1 project at a time)
- Total: 1 × 8 = 8 cl.exe processes

### Linux/macOS
- `--jobs N` directly controls make/ninja parallelism

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `SKIP_NSIS` | Skip Windows installer creation |
| `SKIP_SYMBOLS` | Skip PDB symbols archive creation |

## Packaging (viewer_manifest.py)

### Windows Package Flow
1. `fs_sign_win_binaries()` - Sign compiled binaries
2. `fs_save_windows_symbols()` - Create PDB symbols archive
3. NSIS installer creation (unless SKIP_NSIS)
4. `fs_sign_win_installer()` - Sign the installer

### NSIS Detection
Searches for `makensis.exe` in:
- `${programfiles}\NSIS\makensis.exe`
- `${programfiles}\NSIS\Unicode\makensis.exe`
- `${programfiles(x86)}\NSIS\makensis.exe`
- `${programfiles(x86)}\NSIS\Unicode\makensis.exe`

### Output Files
- Installer: `Phoenix-FirestormOS-<channel>_AVX2-<version>_Setup.exe`
- Symbols: `Phoenix_<channel>_<version>_oss_pdbsymbols-windows-64.tar.xz`

## App Name and Channel

### APP_NAME
Defined in `firestorm/indra/llcommon/indra_constants.h`:
```cpp
const std::string APP_NAME = "Firestorm";
```

Used for:
- User settings path: `%APPDATA%\Firestorm_x64\`
- Window titles
- Various UI strings

### VIEWER_CHANNEL
Constructed in `firestorm/scripts/configure_firestorm.sh`:
```bash
CHANNEL="Firestorm-$CHANNEL"
```

Passed to CMake via `-DVIEWER_CHANNEL:STRING=$CHANNEL`

## Build Output Locations

- Build directory: `firestorm/build-vc170-64/`
- Executable: `firestorm/build-vc170-64/newview/Release/firestorm-bin.exe`
- Build logs: `firestorm/build-vc170-64/logs/FirestormBuild_win-64.log`
- Build errors: `firestorm/build-vc170-64/logs/FirestormBuild_win-64.err`
