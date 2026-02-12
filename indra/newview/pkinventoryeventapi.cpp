/**
 * @file   pkinventoryeventapi.cpp
 * @brief  Implementation of PKInventoryEventAPI for inventory operations via LEAP/WebSocket
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

#include "llviewerprecompiledheaders.h"

#include "pkinventoryeventapi.h"

#include "llagent.h"
#include "llagentbenefits.h"
#include "llassetstorage.h"
#include "llbase64.h"
#include "llevents.h"
#include "llfilesystem.h"
#include "llfloaterreg.h"
#include "llinventorymodel.h"
#include "llpreviewnotecard.h"
#include "llpreviewscript.h"
#include "llviewerassetupload.h"
#include "llviewerinventory.h"
#include "llviewermenufile.h"
#include "llviewerregion.h"

PKInventoryEventAPI::PKInventoryEventAPI()
    : LLEventAPI("InventoryAPI",
                 "API for inventory operations.\n"
                 "Allows browsing, creating, downloading, uploading, deleting, and renaming inventory items.")
{
    add("getRootFolder",
        "Get the root inventory folder UUID.\n"
        "Returns [\"root_id\"] UUID of the root folder.",
        &PKInventoryEventAPI::getRootFolder);

    add("getFolderContents",
        "List items and subfolders in a folder.\n"
        "[\"folder_id\"] UUID of the folder to list [required]\n"
        "Returns [\"folders\"] array and [\"items\"] array.",
        &PKInventoryEventAPI::getFolderContents);

    add("createFolder",
        "Create a new subfolder (async).\n"
        "[\"parent_id\"] UUID of parent folder [required]\n"
        "[\"name\"] name of the new folder [required]\n"
        "Returns [\"folder_id\"] UUID of the created folder via reply pump.",
        &PKInventoryEventAPI::createFolder);

    add("downloadAsset",
        "Download an asset by item ID (async).\n"
        "[\"item_id\"] UUID of the inventory item [required]\n"
        "Returns [\"data\"] base64-encoded asset data, [\"asset_id\"], [\"asset_type\"] via reply pump.",
        &PKInventoryEventAPI::downloadAsset);

    add("uploadAsset",
        "Upload a new asset (async).\n"
        "[\"folder_id\"] destination folder UUID [required]\n"
        "[\"name\"] item name [required]\n"
        "[\"description\"] item description [default=\"\"]\n"
        "[\"asset_type\"] type: \"texture\", \"notecard\", \"lsl\" [required]\n"
        "[\"data\"] base64-encoded asset data [required]\n"
        "Returns [\"item_id\"] and [\"asset_id\"] via reply pump.",
        &PKInventoryEventAPI::uploadAsset);

    add("deleteItem",
        "Delete an inventory item.\n"
        "[\"item_id\"] UUID of the item to delete [required]\n"
        "Returns [\"success\"] boolean.",
        &PKInventoryEventAPI::deleteItem);

    add("updateItem",
        "Rename an inventory item.\n"
        "[\"item_id\"] UUID of the item to rename [required]\n"
        "[\"name\"] new name [required]\n"
        "Returns [\"success\"] boolean.",
        &PKInventoryEventAPI::updateItem);

    add("getUploadCost",
        "Get the current texture upload cost in L$.\n"
        "Returns [\"upload_cost\"] integer.",
        &PKInventoryEventAPI::getUploadCost);

    add("updateAsset",
        "Update an existing inventory item's asset data in-place (async).\n"
        "Uses the same capability the editor uses when you press Save.\n"
        "[\"item_id\"] UUID of the inventory item [required]\n"
        "[\"data\"] base64-encoded asset data [required]\n"
        "Returns [\"asset_id\"] new asset UUID via reply pump.\n"
        "If the item is open in an editor, the editor is refreshed automatically.",
        &PKInventoryEventAPI::updateAsset);
}

PKInventoryEventAPI::~PKInventoryEventAPI()
{
}

void PKInventoryEventAPI::getRootFolder(const LLSD& request)
{
    Response response(LLSD(), request);
    LLUUID root_id = gInventory.getRootFolderID();
    if (root_id.isNull())
    {
        return response.error("Inventory root folder not available");
    }
    response["root_id"] = root_id;
}

void PKInventoryEventAPI::getFolderContents(const LLSD& request)
{
    Response response(LLSD(), request);

    if (!request.has("folder_id"))
    {
        return response.error("'folder_id' is required");
    }

    LLUUID folder_id = request["folder_id"].asUUID();
    if (folder_id.isNull())
    {
        return response.error("Invalid folder_id");
    }

    LLInventoryModel::cat_array_t* categories = nullptr;
    LLInventoryModel::item_array_t* items = nullptr;
    gInventory.getDirectDescendentsOf(folder_id, categories, items);

    LLSD folders_llsd = LLSD::emptyArray();
    if (categories)
    {
        for (const auto& cat : *categories)
        {
            if (!cat) continue;
            LLSD folder_info;
            folder_info["id"] = cat->getUUID();
            folder_info["name"] = cat->getName();
            folder_info["type"] = LLFolderType::lookup(cat->getPreferredType());
            folders_llsd.append(folder_info);
        }
    }

    LLSD items_llsd = LLSD::emptyArray();
    if (items)
    {
        for (const auto& item : *items)
        {
            if (!item) continue;
            LLSD item_info;
            item_info["id"] = item->getUUID();
            item_info["name"] = item->getName();
            item_info["asset_id"] = item->getAssetUUID();
            item_info["type"] = LLAssetType::lookup(item->getType());
            LLSD perms;
            perms["owner"] = item->getPermissions().getOwner();
            item_info["permissions"] = perms;
            items_llsd.append(item_info);
        }
    }

    response["folders"] = folders_llsd;
    response["items"] = items_llsd;
}

void PKInventoryEventAPI::createFolder(const LLSD& request)
{
    // Async operation - send response via reply pump
    if (!request.has("reply") || !request.has("parent_id") || !request.has("name"))
    {
        Response response(LLSD(), request);
        return response.error("'reply', 'parent_id', and 'name' are required");
    }

    LLUUID parent_id = request["parent_id"].asUUID();
    std::string name = request["name"].asString();
    std::string reply_pump = request["reply"].asString();
    LLSD reqid = request["reqid"];

    if (parent_id.isNull())
    {
        Response response(LLSD(), request);
        return response.error("Invalid parent_id");
    }

    gInventory.createNewCategory(
        parent_id,
        LLFolderType::FT_NONE,
        name,
        [reply_pump, reqid](const LLUUID& new_folder_id)
        {
            LLSD response;
            response["reqid"] = reqid;
            if (new_folder_id.isNull())
            {
                response["error"] = "Failed to create folder";
            }
            else
            {
                response["folder_id"] = new_folder_id;
            }
            LLEventPumps::instance().obtain(reply_pump).post(response);
        }
    );
}

void PKInventoryEventAPI::downloadAsset(const LLSD& request)
{
    // Async operation - send response via reply pump
    if (!request.has("reply") || !request.has("item_id"))
    {
        Response response(LLSD(), request);
        return response.error("'reply' and 'item_id' are required");
    }

    LLUUID item_id = request["item_id"].asUUID();
    std::string reply_pump = request["reply"].asString();
    LLSD reqid = request["reqid"];

    LLViewerInventoryItem* item = gInventory.getItem(item_id);
    if (!item)
    {
        Response response(LLSD(), request);
        return response.error("Item not found in inventory");
    }

    LLUUID asset_id = item->getAssetUUID();
    LLAssetType::EType asset_type = item->getType();
    std::string asset_type_str = LLAssetType::lookup(asset_type);

    // Create a copy of needed data for the callback
    struct DownloadData
    {
        std::string reply_pump;
        LLSD reqid;
        LLUUID asset_id;
        LLAssetType::EType asset_type;
        std::string asset_type_str;
    };
    DownloadData* data = new DownloadData();
    data->reply_pump = reply_pump;
    data->reqid = reqid;
    data->asset_id = asset_id;
    data->asset_type = asset_type;
    data->asset_type_str = asset_type_str;

    gAssetStorage->getAssetData(
        asset_id,
        asset_type,
        [](const LLUUID& asset_uuid, LLAssetType::EType type, void* user_data, S32 status, LLExtStat ext_status)
        {
            DownloadData* dd = static_cast<DownloadData*>(user_data);
            LLSD response;
            response["reqid"] = dd->reqid;

            if (status != 0)
            {
                response["error"] = llformat("Asset download failed with status %d", status);
            }
            else
            {
                // Read from VFS cache
                LLFileSystem file(dd->asset_id, dd->asset_type, LLFileSystem::READ);
                S32 file_size = file.getSize();
                if (file_size > 0)
                {
                    std::vector<U8> buffer(file_size);
                    file.read(buffer.data(), file_size);
                    std::string encoded = LLBase64::encode(buffer.data(), file_size);
                    response["data"] = encoded;
                    response["asset_id"] = dd->asset_id;
                    response["asset_type"] = dd->asset_type_str;
                }
                else
                {
                    response["error"] = "Asset downloaded but file is empty";
                }
            }

            LLEventPumps::instance().obtain(dd->reply_pump).post(response);
            delete dd;
        },
        data,
        true // high priority
    );
}

void PKInventoryEventAPI::uploadAsset(const LLSD& request)
{
    // Async operation - send response via reply pump
    if (!request.has("reply") || !request.has("folder_id") ||
        !request.has("name") || !request.has("asset_type") || !request.has("data"))
    {
        Response response(LLSD(), request);
        return response.error("'reply', 'folder_id', 'name', 'asset_type', and 'data' are required");
    }

    std::string reply_pump = request["reply"].asString();
    LLSD reqid = request["reqid"];
    LLUUID folder_id = request["folder_id"].asUUID();
    std::string name = request["name"].asString();
    std::string description = request.has("description") ? request["description"].asString() : "";
    std::string asset_type_str = request["asset_type"].asString();
    std::string data_b64 = request["data"].asString();

    // Decode base64 data
    std::string buffer = LLBase64::decodeAsString(data_b64);
    if (buffer.empty())
    {
        Response response(LLSD(), request);
        return response.error("Failed to decode base64 data");
    }

    // Map asset type string to enums
    LLAssetType::EType asset_type;
    LLInventoryType::EType inv_type;
    LLFolderType::EType folder_type;
    S32 upload_cost;

    if (asset_type_str == "texture")
    {
        asset_type = LLAssetType::AT_TEXTURE;
        inv_type = LLInventoryType::IT_TEXTURE;
        folder_type = LLFolderType::FT_TEXTURE;
        upload_cost = LLAgentBenefitsMgr::current().getTextureUploadCost();
    }
    else if (asset_type_str == "notecard")
    {
        asset_type = LLAssetType::AT_NOTECARD;
        inv_type = LLInventoryType::IT_NOTECARD;
        folder_type = LLFolderType::FT_NOTECARD;
        upload_cost = 0; // Notecards are free
    }
    else if (asset_type_str == "lsl")
    {
        asset_type = LLAssetType::AT_LSL_TEXT;
        inv_type = LLInventoryType::IT_LSL;
        folder_type = LLFolderType::FT_LSL_TEXT;
        upload_cost = 0; // Scripts are free
    }
    else
    {
        Response response(LLSD(), request);
        return response.error("Unsupported asset_type. Use 'texture', 'notecard', or 'lsl'");
    }

    // Create callbacks
    LLNewBufferedResourceUploadInfo::uploadFinish_f finish =
        [reply_pump, reqid](LLUUID newAssetId, LLSD upload_response)
        {
            LLSD response;
            response["reqid"] = reqid;
            response["asset_id"] = newAssetId;
            // Try to extract the inventory item ID from the upload response
            if (upload_response.has("new_inventory_item"))
            {
                response["item_id"] = upload_response["new_inventory_item"];
            }
            LLEventPumps::instance().obtain(reply_pump).post(response);
        };

    LLNewBufferedResourceUploadInfo::uploadFailure_f failure =
        [reply_pump, reqid](LLUUID assetId, LLSD upload_response, std::string reason) -> bool
        {
            LLSD response;
            response["reqid"] = reqid;
            response["error"] = reason;
            LLEventPumps::instance().obtain(reply_pump).post(response);
            return false; // Don't retry
        };

    LLUUID asset_id;
    asset_id.generate();

    LLResourceUploadInfo::ptr_t uploadInfo(std::make_shared<LLNewBufferedResourceUploadInfo>(
        buffer,
        asset_id,
        name,
        description,
        0, // compression info
        folder_type,
        inv_type,
        asset_type,
        PERM_ALL,  // next owner perms
        PERM_NONE, // group perms
        PERM_NONE, // everyone perms
        upload_cost,
        folder_id,
        false, // don't show inventory
        finish,
        failure));

    upload_new_resource(uploadInfo);
}

void PKInventoryEventAPI::deleteItem(const LLSD& request)
{
    Response response(LLSD(), request);

    if (!request.has("item_id"))
    {
        return response.error("'item_id' is required");
    }

    LLUUID item_id = request["item_id"].asUUID();
    if (item_id.isNull())
    {
        return response.error("Invalid item_id");
    }

    LLViewerInventoryItem* item = gInventory.getItem(item_id);
    if (!item)
    {
        return response.error("Item not found in inventory");
    }

    remove_inventory_item(item_id, nullptr);
    response["success"] = true;
}

void PKInventoryEventAPI::updateItem(const LLSD& request)
{
    Response response(LLSD(), request);

    if (!request.has("item_id") || !request.has("name"))
    {
        return response.error("'item_id' and 'name' are required");
    }

    LLUUID item_id = request["item_id"].asUUID();
    std::string new_name = request["name"].asString();

    if (item_id.isNull())
    {
        return response.error("Invalid item_id");
    }

    LLViewerInventoryItem* item = gInventory.getItem(item_id);
    if (!item)
    {
        return response.error("Item not found in inventory");
    }

    LLSD updates;
    updates["name"] = new_name;
    update_inventory_item(item_id, updates, nullptr);

    response["success"] = true;
}

void PKInventoryEventAPI::getUploadCost(const LLSD& request)
{
    Response response(LLSD(), request);
    S32 cost = LLAgentBenefitsMgr::current().getTextureUploadCost();
    response["upload_cost"] = cost;
}

void PKInventoryEventAPI::updateAsset(const LLSD& request)
{
    // Async operation - update an existing inventory item's asset in-place
    if (!request.has("reply") || !request.has("item_id") || !request.has("data"))
    {
        Response response(LLSD(), request);
        return response.error("'reply', 'item_id', and 'data' are required");
    }

    std::string reply_pump = request["reply"].asString();
    LLSD reqid = request["reqid"];
    LLUUID item_id = request["item_id"].asUUID();
    std::string data_b64 = request["data"].asString();

    if (item_id.isNull())
    {
        Response response(LLSD(), request);
        return response.error("Invalid item_id");
    }

    LLViewerInventoryItem* item = gInventory.getItem(item_id);
    if (!item)
    {
        Response response(LLSD(), request);
        return response.error("Item not found in inventory");
    }

    std::string buffer = LLBase64::decodeAsString(data_b64);
    if (buffer.empty())
    {
        Response response(LLSD(), request);
        return response.error("Failed to decode base64 data");
    }

    const LLViewerRegion* region = gAgent.getRegion();
    if (!region)
    {
        Response response(LLSD(), request);
        return response.error("No active region");
    }

    LLAssetType::EType asset_type = item->getType();
    LLUUID old_asset_id = item->getAssetUUID();

    if (asset_type == LLAssetType::AT_LSL_TEXT)
    {
        std::string url = region->getCapability("UpdateScriptAgent");
        if (url.empty())
        {
            Response response(LLSD(), request);
            return response.error("UpdateScriptAgent capability not available");
        }

        LLBufferedAssetUploadInfo::invnUploadFinish_f finish =
            [reply_pump, reqid, item_id, old_asset_id](LLUUID itemId, LLUUID newAssetId, LLUUID newItemId, LLSD upload_response)
            {
                // Clean up old cached asset
                LLFileSystem::removeFile(old_asset_id, LLAssetType::AT_LSL_TEXT);

                LLSD response;
                response["reqid"] = reqid;
                response["asset_id"] = newAssetId;
                response["item_id"] = itemId;

                if (upload_response.has("compiled") && !upload_response["compiled"].asBoolean())
                {
                    response["compile_errors"] = upload_response["errors"];
                }

                LLEventPumps::instance().obtain(reply_pump).post(response);

                // Refresh open script editor if any
                LLPreview* preview = LLFloaterReg::findTypedInstance<LLPreview>(
                    "preview_script", LLSD(item_id));
                if (preview)
                {
                    preview->loadAsset();
                }
            };

        LLBufferedAssetUploadInfo::uploadFailed_f failure =
            [reply_pump, reqid](LLUUID itemId, LLUUID taskId, LLSD upload_response, std::string reason) -> bool
            {
                LLSD response;
                response["reqid"] = reqid;
                response["error"] = reason;
                LLEventPumps::instance().obtain(reply_pump).post(response);
                return false;
            };

        // Use LLScriptAssetUpload which generates the right POST body for UpdateScriptAgent
        LLResourceUploadInfo::ptr_t uploadInfo(
            std::make_shared<LLScriptAssetUpload>(
                item_id,
                buffer,
                finish,
                failure));

        LLViewerAssetUpload::EnqueueInventoryUpload(url, uploadInfo);
    }
    else if (asset_type == LLAssetType::AT_NOTECARD)
    {
        std::string url = region->getCapability("UpdateNotecardAgentInventory");
        if (url.empty())
        {
            Response response(LLSD(), request);
            return response.error("UpdateNotecardAgentInventory capability not available");
        }

        LLBufferedAssetUploadInfo::invnUploadFinish_f finish =
            [reply_pump, reqid, item_id](LLUUID itemId, LLUUID newAssetId, LLUUID newItemId, LLSD upload_response)
            {
                LLSD response;
                response["reqid"] = reqid;
                response["asset_id"] = newAssetId;
                response["item_id"] = itemId;
                LLEventPumps::instance().obtain(reply_pump).post(response);

                // Refresh open notecard editor if any
                LLPreviewNotecard* nc = LLFloaterReg::findTypedInstance<LLPreviewNotecard>(
                    "preview_notecard", LLSD(item_id));
                if (nc)
                {
                    nc->refreshFromInventory();
                }
            };

        LLBufferedAssetUploadInfo::uploadFailed_f failure =
            [reply_pump, reqid](LLUUID itemId, LLUUID taskId, LLSD upload_response, std::string reason) -> bool
            {
                LLSD response;
                response["reqid"] = reqid;
                response["error"] = reason;
                LLEventPumps::instance().obtain(reply_pump).post(response);
                return false;
            };

        LLResourceUploadInfo::ptr_t uploadInfo(
            std::make_shared<LLBufferedAssetUploadInfo>(
                item_id,
                LLAssetType::AT_NOTECARD,
                buffer,
                finish,
                failure));

        LLViewerAssetUpload::EnqueueInventoryUpload(url, uploadInfo);
    }
    else
    {
        Response response(LLSD(), request);
        return response.error("updateAsset only supports notecards and scripts");
    }
}
