/**
 * @file pkmirrorflags.cpp
 * @brief Per-axis mirror flags for objects (PyroKitty feature)
 *
 * <FS:Pyrokitty> Negative dimensions / per-axis mirroring
 */

#include "llviewerprecompiledheaders.h"

#include "pkmirrorflags.h"

#include "llagent.h"
#include "lldir.h"
#include "llfoldertype.h"
#include "llinventorydefines.h"
#include "llinventorymodel.h"
#include "llsdserialize.h"
#include "llviewerobject.h"
#include "llviewerobjectlist.h"
#include "llviewerinventory.h"
#include "pipeline.h"
#include "llvovolume.h"

PKMirrorFlags::PKMirrorFlags()
    : LLSingleton<PKMirrorFlags>()
{
}

PKMirrorFlags::~PKMirrorFlags()
{
    if (mDirty)
    {
        saveCache();
    }
}

void PKMirrorFlags::init()
{
    mCacheFileName = gDirUtilp->getExpandedFilename(LL_PATH_PER_SL_ACCOUNT, "pk_mirror_flags.xml");
    loadCache();
}

U8 PKMirrorFlags::getFlags(const LLUUID& object_id) const
{
    auto it = mFlagsCache.find(object_id);
    if (it != mFlagsCache.end())
    {
        return it->second;
    }
    return 0;
}

void PKMirrorFlags::setFlags(const LLUUID& object_id, U8 flags, LLViewerObject* obj)
{
    LL_INFOS("PKMirror") << "setFlags: object=" << object_id
                         << " flags=" << (S32)flags
                         << " obj=" << (obj ? "provided" : "nullptr") << LL_ENDL;

    if (flags == 0)
    {
        clearFlags(object_id, obj);
        return;
    }

    // Skip if flags haven't changed. This prevents duplicate notecards on relog:
    // getState() reads cached flags → sets checkboxes → triggers onCommitMirror() →
    // calls setFlags(). Without this check, a new notecard would be created every login.
    auto it = mFlagsCache.find(object_id);
    if (it != mFlagsCache.end() && it->second == flags)
    {
        LL_INFOS("PKMirror") << "setFlags: SKIPPED - cache already has flags=" << (S32)flags << LL_ENDL;
        return;
    }

    LL_INFOS("PKMirror") << "setFlags: UPDATING cache from "
                         << (it != mFlagsCache.end() ? (S32)it->second : -1)
                         << " to " << (S32)flags << LL_ENDL;

    mFlagsCache[object_id] = flags;
    mDirty = true;
    saveCache();

    // Notecard persistence: create/update notecard in object contents
    if (obj)
    {
        LL_INFOS("PKMirror") << "setFlags: creating notecard for flags=" << (S32)flags << LL_ENDL;
        updateNotecard(object_id, flags, obj);
    }
    else
    {
        LL_INFOS("PKMirror") << "setFlags: skipping notecard (obj=nullptr, drag mode)" << LL_ENDL;
    }
}

void PKMirrorFlags::clearFlags(const LLUUID& object_id, LLViewerObject* obj)
{
    auto it = mFlagsCache.find(object_id);
    if (it != mFlagsCache.end())
    {
        mFlagsCache.erase(it);
        mDirty = true;
        saveCache();
    }

    if (obj)
    {
        removeNotecard(object_id, obj);
    }
}

void PKMirrorFlags::persistNotecard(const LLUUID& object_id, LLViewerObject* obj)
{
    if (!obj) return;
    auto it = mFlagsCache.find(object_id);
    if (it != mFlagsCache.end() && it->second != 0)
    {
        LL_INFOS("PKMirror") << "persistNotecard: object=" << object_id
                             << " flags=" << (S32)it->second << LL_ENDL;
        updateNotecard(object_id, it->second, obj);
    }
    else
    {
        LL_INFOS("PKMirror") << "persistNotecard: object=" << object_id
                             << " SKIPPED - no flags in cache" << LL_ENDL;
    }
}

U8 PKMirrorFlags::syncFromInventory(const LLUUID& object_id, const LLInventoryObject::object_list_t& inv)
{
    U8 flags = 0;
    LLUUID notecard_item_id;

    for (const auto& item : inv)
    {
        if (item)
        {
            U8 f = notecardNameToFlags(item->getName());
            if (f != 0)
            {
                flags = f;
                notecard_item_id = item->getUUID();
                break;
            }
        }
    }

    if (flags != 0)
    {
        if (mFlagsCache[object_id] != flags)
        {
            mFlagsCache[object_id] = flags;
            mDirty = true;
            saveCache();
        }
    }
    else
    {
        auto it = mFlagsCache.find(object_id);
        if (it != mFlagsCache.end())
        {
            mFlagsCache.erase(it);
            mDirty = true;
            saveCache();
        }
    }

    return flags;
}

void PKMirrorFlags::saveCache()
{
    if (mCacheFileName.empty())
    {
        return;
    }

    LLSD data = LLSD::emptyMap();
    for (const auto& [id, flags] : mFlagsCache)
    {
        data[id.asString()] = (S32)flags;
    }

    llofstream file(mCacheFileName.c_str());
    if (file.is_open())
    {
        LLSDSerialize::toPrettyXML(data, file);
        file.close();
    }

    mDirty = false;
}

