/**
 * Handles texture and material fetching/processing for the Godot bridge.
 * Manages PBR material assets, legacy materials, and texture queue coordination.
 */

import type { Bot } from '../../node-metaverse/dist/lib';
import { Material } from '../../node-metaverse/dist/lib/classes/public/Material';
import type { MaterialFetchQueue, MaterialOverrideData, TextureTransform } from './material-fetch-queue';
import type { TextureFetchQueue } from './texture-fetch-queue';
import type { GodotAvatarManager } from './godot-avatar-manager';
import type { SendFn } from './godot-bridge-types';
import { WATER_EXCLUSION_TEXTURES, ZERO_UUID, BAKE_MAGIC_UUIDS, TRANSPARENT_TEXTURES, SOLID_COLOR_TEXTURES } from './godot-bridge-types';

export class GodotMaterialPipeline {
  private materialToFaces = new Map<string, { localId: number; faceIndex: number; face: any; inlineOverride: any }[]>();
  private legacyMaterialCache = new Map<string, {
    alphaMode: number; alphaCutoff: number;
    normMap?: string; normRepeatX?: number; normRepeatY?: number;
    normOffsetX?: number; normOffsetY?: number; normRotation?: number;
    specExp?: number; envIntensity?: number;
  }>();
  private legacyMaterialPending = new Set<string>();
  private legacyMaterialFetching = false;
  private legacyMaterialToFaces = new Map<string, { localId: number; faceIndex: number }[]>();
  private pbrFaceCount = 0;

  private materialFetchQueue: MaterialFetchQueue | null = null;
  private textureFetchQueue: TextureFetchQueue | null = null;
  private avatarManager: GodotAvatarManager | null = null;

  // Face update batching — coalesces per-object face updates into a single message per flush
  private faceUpdateBuffer = new Map<number, any[]>(); // localId → faces (latest per face index wins)
  private faceUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly FACE_UPDATE_FLUSH_MS = 50;

  constructor(
    private bot: Bot,
    private send: SendFn,
    private trackedObjects: Set<number>,
  ) {}

  initQueues(materialFetchQueue: MaterialFetchQueue, textureFetchQueue: TextureFetchQueue): void {
    this.materialFetchQueue = materialFetchQueue;
    this.textureFetchQueue = textureFetchQueue;
  }

  setAvatarManager(mgr: GodotAvatarManager): void {
    this.avatarManager = mgr;
  }

