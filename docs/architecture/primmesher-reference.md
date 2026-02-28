# PrimMesher Reference — Deep Dive for Godot Port

## Source Files

| File | Lines | Purpose |
|------|-------|---------|
| `libremetaverse/PrimMesher/PrimMesher.cs` | 2305 | Core: data types, Profile, Path, PrimMesh extrusion |
| `libremetaverse/PrimMesher/VertexIndexer.cs` | 149 | Post-process: per-face vertex dedup + index buffer |
| `libremetaverse/PrimMesher/SculptMesh.cs` | 641 | Sculpt texture → mesh (not needed for prims) |
| `libremetaverse/LibreMetaverse.Rendering.Meshmerizer/MeshmerizerR.cs` | 918 | Integration: SL prim params → PrimMesh → FacetedMesh |
| `godot-viewer/src/prim_mesh_generator.gd` | 877 | Our GDScript port (based on LLVolume, not PrimMesher) |

---

## 1. Data Types

### Coord (line 120)
3D point/vector. `X, Y, Z` floats. Key ops:
- `Invert()` — negate all components
- `Cross(c1, c2)` — static cross product
- `operator*(Coord, Quat)` — quaternion rotation

### Quat (line 37)
Quaternion. Constructed from axis-angle: `Quat(Coord axis, float angle)`.
Multiplication is Hamilton product. Used to orient profile at each path step.

### UVCoord (line 230)
`U, V` float pair. `Flip()` does `U=1-U, V=1-V`.

### Face (line 250)
Triangle indices: `v1,v2,v3` (position), `n1,n2,n3` (normal), `uv1,uv2,uv3` (UV).
`primFace` — which SL texture face this triangle belongs to.

### ViewerFace (line 319)
Expanded triangle with actual coords (not indices). Used in viewer mode.
- `v1,v2,v3` — Coord positions
- `n1,n2,n3` — Coord normals
- `uv1,uv2,uv3` — UVCoord tex coords
- `coordIndex1,2,3` — indices into master coords list (for VertexIndexer dedup)
- `primFaceNumber` — SL texture face number

### PathNode (line 1271)
One step along the extrusion path:
- `position` — Coord offset
- `rotation` — Quat orientation
- `xScale, yScale` — profile scale at this step (taper)
- `percentOfPath` — 0..1

### Angle (line 408)
Internal: `angle` (0..1 fraction), `X, Y` (unit circle/polygon position).

---

## 2. Pipeline Overview

```
SL Prim Parameters
        │
        ▼
MeshmerizerR.GeneratePrimMesh()    ← maps SL params to PrimMesh params
        │
        ▼
PrimMesh(sides, profileStart, profileEnd, hollow, hollowSides)
        │
        ▼
Extrude(PathType.Linear | PathType.Circular)
    ├── Profile(sides, ...)        ← 2D cross-section polygon
    ├── Path.Create(pathType)      ← 3D sweep path (PathNodes)
    └── Sweep loop                 ← transform profile at each node, build triangles
        │
        ▼
VertexIndexer(primMesh)            ← per-face dedup, creates ViewerVertex/ViewerPolygon
        │
        ▼
FacetedMesh.Faces[i]              ← each SL texture face as separate mesh
```

---

## 3. Profile Generation (lines 642-1269)

The Profile generates the 2D cross-section that will be swept along the path.

### Coordinate System
Profile points lie in the **XY plane** (Z=0), centered at origin.

### Scale Factors (lines 722-727)
- `sides == 4` (box): `xScale = yScale = 0.707107` (corners of unit square inscribed in circle)
- Default: `xScale = yScale = 0.5`

This matches our GDScript `TABLE_SCALE`:
```gdscript
const TABLE_SCALE := [1.0, 1.0, 1.0, 0.5, 0.707107, 0.53, 0.525, 0.5]
```

### AngleList (lines 422-639)
Generates angle positions around the polygon:
- **3, 4, or 24 sides**: uses precomputed lookup tables (`angles3`, `angles4`, `angles24`)
- **Other counts**: `cos(angle)`, `sin(angle)` at `stepSize = 2*PI/sides`
- Profile cuts: start/end vertices are interpolated

