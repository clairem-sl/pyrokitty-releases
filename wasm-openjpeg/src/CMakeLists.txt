  add_executable(openjpegjs jslib.cpp)

  target_link_libraries(openjpegjs PRIVATE openjp2)
  
  target_compile_features(openjpegjs PUBLIC cxx_std_11)
  
  if (CMAKE_BUILD_TYPE STREQUAL Debug)
    SET(linkFlags "-g4")
  else() # Either MinSizeRel, RelWithDebInfo or Release, all which run with optimizations enabled.
    SET(linkFlags "-O3")
  endif()
  
  # add include path to openjpeg
  include_directories("../openjpeg/src/lib/openjp2" "../build/openjpeg/src/lib/openjp2")
  
  set_target_properties(
    openjpegjs 
      PROPERTIES 
      LINK_FLAGS "\
        --bind \
        --allowJs \
        -s DISABLE_EXCEPTION_CATCHING=0 \
        -s ASSERTIONS=0 \
        -s NO_EXIT_RUNTIME=1 \
        -s MALLOC=emmalloc \
        -s ALLOW_MEMORY_GROWTH=1 \
        -s TOTAL_MEMORY=16mb \
        -s FILESYSTEM=0 \
        -s EXPORTED_FUNCTIONS=[] \
        -s EXPORTED_RUNTIME_METHODS=[ccall] \
        -s MODULARIZE=1 \
        -s EXPORT_NAME=OpenJPEGWASM \
        -s SINGLE_FILE=1 \
    ")
  