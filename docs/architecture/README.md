# Phoenix Firestorm Viewer Architecture

This documentation covers the internal architecture of the Phoenix Firestorm viewer, based on code exploration and modifications.

## Documentation Index

- [Build System](build-system.md) - Configure, build, and package the viewer
- [Permissions System](permissions-system.md) - Object permissions and god mode
- [Login System](login-system.md) - Authentication and version checking
- [Export System](export-system.md) - Collada and backup export functionality
- [Texture System](texture-system.md) - Texture picker, face panels, and GL memory
- [GPU Texture Cache](gpu-texture-cache.md) - DXT5 compressed texture caching for fast loading
- [User Data Storage](user-data-storage.md) - Credentials and protected data
- [Mesh Repository](mesh-repository.md) - Mesh loading and teleport handling
- [Shadow System](shadow-system.md) - Shadow rendering, settings, and performance
- [GPU Frustum Culling](gpu-frustum-cull-batched.md) - Persistent buffer GPU culling with compute shaders
- [CPU/GPU Bottlenecks](cpu-gpu-bottlenecks.md) - Performance analysis and bottleneck identification
- [Performance TODO](performance-todo.md) - Performance optimization roadmap and implemented features