  /** Extract per-face texture info from a GameObject (up to 8 faces) */
  getTextureInfo(obj: any): {
    faces: {
      index: number; textureId: string; color: number[]; fullBright: boolean; doubleSided: boolean;
      alphaMode: number; alphaCutoff: number; mappingType?: number;
      repeatU: number; repeatV: number; offsetU: number; offsetV: number; rotation: number;
      isPBR?: boolean; normalTextureId?: string; ormTextureId?: string; emissiveTextureId?: string;
      metallicFactor?: number; roughnessFactor?: number; emissiveFactor?: number[];
      pbrBaseColor?: number[];
      _isBake?: boolean; _bakeAvatarUuid?: string; _bakeChannel?: number;
    }[];
    textureIds: string[];
  } | undefined {
    try {
      const te = obj.TextureEntry;
      if (!te || !te.defaultTexture) return undefined;

      // GLTF material overrides per face
      const gltfDS = new Map<number, boolean>();
      const gltfAlpha = new Map<number, { mode: number; cutoff: number }>();
      const gltfPBR = new Map<number, {
        baseColorTextureId?: string;
        normalTextureId?: string;
        ormTextureId?: string;
        emissiveTextureId?: string;
        baseColor?: number[];
        metallicFactor?: number;
        roughnessFactor?: number;
        emissiveFactor?: number[];
      }>();
      const overrides = te.gltfMaterialOverrides;
      if (overrides && overrides.size > 0) {
        for (const [idx, override] of overrides) {
          if (override.doubleSided !== undefined) {
            gltfDS.set(idx, override.doubleSided);
          }
          if (override.alphaMode !== undefined || override.alphaCutoff !== undefined) {
            gltfAlpha.set(idx, {
              mode: override.alphaMode ?? -1,
              cutoff: override.alphaCutoff ?? 0.5,
            });
          }
          const pbr: any = {};
          let hasPBR = false;
          if (override.textures && Array.isArray(override.textures)) {
            const texIds = override.textures;
            const t0 = texIds[0]?.toString();
            const t1 = texIds[1]?.toString();
            const t2 = texIds[2]?.toString();
            const t3 = texIds[3]?.toString();
            if (t0 && t0 !== ZERO_UUID) { pbr.baseColorTextureId = t0; hasPBR = true; }
            if (t1 && t1 !== ZERO_UUID) { pbr.normalTextureId = t1; hasPBR = true; }
            if (t2 && t2 !== ZERO_UUID) { pbr.ormTextureId = t2; hasPBR = true; }
            if (t3 && t3 !== ZERO_UUID) { pbr.emissiveTextureId = t3; hasPBR = true; }
          }
          if (override.baseColor) { pbr.baseColor = override.baseColor; hasPBR = true; }
          if (override.metallicFactor !== undefined) { pbr.metallicFactor = override.metallicFactor; hasPBR = true; }
          if (override.roughnessFactor !== undefined) { pbr.roughnessFactor = override.roughnessFactor; hasPBR = true; }
          if (override.emissiveFactor) { pbr.emissiveFactor = override.emissiveFactor; hasPBR = true; }
          if (hasPBR) {
            gltfPBR.set(idx, pbr);
          }
        }
      }
      let defaultDS: boolean | undefined = false;
      if (gltfDS.size > 0) defaultDS = gltfDS.values().next().value;

      const faces: any[] = [];
      const textureIdSet = new Set<string>();

      for (let i = 0; i < 8; i++) {
        const face = te.faces[i] ?? te.defaultTexture;
        const pbr = gltfPBR.get(i);

        let textureId: string;
        const legacyId = face.textureID?.toString() || '';
        if (BAKE_MAGIC_UUIDS.has(legacyId)) {
          // BoM: legacy face is a bake — use it (will be substituted later)
          textureId = legacyId;
        } else if (pbr?.baseColorTextureId) {
          textureId = pbr.baseColorTextureId;
        } else {
          textureId = legacyId;
        }
        if (!textureId || textureId === ZERO_UUID) continue;

        const rgba = face.rgba;
        let color = rgba
          ? [rgba.getRed(), rgba.getGreen(), rgba.getBlue(), rgba.getAlpha()]
          : [1, 1, 1, 1];

        // Built-in transparent textures — force alpha to 0 regardless of what the
        // resolved textureId is (PBR may override the texture but legacy transparency wins).
        if (TRANSPARENT_TEXTURES.has(legacyId)) {
          color = [color[0], color[1], color[2], 0];
        }

        // Built-in solid-color textures — use the face's own color/alpha (the texture
        // is just a flat fill, so the face tint IS the final color). No texture fetch needed.
        // No color override — the face RGBA already carries the intended tint + transparency.

        let alphaMode = gltfAlpha.get(i)?.mode ?? -1;
        let alphaCutoff = gltfAlpha.get(i)?.cutoff ?? 0.5;
        if (alphaMode === -1) {
          const matId = face.materialID?.toString();
          if (matId && matId !== ZERO_UUID) {
            const cached = this.legacyMaterialCache.get(matId);
            if (cached) {
              alphaMode = cached.alphaMode;
              alphaCutoff = cached.alphaCutoff;
            }
          }
        }

        const faceData: any = {
          index: i,
          textureId,
          color,
          fullBright: (face.material & 0x20) !== 0,
          doubleSided: gltfDS.get(i) ?? defaultDS,
          alphaMode,
          alphaCutoff,
          repeatU: face.repeatU ?? 1,
          repeatV: face.repeatV ?? 1,
          offsetU: face.offsetU ?? 0,
          offsetV: face.offsetV ?? 0,
          rotation: face.rotation ?? 0,
          ...(face.mappingType ? { mappingType: face.mappingType } : {}),
        };
        textureIdSet.add(textureId);

        if (pbr) {
          faceData.isPBR = true;
          this.pbrFaceCount++;
          if (pbr.normalTextureId) {
            faceData.normalTextureId = pbr.normalTextureId;
            textureIdSet.add(pbr.normalTextureId);
          }
          if (pbr.ormTextureId) {
            faceData.ormTextureId = pbr.ormTextureId;
            textureIdSet.add(pbr.ormTextureId);
          }
          if (pbr.emissiveTextureId) {
            faceData.emissiveTextureId = pbr.emissiveTextureId;
            textureIdSet.add(pbr.emissiveTextureId);
          }
          if (pbr.metallicFactor !== undefined) faceData.metallicFactor = pbr.metallicFactor;
          if (pbr.roughnessFactor !== undefined) faceData.roughnessFactor = pbr.roughnessFactor;
          if (pbr.emissiveFactor) faceData.emissiveFactor = pbr.emissiveFactor;
          if (pbr.baseColor) faceData.pbrBaseColor = pbr.baseColor;
        } else {
          const matId = face.materialID?.toString();
          if (matId && matId !== ZERO_UUID) {
            const cached = this.legacyMaterialCache.get(matId);
            if (cached) {
              if (cached.normMap) {
                faceData.normalTextureId = cached.normMap;
                textureIdSet.add(cached.normMap);
              }
              if (cached.specExp != null) {
                faceData.roughnessFactor = 1.0 - cached.specExp / 255;
              }
              if (cached.envIntensity != null) {
                faceData.metallicFactor = cached.envIntensity / 255;
              }
            }
          }
        }

        faces.push(faceData);
      }

      if (faces.length === 0) return undefined;
      return { faces, textureIds: Array.from(textureIdSet) };
    } catch {
      return undefined;
    }
  }