**Precomputed angles4** (line 444):
```
angle=0.00  X=+1.0  Y= 0.0   (right)
angle=0.25  X= 0.0  Y=+1.0   (top)
angle=0.50  X=-1.0  Y= 0.0   (left)
angle=0.75  X= 0.0  Y=-1.0   (bottom)
angle=1.00  X=+1.0  Y= 0.0   (back to right)
```

**Precomputed normals4** (line 453):
```
(+0.5, +0.5, 0).normalize()  →  (+0.707, +0.707, 0)  face between angle 0-1
(-0.5, +0.5, 0).normalize()  →  (-0.707, +0.707, 0)  face between angle 1-2
(-0.5, -0.5, 0).normalize()  →  (-0.707, -0.707, 0)  face between angle 2-3
(+0.5, -0.5, 0).normalize()  →  (+0.707, -0.707, 0)  face between angle 3-4
```

### Outer Vertices (lines 819-873)
```csharp
newVert.X = angle.X * xScale;
newVert.Y = angle.Y * yScale;
newVert.Z = 0;
```
- `us` list stores texture U coords: `angle.angle` (0..1 fraction around profile)
- Circle normals: `(angle.X, angle.Y, 0)` — radial outward
- Polygon normals (sides<5): from precomputed arrays

### Hollow (lines 843-979)
If hollow > 0:
- Same shape scaled down if `hollowSides == sides`
- Different shape if not (e.g., circular hollow in box)
- **Inner coords are REVERSED** (line 877) for opposite winding
- Triangulation between outer/inner rings uses a marching algorithm for unequal vertex counts
- Inner normals point inward: `(-angle.X, -angle.Y, 0)`

### Simple Faces (no hollow, no cut, sides < 5)
- Triangle (3): `Face(0, 1, 2)`
- Box (4): `Face(0, 1, 2)` and `Face(0, 2, 3)`

### Cap UVs — MakeFaceUVs (line 1074)
```csharp
faceUVs[i] = new UVCoord(1.0f - (0.5f + c.X), 1.0f - (0.5f - c.Y))
```
Maps profile position `(-0.5..0.5)` to UV `(0..1)`.

### Face Number Assignment (lines 1033-1071)

**Order: top → outer sides → hollow → bottom → cut1 → cut2**

```csharp
faceNum = 1;  // start with outer faces
outerFaceNumber = faceNum;

// Outer verts: for sides<5, each edge gets its own faceNum++
// For sides>=5 (circles), all share one faceNum
for (i = 0; i < numOuterVerts - 1; i++)
    faceNumbers.Add(sides < 5 && i <= sides ? faceNum++ : faceNum);

// Hollow verts: all get same faceNum
if (hasHollow)
    hollowFaceNumber = faceNum++;

bottomFaceNumber = faceNum++;

// Profile cut faces get remaining numbers (from -1 placeholders)
```

**Important**: The face numbering starts at 1 (for outer), not 0. Face 0 is "top cap" but it's assigned implicitly during extrusion — it's the `primFace` of the profile.faces triangles.

---

## 4. Path Generation (lines 1287-1497)

### Linear Path (lines 1320-1386)
Used for box, cylinder, prism.

