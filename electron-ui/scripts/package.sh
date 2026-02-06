#!/bin/bash
# Package PyroKitty for distribution
# Run from electron-ui directory

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ELECTRON_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(dirname "$ELECTRON_DIR")"

# Viewer build output location
VIEWER_BUILD="$ROOT_DIR/build-vc170-64/newview/Release"

# Staging directory for viewer files
VIEWER_STAGING="$ELECTRON_DIR/viewer"

# Parse arguments
SKIP_VIEWER_BUILD=false
SKIP_CONFIGURE=false
FORCE_REBUILD=false

show_help() {
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  --skip-viewer     Skip building Firestorm (use existing build)"
    echo "  --skip-configure  Skip autobuild configure step (just build)"
    echo "  --force           Force rebuild even if files are up to date"
    echo "  --help            Show this help"
    echo ""
    echo "Examples:"
    echo "  $0                    Full build (configure + build viewer + package)"
    echo "  $0 --skip-configure   Rebuild viewer without reconfiguring"
    echo "  $0 --skip-viewer      Just package (viewer already built)"
}

for arg in "$@"; do
    case $arg in
        --skip-viewer)
            SKIP_VIEWER_BUILD=true
            ;;
        --skip-configure)
            SKIP_CONFIGURE=true
            ;;
        --force)
            FORCE_REBUILD=true
            ;;
        --help|-h)
            show_help
            exit 0
            ;;
    esac
done

# Helper: check if any source files are newer than target
needs_rebuild() {
    local src_dir="$1"
    local target="$2"
    local pattern="${3:-*}"

    if [ "$FORCE_REBUILD" = true ]; then
        return 0  # Force rebuild
    fi

    if [ ! -e "$target" ]; then
        return 0  # Target doesn't exist, needs build
    fi

    # Check if any source files are newer than target
    if [ -n "$(find "$src_dir" -type f -name "$pattern" -newer "$target" 2>/dev/null | head -1)" ]; then
        return 0  # Source files are newer
    fi

    return 1  # Up to date
}

echo "=== PyroKitty Packaging Script ==="
echo ""

# Step 0: Build Firestorm viewer (unless skipped)
if [ "$SKIP_VIEWER_BUILD" = false ]; then
    echo "Step 0: Building Firestorm viewer..."
    cd "$ROOT_DIR"

    if [ "$SKIP_CONFIGURE" = false ]; then
        echo "  Configuring..."
        SKIP_NSIS=1 SKIP_SYMBOLS=1 autobuild configure -A 64 -c ReleaseFS_open -- \
            --chan PyroKitty --avx2 --fmodstudio --package \
            -DLL_TESTS:BOOL=FALSE
    fi

    echo "  Building (this may take a while)..."
    cd "$ROOT_DIR/build-vc170-64"
    SKIP_NSIS=1 SKIP_SYMBOLS=1 bash -c 'source ../scripts/configure_firestorm.sh --build --platform windows --avx2 --fmodstudio --package'

    echo "  Viewer build complete."
    echo ""
fi

# Check if viewer build exists
if [ ! -f "$VIEWER_BUILD/firestorm-bin.exe" ]; then
    echo "ERROR: Viewer build not found at $VIEWER_BUILD"
    echo "Run without --skip-viewer to build, or build manually first."
    exit 1
fi

# Step 1: Build Electron app
echo "Step 1: Building Electron app..."
cd "$ELECTRON_DIR"

# 1a: Build node-metaverse (only if source changed)
if needs_rebuild "node-metaverse/lib" "node-metaverse/dist" "*.ts"; then
    echo "  Building node-metaverse..."
    npm run build:metaverse
else
    echo "  node-metaverse up to date, skipping..."
fi

# 1b: Build main process (only if source changed)
if needs_rebuild "src/main" "dist/main" "*.ts"; then
    echo "  Building main process..."
    npm run build:main
else
    echo "  Main process up to date, skipping..."
fi

# 1c: Build renderer (only if source changed)
if needs_rebuild "src/renderer" "dist/renderer" "*.ts*"; then
    echo "  Building renderer..."
    npm run build:renderer
else
    echo "  Renderer up to date, skipping..."
fi

# Step 2: Copy viewer to staging
echo ""
echo "Step 2: Copying viewer to staging area..."

# Check if viewer staging needs update
NEEDS_STAGING=false
if [ "$FORCE_REBUILD" = true ]; then
    NEEDS_STAGING=true
elif [ ! -f "$VIEWER_STAGING/firestorm-bin.exe" ]; then
    NEEDS_STAGING=true
elif [ "$VIEWER_BUILD/firestorm-bin.exe" -nt "$VIEWER_STAGING/firestorm-bin.exe" ]; then
    NEEDS_STAGING=true
fi

if [ "$NEEDS_STAGING" = true ]; then
    rm -rf "$VIEWER_STAGING"
    mkdir -p "$VIEWER_STAGING"

    # Copy viewer executable and required files
    echo "  Copying executables and DLLs..."
    cp "$VIEWER_BUILD"/*.exe "$VIEWER_STAGING/"
    cp "$VIEWER_BUILD"/*.dll "$VIEWER_STAGING/" 2>/dev/null || true

    # Copy required directories
    for dir in app_settings character fonts skins llplugin; do
        if [ -d "$VIEWER_BUILD/$dir" ]; then
            echo "  Copying $dir/..."
            cp -r "$VIEWER_BUILD/$dir" "$VIEWER_STAGING/"
        fi
    done

    # Copy other required files
    for file in featuretable.txt gpu_table.txt; do
        if [ -f "$VIEWER_BUILD/$file" ]; then
            cp "$VIEWER_BUILD/$file" "$VIEWER_STAGING/"
        fi
    done

    echo "  Viewer staging complete: $(du -sh "$VIEWER_STAGING" | cut -f1)"
else
    echo "  Viewer staging up to date, skipping..."
fi

# Step 3: Package with electron-builder
echo ""
echo "Step 3: Packaging with electron-builder..."
npm run dist

echo ""
echo "=== Packaging Complete ==="
echo "Output: $ELECTRON_DIR/release/"
ls -la "$ELECTRON_DIR/release/"
