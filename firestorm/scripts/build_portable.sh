#!/bin/bash
# Build PyroKitty Portable (.7z archive)
# Creates a compressed archive of the Release folder

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$ROOT_DIR/build-vc170-64/newview/Release"
OUTPUT_DIR="$ROOT_DIR/build-vc170-64/PyroKittyPortable"
VERSION_TAG="${PYROKITTY_VERSION:-}"
if [ -n "$VERSION_TAG" ]; then
    OUTPUT_FILE="$OUTPUT_DIR/PyroKitty-Viewer-${VERSION_TAG}.7z"
else
    OUTPUT_FILE="$OUTPUT_DIR/PyroKitty-Viewer.7z"
fi

# Create output directory
mkdir -p "$OUTPUT_DIR"

echo "================================================"
echo "Building PyroKitty Portable (.7z)"
echo "================================================"

# Check if Release folder exists
if [ ! -f "$BUILD_DIR/firestorm-bin.exe" ]; then
    echo "ERROR: Release build not found at $BUILD_DIR"
    exit 1
fi

# Clean up debug/build artifacts that shouldn't be in release
echo "Cleaning up debug artifacts..."
rm -f "$BUILD_DIR"/*.pdb
rm -f "$BUILD_DIR"/*.map
rm -f "$BUILD_DIR"/*.nsi
rm -f "$BUILD_DIR"/*.exp
rm -f "$BUILD_DIR"/*.lib

# Find 7z
SEVENZIP=""
if command -v 7z &> /dev/null; then
    SEVENZIP="7z"
elif command -v 7za &> /dev/null; then
    SEVENZIP="7za"
elif [ -f "/c/Program Files/7-Zip/7z.exe" ]; then
    SEVENZIP="/c/Program Files/7-Zip/7z.exe"
elif [ -f "/c/Program Files (x86)/7-Zip/7z.exe" ]; then
    SEVENZIP="/c/Program Files (x86)/7-Zip/7z.exe"
fi

if [ -z "$SEVENZIP" ]; then
    echo "ERROR: 7-Zip not found. Install from https://7-zip.org/"
    exit 1
fi

# Delete old archive if exists
rm -f "$OUTPUT_FILE"

echo ""
echo "Creating archive..."

# Convert paths for Windows 7z
OUTPUT_FILE_WIN="$OUTPUT_FILE"
BUILD_DIR_WIN="$BUILD_DIR"
if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
    OUTPUT_FILE_WIN=$(cygpath -w "$OUTPUT_FILE")
    BUILD_DIR_WIN=$(cygpath -w "$BUILD_DIR")
fi

# Create .7z with good compression, multi-threaded
"$SEVENZIP" a -t7z -mx=5 -mmt=on "$OUTPUT_FILE_WIN" "$BUILD_DIR_WIN/*"

if [ -f "$OUTPUT_FILE" ]; then
    FILE_SIZE=$(stat -c%s "$OUTPUT_FILE" 2>/dev/null || stat -f%z "$OUTPUT_FILE" 2>/dev/null || echo "0")
    FILE_SIZE_MB=$((FILE_SIZE / 1024 / 1024))
    echo ""
    echo "================================================"
    echo "SUCCESS: Created $OUTPUT_FILE"
    echo "Size: ${FILE_SIZE_MB} MB"
    echo "================================================"
else
    echo "ERROR: Failed to create archive"
    exit 1
fi
