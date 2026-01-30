/**
 * @file llmachineid.cpp
 * @brief retrieves unique machine ids
 *
 * $LicenseInfo:firstyear=2009&license=viewerlgpl$
 * Second Life Viewer Source Code
 * Copyright (C) 2010, Linden Research, Inc.
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
 *
 * Linden Research, Inc., 945 Battery Street, San Francisco, CA  94111  USA
 * $/LicenseInfo$
 */

#include "llviewerprecompiledheaders.h"
#include "lluuid.h"
#include "llmachineid.h"

// <FS:Pyrokitty> Use static IDs instead of unique machine identifiers for privacy
static unsigned char static_unique_id[] =  {0x01, 0x02, 0x03, 0x04, 0x05, 0x06};
static unsigned char static_legacy_id[] =  {0x01, 0x02, 0x03, 0x04, 0x05, 0x06};
static bool has_static_unique_id = false;
static bool has_static_legacy_id = false;

S32 LLMachineID::init()
{
    // Use static IDs for privacy - no hardware identification
    has_static_unique_id = true;
    has_static_legacy_id = true;

    LL_INFOS("AppInit") << "Using static machine ID for privacy" << LL_ENDL;

    return 0;
}

S32 LLMachineID::getUniqueID(unsigned char *unique_id, size_t len)
{
    if (has_static_unique_id)
    {
        memcpy(unique_id, &static_unique_id, len);
        return 1;
    }
    return 0;
}

S32 LLMachineID::getLegacyID(unsigned char *unique_id, size_t len)
{
    if (has_static_legacy_id)
    {
        memcpy(unique_id, &static_legacy_id, len);
        return 1;
    }
    return 0;
}
// </FS:Pyrokitty>
