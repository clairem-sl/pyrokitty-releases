# Phoenix Firestorm Viewer Architecture

This documentation covers the internal architecture of the Phoenix Firestorm viewer, based on code exploration and modifications.

## Documentation Index

### Viewer Systems
- [Build System](build-system.md) - Configure, build, and package the viewer
- [Permissions System](permissions-system.md) - Object permissions and god mode
- [Login System](login-system.md) - Authentication and version checking
- [Export System](export-system.md) - Collada and backup export functionality
- [User Data Storage](user-data-storage.md) - Credentials and protected data
- ~~Mesh Repository~~ *(doc not yet written)* - Mesh loading and teleport handling

### Rendering & Performance
- [Texture System](texture-system.md) - Texture picker, face panels, and GL memory
- [GPU Texture Cache](gpu-texture-cache.md) - DXT5 compressed texture caching for fast loading
- [Shadow System](shadow-system.md) - Shadow rendering, settings, and performance
- [Performance TODO](performance-todo.md) - Performance optimization roadmap, implemented features, and CPU/GPU bottleneck analysis

### PyroKitty
- [Changes Summary](../PYROKITTY-CHANGES.md) - All PyroKitty branch modifications
