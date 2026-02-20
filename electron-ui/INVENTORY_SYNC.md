# Inventory Sync - Texture Folder Sync

Bidirectional sync between a local folder and a designated SL inventory folder ("PyroKitty Sync").

## File Naming Convention

Local files use the SL inventory item name directly:

```
data/inventory-sync/<accountId>/
  cat_photo.png
  sunset.png
```

Format: `<sl_name>.png`

SL names are sanitized for filesystem safety (replace `/\:*?"<>|` with `_`).

**No duplicate names allowed** in the PyroKitty Sync folder. During download sync,
if duplicate names are found in SL, rename them in SL to make them unique
(e.g. `cat_photo`, `cat_photo (2)`) before syncing.

## Upload Cost Guard

Uploading textures costs L$10 for most accounts but L$0 for Premium Plus.
- On login, check `loginResponse.accountLevelBenefits.texture_upload_cost`
- Also available at runtime via `region.getUploadCost()`
- **Only enable upload sync (local → SL) when upload cost is 0**
- Download sync (SL → local) always works regardless

## Texture Format

- SL stores textures as JPEG2000 (J2C)
- Local files stored as PNG
- Conversion via OpenJPEG CLI tools (`opj_decompress` / `opj_compress`)
  - Download from https://github.com/uclouvain/openjpeg/releases
  - Place binaries in `electron-ui/bin/` (not checked into git)
  - J2C → PNG: `opj_decompress -i input.j2c -o output.png`
  - PNG → J2C: `opj_compress -i input.png -o output.j2c`
  - Called from Node.js via `child_process.execFile()`
  - Uses temp files for conversion (write buffer → temp .j2c, run CLI, read .png)
  - Can upgrade to FFI or WASM later if performance matters

---

## TODO

### Phase 1: Core Infrastructure

- [x] Download OpenJPEG release binaries (Windows x64) from GitHub releases
  - Place `opj_decompress.exe` and `opj_compress.exe` in `electron-ui/bin/`
  - Add `electron-ui/bin/` to `.gitignore`
- [x] Create `j2k-converter.ts` utility (`electron-ui/src/main/j2k-converter.ts`)
  - `j2cToPng(j2cBuffer: Buffer): Promise<Buffer>` — write temp .j2c, run opj_decompress, read .png, cleanup
  - `pngToJ2c(pngBuffer: Buffer): Promise<Buffer>` — write temp .png, run opj_compress, read .j2c, cleanup
  - Uses `-r 1` for lossless compression (matches grumpy pattern)
  - Round-trip tested: J2C→PNG→J2C→PNG produces identical output
- [x] Create `InventorySyncManager` class (`electron-ui/src/main/inventory-sync-manager.ts`)
  - Constructor takes bot instance and accountId
  - `sync()` method runs full bidirectional sync
  - Progress callback for UI reporting
  - Manifest-based tracking to avoid redundant downloads/uploads

### Phase 2: SL → Local (Download)

- [x] Populate "PyroKitty Sync" folder (create if it doesn't exist in inventory root)
- [x] Deduplicate: if multiple SL items share the same name, rename in SL (e.g. `cat_photo (2)`)
- [x] Walk folder items, filter for `AssetType.Texture`
- [x] For each texture item not in manifest (or with changed assetID):
  - Download asset via `bot.clientCommands.asset.downloadAsset(AssetType.Texture, assetID)`
  - Convert J2C buffer → PNG
  - Write to `data/inventory-sync/<accountId>/<sanitized_name>.png`
  - Update manifest
- [x] Handle deleted items: if manifest entry has no matching SL item, delete local file
- [x] Rate limit downloads (max 5 concurrent, 100ms delay between batches)

### Phase 3: Local → SL (Upload)

- [x] Check upload cost — skip this phase entirely if cost > 0
- [x] Scan local folder for .png files not in manifest
- [x] For each new local file:
  - Convert PNG → J2C buffer
  - Upload via `syncFolder.uploadAsset(AssetType.Texture, InventoryType.Texture, buffer, name, description)`
  - Update manifest
- [x] Handle locally modified files (changed content, detected by md5 mismatch):
  - Delete old SL inventory item (`item.delete()`)
  - Upload new version
  - Update manifest with new assetId/itemId
  - Note: deleting the inventory item doesn't destroy the asset — anything
    already referencing the old UUID (prims, HUDs, etc.) keeps working

### Phase 4: Wiring It Up

- [x] Add IPC channels for sync control (SYNC_START, SYNC_GET_STATUS, SYNC_PROGRESS, SYNC_OPEN_FOLDER)
- [x] Expose upload cost info to renderer (shown in sync bar as "uploads free" / "uploads L$X")
- [x] Trigger sync on login (auto-starts 2s after metaverse_connected)
- [ ] Optional: `fs.watch` on local folder for live local → SL sync
- [x] Add basic UI: sync bar with status, "Sync Now" button, "Open Folder" button
- [x] useInventorySync hook for renderer

### Phase 5: Polish

- [ ] Progress reporting (X of Y textures synced)
- [ ] Error handling & retry for failed downloads/uploads
- [ ] Handle subfolder hierarchy (SL subfolders → local subdirectories)
- [ ] Conflict resolution: if same-name file exists locally with different UUID, keep both
- [ ] Cleanup orphaned manifest entries

---

## Sync Manifest

Stored at `data/inventory-sync/<accountId>/sync-manifest.json`:

```json
{
  "version": 1,
  "lastSync": 1700000000000,
  "uploadCost": 0,
  "items": {
    "cat_photo": {
      "localFile": "cat_photo.png",
      "assetId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "itemId": "11111111-2222-3333-4444-555555555555",
      "md5": "abc123...",
      "lastSynced": 1700000000000,
      "direction": "download"
    }
  }
}
```

## Key node-metaverse APIs

```ts
// Get/create sync folder
const root = bot.clientCommands.inventory.getInventoryRoot();
await root.populate();
let syncFolder = root.folders.find(f => f.name === 'PyroKitty Sync');
if (!syncFolder) syncFolder = await root.createFolder('PyroKitty Sync', FolderType.Texture);

// List textures
await syncFolder.populate();
const textures = syncFolder.items.filter(i => i.type === AssetType.Texture);

// Download
const j2cBuffer = await bot.clientCommands.asset.downloadAsset(AssetType.Texture, item.assetID);

// Upload
const newItem = await syncFolder.uploadAsset(
  AssetType.Texture, InventoryType.Texture, pngToJ2cBuffer, name, ''
);

// Upload cost check (login response)
loginResponse.accountLevelBenefits?.texture_upload_cost === 0

// Upload cost check (runtime)
const cost = await bot.agent.currentRegion.getUploadCost();
```
