#!/bin/sh
#rm -rf build

mkdir -p build
mkdir -p dist
#(cd build && emconfigure cmake -DCMAKE_BUILD_TYPE=Debug ..) &&
# SIMD enabled — auto-vectorizes OpenJPEG wavelet inner loops
(cd build && emcmake cmake -DCMAKE_C_FLAGS="-msimd128" -DCMAKE_CXX_FLAGS="-msimd128" ..) &&
(cd build && emmake make VERBOSE=1 -j) &&
cp ./build/openjpeg/bin/openjpegjs.js ./dist &&
cp ./build/openjpeg/bin/interface.d.ts ./dist