- **Z range**: `pathCutBegin - 0.5` to `pathCutEnd - 0.5` (full prim: -0.5 to +0.5)
- **Steps**: `1 + twistTotalAbs * 3.66` (Dahlia's magic number)
- **Taper**: `xScale = 1 - percentOfPath * taperX` (positive taper), or `xScale = 1 + (1-percentOfPath) * taperX` (negative taper)
- **Shear**: linear increase: `xOffset += topShearX * stepIncrement`
- **Twist**: Z-axis quaternion: `twistBegin + twistTotal * percentOfPath`
- **Position**: `(xOffset, yOffset, zOffset)` where `zOffset = start + percentOfPath`

### Circular Path (lines 1388-1495)
Used for torus, tube, ring.

- **Profile scale**: `xProfileScale = (1 - |skew|) * holeSizeX`, `yProfileScale = holeSizeY`
- **Radius**: `yPathScale = holeSizeY * 0.5`, affected by `radius` and skew
- **Position**: trig-based (cos/sin of angle * radius), plus shear offsets
- **Rotation**: `Quat(xAxis, angle) * Quat(zAxis, twist)` — orients profile around the torus ring, plus twist
- **Angle range**: `2*PI * pathCutBegin * revolutions` to `2*PI * pathCutEnd * revolutions`

---

## 5. Extrusion — The Sweep (lines 1649-2056)

### Initial Profile Rotation (lines 1697-1759)

| Path Type | Sides | initialProfileRot | Notes |
|-----------|-------|--------------------|-------|
| Circular  | 3     | PI                 | + hollow adjustments |
| Circular  | 4     | PI/4 (0.785)       | |
| Circular  | >4    | PI                 | |
| Linear    | 3     | 0                  | |
| Linear    | 4     | 1.25*PI (3.927)    | Aligns box sides with axes |
| Linear    | 24    | 0                  | |

**Our GDScript equivalent**: `_gen_ngon(result, 4, -0.375, ...)` — the offset of `-0.375` produces the same rotation as `1.25*PI` for the linear box case (since `-0.375 * 2*PI = -2.356 ≈ -(3/4)*PI`, which combined with the box vertices at 0°/90°/180°/270° gives the same alignment).

### Hollow Adjustments During Extrusion
```
Circular path:
  tri+square_hollow: hollow = min(0.7, hollow) * 0.707
  tri+other_hollow:  hollow *= 0.5
  box+non_box_hollow: hollow *= 0.707
  circle+square_hollow: hollow = min(0.7, hollow) / 0.7

Linear path:
  tri+square_hollow: hollow = min(0.7, hollow) * 0.707
  tri+other_hollow: hollow *= 0.5
  box+non_box_hollow: hollow *= 0.707
  cylinder+square_hollow: hollow *= 1.414
```

### needEndFaces (lines 1677-1694)
- **Linear**: always true
- **Circular**: only if path cut, taper, skew, twist, or radius offset. Perfect closed torus = no end faces.

When `!needEndFaces`, all face numbers are decremented by 1 (top and bottom caps don't exist).

### Sweep Loop (lines 1826-2055)
For each PathNode:

1. **Transform profile**: Scale by `node.xScale, node.yScale`, rotate by `node.rotation`, translate by `node.position`
2. **Append coords** to global list
3. **End faces (caps)**: At first/last node, profile face triangles are added with index offsets
4. **Side faces**: Between consecutive layers, quads (2 triangles each):
   ```
   Face1: v1=i, v2=i-numVerts, v3=iNext
   Face2: v1=iNext, v2=i-numVerts, v3=iNext-numVerts
   ```

### Side UV Generation (lines 1920-1950)

**U coordinate**:
```csharp
u1 = profile.us[uIndex];
u2 = profile.us[uIndex + 1];

// Cut faces: force to 0..1
if (whichVert == cut1Vert || whichVert == cut2Vert) { u1 = 0; u2 = 1; }

// Flat polygon faces (sides < 5): scale and subtract integer part
// This gives 0..1 per polygon edge (matching our begin_stex fix)
else if (sides < 5 && whichVert < numOuterVerts) {
    u1 *= sides; u2 *= sides;
    u2 -= (int)u1; u1 -= (int)u1;
    if (u2 < 0.1) u2 = 1;
}

// Sphere mode: remap to -1..1 range
if (sphereMode) { u1 = u1*2 - 1; u2 = u2*2 - 1; }
```

**V coordinate**:
```csharp
thisV = 1.0 - node.percentOfPath;  // 1 at bottom, 0 at top
```

### End Face UVs (lines 2015-2052)
Uses `profile.faceUVs` computed from profile XY: `U = 1-(0.5+X)`, `V = 1-(0.5-Y)`.

For **linear path**, UVs are flipped: `Flip()` → `U = 1-U, V = 1-V`.

The last node's end faces are face number 0 (top cap). The first node's end faces use the profile.faces data added earlier (with FlipNormals).

---

## 6. VertexIndexer — Post-Processing

After PrimMesh.Extrude(), the VertexIndexer groups ViewerFaces by `primFaceNumber`:

1. Find max `primFaceNumber` → `numPrimFaces`
2. For each face number, build a `List<ViewerVertex>` and `List<ViewerPolygon>`
3. **Dedup by coordIndex**: if two ViewerFaces share the same `coordIndex`, they reuse the same vertex in the per-face buffer

**MeshmerizerR usage** (line 186-218):
```csharp
var indexer = newPrim.GetVertexIndexer();
for (int i = 0; i < indexer.numPrimFaces; i++) {
    // indexer.viewerVertices[i] = vertices for this face
    // indexer.viewerPolygons[i] = triangles for this face
    vert.TexCoord = new Vector2(m.uv.U, 1.0f - m.uv.V);  // V flip!
}
```
Note the **V flip** at output: `1.0 - V`. PrimMesher generates V with 1=bottom, 0=top; the viewer expects 0=bottom, 1=top.

---

## 7. MeshmerizerR — SL Parameter Mapping

### Profile Sides (from profileCurve & 0x07)
| ProfileCurve | Sides | Notes |
|-------------|-------|-------|
| Square (default) | 4 | |
| Circle | 6/12/24 | LOD-dependent |
| EqualTriangle | 3 | |
| HalfCircle (sphere) | 6/12/24 | profileBegin = 0.5*begin + 0.5 |

### Hollow Sides (from ProfileHole)
| HoleType | Sides |
|----------|-------|
| Same | = outer sides |
| Circle | 6/12/24 (LOD) |
| Triangle | 3 |

### Path Type Decision (lines 858-873)
| PathCurve | Type | Taper | Twist |
|-----------|------|-------|-------|
| Line/Flexible | Linear | `1.0 - pathScaleX/Y` | `180° * pathTwist` |
| Circle | Circular | `pathTaperX/Y` directly | `360° * pathTwist` |

### Full Parameter Mapping
```csharp
new PrimMesh(sides, profileBegin, profileEnd, profileHollow, hollowSides) {
    viewerMode = true,
    sphereMode = (profileCurve == HalfCircle),
    holeSizeX = pathScaleX,        // circular: controls hole size
    holeSizeY = pathScaleY,
    pathCutBegin = pathBegin,
    pathCutEnd = pathEnd,
    topShearX = pathShearX,
    topShearY = pathShearY,
    radius = pathRadiusOffset,
    revolutions = pathRevolutions,
    skew = pathSkew,
    stepsPerRevolution = 6/12/24,  // LOD-dependent
    // taper/twist differ by path type (see table above)
};
```

---

## 8. Face Number Summary by Prim Type

### Box (4 sides, linear path, no hollow, no cut)
| Face# | What | Geometry |
|-------|------|----------|
| 0 | Top cap | +Z end face |
| 1 | Side 0 | outer side (right) |
| 2 | Side 1 | outer side (front) |
| 3 | Side 2 | outer side (left) |
| 4 | Side 3 | outer side (back) |
| 5 | Bottom cap | -Z end face |

### Cylinder (24 sides, linear, no hollow, no cut)
| Face# | What |
|-------|------|
| 0 | Top cap |
| 1 | Outer surface (all sides) |
| 2 | Bottom cap |

### Cylinder with hollow
| Face# | What |
|-------|------|
| 0 | Top cap |
| 1 | Outer surface |
| 2 | Hollow inner surface |
| 3 | Bottom cap |

### Torus (24 sides, circular, full revolution)
needEndFaces = false, so face numbers shifted down by 1:
| Face# | What |
|-------|------|
| 0 | Outer surface |

### Torus with path cut
needEndFaces = true:
| Face# | What |
|-------|------|
| 0 | Top end face |
| 1 | Outer surface |
| 2 | Bottom end face |
| 3 | Cut face 1 |
| 4 | Cut face 2 |

---

## 9. Coordinate System

PrimMesher uses **SL coordinates**:
- **X** = East (right)
- **Y** = North (forward)
- **Z** = Up

Profile generated in XY plane (Z=0). Linear extrusion: Z from -0.5 (bottom) to +0.5 (top).

**Godot conversion**: `_sl_to_godot(v) = Vector3(v.x, v.z, -v.y)`
- SL X → Godot X
- SL Z → Godot Y (up)
- SL Y → Godot -Z (forward)

---

## 10. Comparison: PrimMesher vs Our GDScript (LLVolume-based)

| Aspect | PrimMesher | Our prim_mesh_generator.gd |
|--------|-----------|---------------------------|
| **Origin** | OpenSim/PrimMesher lib | Ported from LLVolume (viewer) |
| **Profile gen** | AngleList + precomputed tables | `_gen_ngon` with angle stepping |
| **Profile coords** | Separate `coords` + `us` (1D S) + `faceUVs` (2D cap) | `Vector3(x, y, texcoord_as_z)` |
| **Path** | PathNode with Quat | PathPoint with Basis |
| **Face building** | Inline during sweep, ViewerFace structs | Separate `_build_side` / `_build_cap` |
| **Hollow** | Marching triangulation in Profile | `_add_hollow` appends reversed inner ring |
| **Face numbering** | Complex `faceNumbers[]` array in Profile | `ProfileFace.face_id` constants |
| **Initial rotation** | `initialProfileRot` in Extrude() | `offset` param to `_gen_ngon` |
| **Normals** | Per-vertex for curves, CalcSurfaceNormal for flat | `generate_normals()` in SurfaceTool |
| **V flip** | `1.0 - V` in MeshmerizerR output | `1.0 - tt` in `_build_side` |

### Key alignment points
- Box offset: PrimMesher `1.25*PI` ≈ our `-0.375 * 2*PI` for `_gen_ngon` offset ✓
- Side S coord: PrimMesher `u*sides - floor(u*sides)` ≈ our `begin_stex` subtraction ✓
- Cap UV: PrimMesher `U=1-(0.5+X), V=1-(0.5-Y)` ≈ our `_cap_uv_from_profile` ✓
- V flip: both apply 1-V for SL convention inversion ✓

---

## 11. Key Insights for Completing the Godot Port

### Things we're doing correctly
1. Profile generation with TABLE_SCALE matches PrimMesher's xScale/yScale
2. Side S-coord normalization per-face (begin_stex fix)
3. Cap UV formula matches PrimMesher's MakeFaceUVs + Flip logic
4. Hollow reversal for correct winding
5. Coordinate system conversion SL→Godot

### Potential gaps to investigate
1. **Sphere mode UV**: PrimMesher remaps U to `u*2-1` range and subtracts hollow for inner verts. Need to verify our sphere UV handling.
2. **Cut face normals**: PrimMesher tracks `cutNormal1`/`cutNormal2` and assigns them to cut face triangles. We rely on `generate_normals()` which may give different results for profile-cut prims.
3. **Circular path needEndFaces=false**: When a torus has no cuts/taper/twist, face numbers shift down by 1. Need to verify our face_id mapping handles this.
4. **Hollow adjustment factors**: PrimMesher modifies the hollow value during extrusion based on sides/hollowSides combination (e.g., `hollow *= 0.707`). Need to verify we apply the same adjustments.
5. **Circle profile with hollow**: For unequal vertex counts (e.g., circular profile with square hollow), PrimMesher uses a sophisticated marching algorithm. Our `_add_hollow` may not handle this correctly.
6. **End face UV flip for linear**: PrimMesher calls `Flip()` on end face UVs for linear paths only. Need to verify this matches our cap UV logic.
7. **Torus profile rotation**: PrimMesher uses different `initialProfileRot` for circular paths (PI for 3/circle, PI/4 for box). Our circular path code needs to match.

### Texture coordinate pipeline summary
```
PrimMesher output:
  Side UV: U = profile.us[i] (scaled for flat), V = 1.0 - percentOfPath
  Cap UV:  from MakeFaceUVs: U = 1-(0.5+X), V = 1-(0.5-Y), then Flip for linear

MeshmerizerR V-flip:
  Final V = 1.0 - PrimMesher_V

Our pipeline:
  Side: U = profile.z (with begin_stex), V = 1.0 - tex_t
  Cap:  from _cap_uv_from_profile (Godot convention = 1-SL_V)
  Shader: standard_uv.gdshader does 1.0-UV.y to recover SL UV before xform
```
