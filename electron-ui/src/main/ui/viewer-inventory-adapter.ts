import { ViewerConnection } from '../network/viewer-connection';

/**
 * Adapter that wraps ViewerConnection.request() calls to provide an interface
 * compatible with what InventorySyncManager uses from node-metaverse.
 *
 * Duck-types to InventoryFolder / InventoryItem so the sync manager can use either.
 */

export interface ViewerInventoryPermissions {
  owner: string;
}

export class ViewerInventoryItem {
  name: string;
  itemID: { toString(): string };
  assetID: { toString(): string };
  type: number; // matches AssetType enum values
  permissions: ViewerInventoryPermissions;

  private connection: ViewerConnection;
  private _itemId: string;

  constructor(
    connection: ViewerConnection,
    data: { id: string; name: string; asset_id: string; type: string; permissions: { owner: string } }
  ) {
    this.connection = connection;
    this._itemId = data.id;
    this.name = data.name;
    this.itemID = { toString: () => data.id };
    this.assetID = { toString: () => data.asset_id };
    this.type = ViewerInventoryAdapter.assetTypeFromString(data.type);
    this.permissions = { owner: data.permissions?.owner || '' };
  }

  async delete(): Promise<void> {
    await this.connection.request('InventoryAPI', {
      op: 'deleteItem',
      item_id: this._itemId,
    });
  }

  async update(): Promise<void> {
    await this.connection.request('InventoryAPI', {
      op: 'updateItem',
      item_id: this._itemId,
      name: this.name,
    });
  }
}

export class ViewerInventoryFolder {
  name: string;
  folders: ViewerInventoryFolder[] = [];
  items: ViewerInventoryItem[] = [];

  private connection: ViewerConnection;
  private _folderId: string;

  constructor(connection: ViewerConnection, folderId: string, name: string) {
    this.connection = connection;
    this._folderId = folderId;
    this.name = name;
  }

  get folderId(): string {
    return this._folderId;
  }

  async populate(_fetchIfNeeded: boolean): Promise<void> {
    const result = await this.connection.request('InventoryAPI', {
      op: 'getFolderContents',
      folder_id: this._folderId,
    });

    this.folders = (result.folders || []).map((f: any) =>
      new ViewerInventoryFolder(this.connection, f.id, f.name)
    );

    this.items = (result.items || []).map((i: any) =>
      new ViewerInventoryItem(this.connection, i)
    );
  }

  async createFolder(name: string, _folderType?: number): Promise<ViewerInventoryFolder> {
    const result = await this.connection.request('InventoryAPI', {
      op: 'createFolder',
      parent_id: this._folderId,
      name,
    });
    return new ViewerInventoryFolder(this.connection, result.folder_id, name);
  }

  async uploadAsset(
    assetType: number,
    _invType: number,
    data: Buffer,
    name: string,
    description: string
  ): Promise<ViewerInventoryItem> {
    const assetTypeStr = ViewerInventoryAdapter.assetTypeToString(assetType);
    const b64 = data.toString('base64');

    const result = await this.connection.request('InventoryAPI', {
      op: 'uploadAsset',
      folder_id: this._folderId,
      name,
      description,
      asset_type: assetTypeStr,
      data: b64,
    }, 60000); // 60s timeout for uploads

    return new ViewerInventoryItem(this.connection, {
      id: result.item_id || '',
      name,
      asset_id: result.asset_id || '',
      type: assetTypeStr,
      permissions: { owner: '' },
    });
  }
}

export class ViewerInventoryAdapter {
  private connection: ViewerConnection;

  constructor(connection: ViewerConnection) {
    this.connection = connection;
  }

  async getRootFolder(): Promise<ViewerInventoryFolder> {
    const result = await this.connection.request('InventoryAPI', {
      op: 'getRootFolder',
    });
    return new ViewerInventoryFolder(this.connection, result.root_id, 'My Inventory');
  }

  async getUploadCost(): Promise<number> {
    const result = await this.connection.request('InventoryAPI', {
      op: 'getUploadCost',
    });
    return result.upload_cost;
  }

  async downloadAsset(itemId: string, _assetType: number): Promise<Buffer> {
    const result = await this.connection.request('InventoryAPI', {
      op: 'downloadAsset',
      item_id: itemId,
    }, 60000); // 60s timeout for downloads
    return Buffer.from(result.data, 'base64');
  }

  /** Update an existing item's asset data in-place (no delete+recreate) */
  async updateAsset(itemId: string, data: Buffer): Promise<{ assetId: string }> {
    const result = await this.connection.request('InventoryAPI', {
      op: 'updateAsset',
      item_id: itemId,
      data: data.toString('base64'),
    }, 60000);
    return { assetId: result.asset_id || '' };
  }

  // AssetType enum values used by node-metaverse
  static readonly ASSET_TEXTURE = 0;
  static readonly ASSET_NOTECARD = 7;
  static readonly ASSET_LSL_TEXT = 10;

  static assetTypeFromString(typeStr: string): number {
    switch (typeStr) {
      case 'texture': return ViewerInventoryAdapter.ASSET_TEXTURE;
      case 'notecard': return ViewerInventoryAdapter.ASSET_NOTECARD;
      case 'lsltext': return ViewerInventoryAdapter.ASSET_LSL_TEXT;
      default: return -1;
    }
  }

  static assetTypeToString(assetType: number): string {
    switch (assetType) {
      case 0: return 'texture';
      case 7: return 'notecard';
      case 10: return 'lsl';
      default: return 'unknown';
    }
  }
}
