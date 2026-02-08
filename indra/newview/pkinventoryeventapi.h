/**
 * @file   pkinventoryeventapi.h
 * @brief  PKInventoryEventAPI class for inventory operations via LEAP/WebSocket
 *
 * $LicenseInfo:firstyear=2025&license=viewerlgpl$
 * Copyright (C) 2025, Pyrokitty
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation;
 * version 2.1 of the License only.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with this library; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301  USA
 * $/LicenseInfo$
 */

#ifndef PK_PKINVENTORYEVENTAPI_H
#define PK_PKINVENTORYEVENTAPI_H

#include "lleventapi.h"

class LLSD;

/**
 * PKInventoryEventAPI provides an event API for inventory operations.
 *
 * This allows external applications (like Electron/PyroKitty) to:
 * - Browse inventory folders and items
 * - Create folders
 * - Download and upload assets
 * - Delete and rename items
 * - Query upload cost
 *
 * Pump name: "InventoryAPI"
 *
 * Operations:
 * - getRootFolder: Get the root inventory folder UUID
 * - getFolderContents: List items and subfolders in a folder
 * - createFolder: Create a new subfolder (async)
 * - downloadAsset: Download an asset by item ID (async)
 * - uploadAsset: Upload a new asset (async)
 * - deleteItem: Delete an inventory item
 * - updateItem: Rename an inventory item
 * - getUploadCost: Get the current texture upload cost
 */
class PKInventoryEventAPI : public LLEventAPI
{
public:
    PKInventoryEventAPI();
    ~PKInventoryEventAPI();

private:
    // Sync operations
    void getRootFolder(const LLSD& request);
    void getFolderContents(const LLSD& request);
    void deleteItem(const LLSD& request);
    void updateItem(const LLSD& request);
    void getUploadCost(const LLSD& request);

    // Async operations
    void createFolder(const LLSD& request);
    void downloadAsset(const LLSD& request);
    void uploadAsset(const LLSD& request);
};

#endif // PK_PKINVENTORYEVENTAPI_H
