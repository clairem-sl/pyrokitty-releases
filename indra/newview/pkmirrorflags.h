/**
 * @file pkmirrorflags.h
 * @brief Per-axis mirror flags for objects (PyroKitty feature)
 *
 * <FS:Pyrokitty> Negative dimensions / per-axis mirroring
 */

#ifndef PK_MIRROR_FLAGS_H
#define PK_MIRROR_FLAGS_H

#include "llsingleton.h"
#include "lluuid.h"
#include "llinventory.h"

#include <unordered_map>

// Mirror flag constants
constexpr U8 PK_MIRROR_X = 0x1;
constexpr U8 PK_MIRROR_Y = 0x2;
constexpr U8 PK_MIRROR_Z = 0x4;

class LLViewerObject;

class PKMirrorFlags : public LLSingleton<PKMirrorFlags>
{
    LLSINGLETON(PKMirrorFlags);
    ~PKMirrorFlags();

public:
    void init();

    // Get mirror flags for an object (fast local cache lookup)
    U8 getFlags(const LLUUID& object_id) const;

    // Set mirror flags - updates local cache and creates/removes notecard in object
    void setFlags(const LLUUID& object_id, U8 flags, LLViewerObject* obj);

    // Clear all mirror flags for an object
    void clearFlags(const LLUUID& object_id, LLViewerObject* obj);

    // Scan object inventory for .pk_mirror_* notecard and update local cache
    // Returns the flags found (0 if none)
    U8 syncFromInventory(const LLUUID& object_id, const LLInventoryObject::object_list_t& inv);

    // Persist notecard for an object whose flags were set without a notecard (e.g. during drag)
    void persistNotecard(const LLUUID& object_id, LLViewerObject* obj);

    void saveCache();
    void loadCache();

private:
    void updateNotecard(const LLUUID& object_id, U8 flags, LLViewerObject* obj);
    void removeNotecard(const LLUUID& object_id, LLViewerObject* obj);
    std::string flagsToNotecardName(U8 flags) const;
    U8 notecardNameToFlags(const std::string& name) const;

    std::unordered_map<LLUUID, U8> mFlagsCache;
    std::string mCacheFileName;
    bool mDirty = false;
};

#endif // PK_MIRROR_FLAGS_H