  /** Fetch legacy + PBR textures and material assets for an object */
  fetchTexturesForObject(obj: any, texInfo?: ReturnType<typeof this.getTextureInfo>): void {
    // Collect face indices covered by renderMaterialData
    const rmd = obj.extraParams?.renderMaterialData;
    const materialFaceIndices = new Set<number>();
    if (rmd && rmd.params && rmd.params.length > 0) {
      for (const param of rmd.params) {
        const matUuid = param.textureUUID?.toString();
        if (matUuid && matUuid !== ZERO_UUID) {
          materialFaceIndices.add(param.textureIndex);
        }
      }
    }

    if (texInfo && this.textureFetchQueue) {
      for (const face of texInfo.faces) {
        // Skip faces covered by PBR materials — UNLESS it's a substituted bake texture.
        // Baked textures are the actual content; PBR just specifies rendering properties.
        if (materialFaceIndices.has(face.index) && !face._isBake) continue;
        if (face.textureId && !WATER_EXCLUSION_TEXTURES.has(face.textureId) && !BAKE_MAGIC_UUIDS.has(face.textureId) && !TRANSPARENT_TEXTURES.has(face.textureId) && !SOLID_COLOR_TEXTURES.has(face.textureId)) {
          if (face._isBake && face._bakeAvatarUuid != null && face._bakeChannel != null) {
            this.textureFetchQueue.requestBake(face.textureId, obj.ID, face._bakeAvatarUuid, face._bakeChannel);
          } else {
            this.textureFetchQueue.request(face.textureId, obj.ID);
          }
        }
        if (face.normalTextureId) this.textureFetchQueue.request(face.normalTextureId, obj.ID);
        if (face.ormTextureId) this.textureFetchQueue.request(face.ormTextureId, obj.ID);
        if (face.emissiveTextureId) this.textureFetchQueue.request(face.emissiveTextureId, obj.ID);
      }
    }

    // Queue material asset fetches for PBR faces
    if (materialFaceIndices.size > 0 && this.materialFetchQueue) {
      const te = obj.TextureEntry;
      const overrides = te?.gltfMaterialOverrides;
      for (const param of rmd!.params) {
        const matUuid = param.textureUUID?.toString();
        if (!matUuid || matUuid === ZERO_UUID) continue;
        const faceIndex = param.textureIndex;
        const face = te?.faces?.[faceIndex] ?? te?.defaultTexture;
        const inlineOverride = overrides?.get(faceIndex) ?? null;

        let list = this.materialToFaces.get(matUuid);
        if (!list) {
          list = [];
          this.materialToFaces.set(matUuid, list);
        }
        list.push({ localId: obj.ID, faceIndex, face, inlineOverride });
        this.materialFetchQueue.request(matUuid);
      }
    }

    // Queue legacy material fetches
    if (texInfo) {
      const te = obj.TextureEntry;
      for (let i = 0; i < 8; i++) {
        const face = te?.faces?.[i] ?? te?.defaultTexture;
        if (!face) continue;
        const matId = face.materialID?.toString();
        if (!matId || matId === ZERO_UUID) continue;
        if (this.legacyMaterialCache.has(matId)) continue;
        let list = this.legacyMaterialToFaces.get(matId);
        if (!list) {
          list = [];
          this.legacyMaterialToFaces.set(matId, list);
        }
        list.push({ localId: obj.ID, faceIndex: i });
        this.legacyMaterialPending.add(matId);
      }
      if (this.legacyMaterialPending.size > 0 && !this.legacyMaterialFetching) {
        this.flushLegacyMaterialFetch();
      }
    }
  }

