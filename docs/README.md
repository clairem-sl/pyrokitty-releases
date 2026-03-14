# PyroKitty Documentation

## Godot Viewer

- [Avatar Rendering](avatar-rendering.md) - Skeleton architecture, animations, shape deformation, coordinate systems, known issues
- [Velocity Interpolation](VELOCITY_INTERPOLATION.md) - Avatar/object movement smoothing
- [VR Motion Tracking](VR_MOTION_TRACKING.md) - VR headset and controller input
- [Water Rendering](water-rendering.md) - Water plane rendering in Godot

## Electron / Node

- [Inventory Sync](INVENTORY_SYNC.md) - Inventory tree sync between SL and local state

## Architecture (Firestorm Viewer Internals)

Reference docs from exploring the C++ Firestorm viewer codebase.

- [Build System](architecture/build-system.md) - Configure, build, and package
- [Login System](architecture/login-system.md) - Authentication and version checking
- [Capabilities](architecture/capabilities.md) - SL capability URLs
- [Child Agents](architecture/child-agents.md) - Neighbor region agent management
- [Permissions](architecture/permissions-system.md) - Object permissions and god mode
- [Export System](architecture/export-system.md) - Collada and backup export
- [User Data Storage](architecture/user-data-storage.md) - Credentials and protected data
- [Texture Pipeline](architecture/texture-pipeline.md) - Texture fetch, decode, upload
- [Texture System](architecture/texture-system.md) - Texture picker, face panels, GL memory
- [GPU Texture Cache](architecture/gpu-texture-cache.md) - DXT5 compressed texture caching
- [Shadow System](architecture/shadow-system.md) - Shadow rendering and performance
- [Prim Mesh UV](architecture/prim-mesh-uv.md) - Prim face UV mapping
- [PrimMesher Reference](architecture/primmesher-reference.md) - Prim → mesh generation
- [Puppetry System](architecture/puppetry-system.md) - Animation puppetry protocol
- [Voice System](architecture/voice-system.md) - WebRTC voice architecture
- [Performance TODO](architecture/performance-todo.md) - Optimization roadmap

## Firestorm Plugin Experiments

- [Plugin Architecture](firestorm_experiments/ARCHITECTURE.md)
- [Chat System](firestorm_experiments/CHAT-SYSTEM.md)
- [LEAP Extension](firestorm_experiments/LEAP-EXTENSION.md)
- [Plugin Plan](firestorm_experiments/PLAN.md)
- [PyroKitty Changes](firestorm_experiments/PYROKITTY-CHANGES.md) - Firestorm C++ modifications
- [Object Flip](firestorm_experiments/OBJECT_FLIP.md) - Object rotation experiments

## Reference

- [SL WebRTC Voice Dev Notes](sl-webrtc-dev.txt) ([PDF](sl-webrtc-dev.pdf))