void PKMirrorFlags::loadCache()
{
    if (mCacheFileName.empty() || !gDirUtilp->fileExists(mCacheFileName))
    {
        return;
    }

    llifstream file(mCacheFileName.c_str());
    if (file.is_open())
    {
        LLSD data;
        if (LLSDSerialize::fromXML(data, file) >= 1)
        {
            for (LLSD::map_const_iterator it = data.beginMap(); it != data.endMap(); ++it)
            {
                LLUUID id(it->first);
                if (id.notNull())
                {
                    U8 flags = (U8)it->second.asInteger();
                    if (flags != 0)
                    {
                        mFlagsCache[id] = flags;
                    }
                }
            }
        }
        file.close();
    }

    LL_INFOS("PKMirror") << "Loaded " << mFlagsCache.size() << " mirror flag entries from cache" << LL_ENDL;
}

void PKMirrorFlags::updateNotecard(const LLUUID& object_id, U8 flags, LLViewerObject* obj)
{
    if (!obj) return;

    // Remove any existing .pk_mirror_* notecard first (removeNotecard scans ALL
    // items in the object, removing every match - handles server-appended suffixes
    // like ".pk_mirror_100 1" from prior duplicates)
    removeNotecard(object_id, obj);

    // Create the notecard name from flags (e.g. ".pk_mirror_100" for X-mirrored)
    std::string name = flagsToNotecardName(flags);

    // IMPORTANT: Create in Trash (FT_TRASH), not Notecards. FT_TRASH is a "quiet"
    // folder in LLViewerFolderDictionary that suppresses LLOpenTaskOffer notifications.
    // Creating in Notecards would trigger open_inventory_offer() → preview_notecard
    // floater → "object does not exist in database" error (since the notecard is
    // immediately moved to task inventory and deleted from agent inventory).
    LLUUID parent_id = gInventory.findCategoryUUIDForType(LLFolderType::FT_TRASH);

    // Capture object_id for the async callback
    LLUUID obj_id = object_id;

    // Create a callback that copies the notecard to the object's task inventory
    LLPointer<LLInventoryCallback> cb = new LLBoostFuncInventoryCallback(
        [obj_id](const LLUUID& inv_item_id)
        {
            LLViewerInventoryItem* item = gInventory.getItem(inv_item_id);
            if (!item) return;

            // Find the object - it may have been deselected/deleted since we started
            LLViewerObject* obj = gObjectList.findObject(obj_id);
            if (obj)
            {
                // Copy the notecard into the object's task inventory
                LLPointer<LLViewerInventoryItem> task_item = new LLViewerInventoryItem(item);
                task_item->setCreationDate(time_corrected());
                obj->updateInventory(task_item, TASK_INVENTORY_ITEM_KEY, true);
            }

            // Clean up: remove temp notecard from local inventory model
            // (it was created in Trash, server will purge it on next trash empty)
            gInventory.deleteObject(inv_item_id);
            gInventory.notifyObservers();
        }
    );

    // Create a temporary notecard in agent inventory - server assigns the asset UUID
    LLTransactionID tid;
    tid.generate();

    create_inventory_item(
        gAgent.getID(),
        gAgent.getSessionID(),
        parent_id,
        tid,
        name,
        "PyroKitty mirror flags",
        LLAssetType::AT_NOTECARD,
        LLInventoryType::IT_NOTECARD,
        NO_INV_SUBTYPE,
        PERM_ALL,
        cb
    );
}

void PKMirrorFlags::removeNotecard(const LLUUID& object_id, LLViewerObject* obj)
{
    if (!obj) return;

    // Scan existing inventory for all .pk_mirror_* notecards and remove them
    LLInventoryObject::object_list_t contents;
    obj->getInventoryContents(contents);

    for (const auto& item : contents)
    {
        if (item && notecardNameToFlags(item->getName()) != 0)
        {
            obj->removeInventory(item->getUUID());
        }
    }
}

std::string PKMirrorFlags::flagsToNotecardName(U8 flags) const
{
    char name[16];
    snprintf(name, sizeof(name), ".pk_mirror_%d%d%d",
             (flags & PK_MIRROR_X) ? 1 : 0,
             (flags & PK_MIRROR_Y) ? 1 : 0,
             (flags & PK_MIRROR_Z) ? 1 : 0);
    return std::string(name);
}

U8 PKMirrorFlags::notecardNameToFlags(const std::string& name) const
{
    // Match ".pk_mirror_XYZ" with optional server-appended suffix.
    // SL servers append " 1", " 2" etc when duplicate item names exist in task
    // inventory, so ".pk_mirror_100" may become ".pk_mirror_100 1". We use
    // length >= 14 (not == 14) to accept these suffixes.
    if (name.length() < 14 || name.substr(0, 11) != ".pk_mirror_")
    {
        return 0;
    }

    // Characters 11-13 must be '0' or '1'
    for (int i = 11; i <= 13; ++i)
    {
        if (name[i] != '0' && name[i] != '1') return 0;
    }

    U8 flags = 0;
    if (name[11] == '1') flags |= PK_MIRROR_X;
    if (name[12] == '1') flags |= PK_MIRROR_Y;
    if (name[13] == '1') flags |= PK_MIRROR_Z;
    return flags;
}