  /** Batch-fetch legacy materials via RenderMaterials cap */
  private async flushLegacyMaterialFetch(): Promise<void> {
    if (this.legacyMaterialFetching || this.legacyMaterialPending.size === 0) return;
    this.legacyMaterialFetching = true;
    try {
      const uuids: Record<string, Material | null> = {};
      for (const uuid of this.legacyMaterialPending) {
        uuids[uuid] = null;
      }
      this.legacyMaterialPending.clear();

      await this.bot.clientCommands.asset.getMaterials(uuids);

      for (const [uuid, mat] of Object.entries(uuids)) {
        if (mat) {
          const entry: {
            alphaMode: number; alphaCutoff: number;
            normMap?: string; normRepeatX?: number; normRepeatY?: number;
            normOffsetX?: number; normOffsetY?: number; normRotation?: number;
            specExp?: number; envIntensity?: number;
          } = {
            alphaMode: mat.diffuseAlphaMode ?? -1,
            alphaCutoff: mat.alphaMaskCutoff != null ? mat.alphaMaskCutoff / 255 : 0.5,
          };
          const normMap = mat.normMap?.toString();
          if (normMap && normMap !== ZERO_UUID) {
            entry.normMap = normMap;
            entry.normRepeatX = mat.normRepeatX;
            entry.normRepeatY = mat.normRepeatY;
            entry.normOffsetX = mat.normOffsetX;
            entry.normOffsetY = mat.normOffsetY;
            entry.normRotation = mat.normRotation;
          }
          if (mat.specExp != null && mat.specExp > 0) {
            entry.specExp = mat.specExp;
          }
          if (mat.envIntensity != null && mat.envIntensity > 0) {
            entry.envIntensity = mat.envIntensity;
          }
          this.legacyMaterialCache.set(uuid, entry);
          if (entry.normMap && this.textureFetchQueue) {
            this.textureFetchQueue.request(entry.normMap, 0);
          }
        }
        // Re-emit face data for affected objects
        const entries = this.legacyMaterialToFaces.get(uuid);
        if (entries) {
          this.legacyMaterialToFaces.delete(uuid);
          const byObject = new Map<number, number[]>();
          for (const { localId, faceIndex } of entries) {
            if (!this.trackedObjects.has(localId)) continue;
            let list = byObject.get(localId);
            if (!list) { list = []; byObject.set(localId, list); }
            list.push(faceIndex);
          }
          for (const [localId, faceIndices] of byObject) {
            const obj = this.bot.currentRegion?.objects?.getObjectByLocalID(localId);
            if (!obj) continue;
            const texInfo = this.getTextureInfo(obj);
            if (texInfo) {
              const updatedFaces = texInfo.faces.filter(f => faceIndices.includes(f.index));
              if (updatedFaces.length > 0) {
                // Re-apply BoM substitution since getTextureInfo reads original magic UUIDs
                this.substituteBakeUuids(updatedFaces, localId);
                this.queueFaceUpdate(localId, updatedFaces);
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('[GodotBridge] Legacy material fetch failed:', err);
    } finally {
      this.legacyMaterialFetching = false;
      if (this.legacyMaterialPending.size > 0) {
        this.flushLegacyMaterialFetch();
      }
    }
  }

  /** Handle a material asset being fetched and parsed — send face updates to Godot */
  handleMaterialReady(materialUuid: string, data: MaterialOverrideData): void {
    const entries = this.materialToFaces.get(materialUuid);
    if (!entries || entries.length === 0) return;

    const byObject = new Map<number, any[]>();

    for (const { localId, faceIndex, face, inlineOverride } of entries) {
      if (!this.trackedObjects.has(localId)) continue;

      let baseColorTextureId = data.baseColorTextureId;
      let normalTextureId = data.normalTextureId;
      let metallicFactor = data.metallicFactor;
      let roughnessFactor = data.roughnessFactor;
      let emissiveFactor = data.emissiveFactor;
      let baseColor = data.baseColor;
      let alphaMode = data.alphaMode;
      let alphaCutoff = data.alphaCutoff;
      let doubleSided = data.doubleSided;

      let baseColorTransform: TextureTransform | null = data.textureTransforms?.[0] ?? null;

      if (inlineOverride) {
        if (inlineOverride.textures && Array.isArray(inlineOverride.textures)) {
          const t0 = inlineOverride.textures[0]?.toString();
          const t1 = inlineOverride.textures[1]?.toString();
          if (t0 && t0 !== ZERO_UUID) baseColorTextureId = t0;
          if (t1 && t1 !== ZERO_UUID) normalTextureId = t1;
        }
        if (inlineOverride.baseColor) baseColor = inlineOverride.baseColor;
        if (inlineOverride.metallicFactor !== undefined) metallicFactor = inlineOverride.metallicFactor;
        if (inlineOverride.roughnessFactor !== undefined) roughnessFactor = inlineOverride.roughnessFactor;
        if (inlineOverride.emissiveFactor) emissiveFactor = inlineOverride.emissiveFactor;
        if (inlineOverride.alphaMode !== undefined) alphaMode = inlineOverride.alphaMode;
        if (inlineOverride.alphaCutoff !== undefined) alphaCutoff = inlineOverride.alphaCutoff;
        if (inlineOverride.doubleSided !== undefined) doubleSided = inlineOverride.doubleSided;
        if (inlineOverride.textureTransforms && Array.isArray(inlineOverride.textureTransforms)) {
          if (inlineOverride.textureTransforms[0]) {
            baseColorTransform = inlineOverride.textureTransforms[0];
          }
        }
      }

      const repeatU = baseColorTransform?.scale?.[0] ?? face?.repeatU ?? 1;
      const repeatV = baseColorTransform?.scale?.[1] ?? face?.repeatV ?? 1;
      const offsetU = baseColorTransform?.offset?.[0] ?? face?.offsetU ?? 0;
      const offsetV = baseColorTransform?.offset?.[1] ?? face?.offsetV ?? 0;
      const rotation = baseColorTransform?.rotation ?? face?.rotation ?? 0;

      const rgba = face?.rgba;
      let legacyColor = rgba
        ? [rgba.getRed(), rgba.getGreen(), rgba.getBlue(), rgba.getAlpha()]
        : [1, 1, 1, 1];

      // Resolve final textureId — substitute magic bake UUIDs if needed.
      // BoM: if the legacy face texture is a bake magic UUID, the baked texture
      // overrides the PBR base color (matching SL viewer behaviour).
      const legacyTexId = face?.textureID?.toString() || '';

      // Built-in transparent textures — force alpha to 0 so Godot creates a transparent material
      if (TRANSPARENT_TEXTURES.has(legacyTexId)) {
        legacyColor = [legacyColor[0], legacyColor[1], legacyColor[2], 0];
      }

      let resolvedTextureId = BAKE_MAGIC_UUIDS.has(legacyTexId)
        ? legacyTexId                                  // will be substituted below
        : (baseColorTextureId || legacyTexId);
      let isBake = false;
      let bakeAvatarUuid: string | undefined;
      let bakeChannel: number | undefined;
      if (BAKE_MAGIC_UUIDS.has(resolvedTextureId) && this.avatarManager) {
        try {
          const obj = this.bot.currentRegion?.objects?.getObjectByLocalID(localId);
          if (obj?.ParentID) {
            const avatarId = this.avatarManager.findOwnerAvatar(obj.ParentID);
            if (avatarId) {
              const bakes = this.avatarManager.getBakedTextures(avatarId);
              const channel = BAKE_MAGIC_UUIDS.get(resolvedTextureId);
              if (bakes && channel !== undefined) {
                const bakedUuid = bakes[channel];
                if (bakedUuid && bakedUuid !== ZERO_UUID) {
                  resolvedTextureId = bakedUuid;
                  isBake = true;
                  bakeAvatarUuid = avatarId;
                  bakeChannel = channel;
                }
              }
            }
          }
        } catch { /* object may not exist */ }
      }

      const faceData: any = {
        index: faceIndex,
        textureId: resolvedTextureId,
        _isBake: isBake,
        _bakeAvatarUuid: bakeAvatarUuid,
        _bakeChannel: bakeChannel,
        color: legacyColor,
        fullBright: face ? (face.material & 0x20) !== 0 : false,
        doubleSided: doubleSided ?? false,
        alphaMode: alphaMode ?? -1,
        alphaCutoff: alphaCutoff ?? 0.5,
        repeatU,
        repeatV,
        offsetU,
        offsetV,
        rotation,
        isPBR: true,
        ...(face?.mappingType ? { mappingType: face.mappingType } : {}),
      };

      if (normalTextureId) faceData.normalTextureId = normalTextureId;
      if (metallicFactor !== undefined) faceData.metallicFactor = metallicFactor;
      if (roughnessFactor !== undefined) faceData.roughnessFactor = roughnessFactor;
      if (emissiveFactor) faceData.emissiveFactor = emissiveFactor;
      if (baseColor) faceData.pbrBaseColor = baseColor;

      this.pbrFaceCount++;

      // Fetch the resolved texture (may be substituted bake UUID)
      if (resolvedTextureId && !BAKE_MAGIC_UUIDS.has(resolvedTextureId) && !TRANSPARENT_TEXTURES.has(resolvedTextureId) && !SOLID_COLOR_TEXTURES.has(resolvedTextureId) && this.textureFetchQueue) {
        if (isBake && faceData._bakeAvatarUuid && faceData._bakeChannel != null) {
          this.textureFetchQueue.requestBake(resolvedTextureId, localId, faceData._bakeAvatarUuid, faceData._bakeChannel);
        } else {
          this.textureFetchQueue.request(resolvedTextureId, localId);
        }
      }
      if (normalTextureId && this.textureFetchQueue) {
        this.textureFetchQueue.request(normalTextureId, localId);
      }

      let faces = byObject.get(localId);
      if (!faces) {
        faces = [];
        byObject.set(localId, faces);
      }
      faces.push(faceData);
    }

    for (const [localId, faces] of byObject) {
      this.queueFaceUpdate(localId, faces);
    }

    this.materialToFaces.delete(materialUuid);
  }

  /** Handle live texture/UV change on a tracked object */
  handleObjectTextureUpdate(obj: any): void {
    if (!this.trackedObjects.has(obj.ID)) return;
    const texInfo = this.getTextureInfo(obj);
    if (!texInfo) return;
    // Re-apply BoM substitution since getTextureInfo reads original magic UUIDs
    this.substituteBakeUuids(texInfo.faces, obj.ID);
    this.queueFaceUpdate(obj.ID, texInfo.faces);
    this.fetchTexturesForObject(obj, texInfo);
  }

  /**
   * Substitute magic bake UUIDs in face data with actual baked texture UUIDs.
   * Must be called on any face data re-read from live objects before sending to Godot.
   */
  private substituteBakeUuids(faces: any[], localId: number): void {
    if (!this.avatarManager) return;
    try {
      const obj = this.bot.currentRegion?.objects?.getObjectByLocalID(localId);
      if (!obj?.ParentID) return;
      const avatarId = this.avatarManager.findOwnerAvatar(obj.ParentID);
      if (!avatarId) return;
      const bakes = this.avatarManager.getBakedTextures(avatarId);
      if (!bakes) return;

      for (const face of faces) {
        const channel = BAKE_MAGIC_UUIDS.get(face.textureId);
        if (channel !== undefined) {
          const bakedUuid = bakes[channel];
          if (bakedUuid && bakedUuid !== ZERO_UUID) {
            face.textureId = bakedUuid;
            face._isBake = true;
            face._bakeAvatarUuid = avatarId;
            face._bakeChannel = channel;
          }
        }
      }
    } catch { /* object may not exist */ }
  }

  /** Queue a face update for batched delivery to Godot. Multiple updates for the same
   *  object within the flush window are coalesced (latest per face index wins). */
  queueFaceUpdate(localId: number, faces: any[]): void {
    const existing = this.faceUpdateBuffer.get(localId);
    if (existing) {
      // Merge: latest face data wins per face index
      for (const face of faces) {
        const idx = existing.findIndex((f: any) => f.index === face.index);
        if (idx >= 0) {
          existing[idx] = face;
        } else {
          existing.push(face);
        }
      }
    } else {
      this.faceUpdateBuffer.set(localId, [...faces]);
    }
    if (!this.faceUpdateTimer) {
      this.faceUpdateTimer = setTimeout(() => this.flushFaceUpdates(), GodotMaterialPipeline.FACE_UPDATE_FLUSH_MS);
    }
  }

  private flushFaceUpdates(): void {
    this.faceUpdateTimer = null;
    if (this.faceUpdateBuffer.size === 0) return;

    const objects: any[] = [];
    for (const [localId, faces] of this.faceUpdateBuffer) {
      objects.push({ localId, faces });
    }
    this.faceUpdateBuffer.clear();

    this.send({ type: 'object_update_faces_batch', objects });
  }

  get totalPbrFaceCount(): number {
    return this.pbrFaceCount;
  }

  cleanup(): void {
    this.materialToFaces.clear();
    this.legacyMaterialPending.clear();
    this.legacyMaterialToFaces.clear();
    if (this.faceUpdateTimer) {
      clearTimeout(this.faceUpdateTimer);
      this.faceUpdateTimer = null;
    }
    this.faceUpdateBuffer.clear();
    if (this.materialFetchQueue) {
      this.materialFetchQueue.destroy();
      this.materialFetchQueue = null;
    }
  }
}
