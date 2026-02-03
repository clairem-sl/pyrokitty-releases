"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RegionEnvironment = void 0;
const LLSDMap_1 = require("../llsd/LLSDMap");
const LLSDInteger_1 = require("../llsd/LLSDInteger");
const UUID_1 = require("../UUID");
const LLSettings_1 = require("../LLSettings");
const LLSDArray_1 = require("../llsd/LLSDArray");
const LLSD_1 = require("../llsd/LLSD");
class RegionEnvironment {
    regionID;
    parcelID;
    isDefault;
    envVersion;
    trackAltitudes;
    dayOffset;
    dayNames;
    dayLength;
    dayHash;
    dayCycle;
    constructor(data) {
        if (data instanceof LLSDMap_1.LLSDMap) {
            const d = data;
            if (!d.success || !d.environment) {
                throw new Error('Failed to parse region settings');
            }
            const env = d.environment;
            if (env.day_cycle) {
                this.dayCycle = new LLSettings_1.LLSettings(env.day_cycle);
            }
            if (env.day_hash) {
                this.dayHash = env.day_hash.valueOf();
            }
            if (env.day_length) {
                this.dayLength = env.day_length.valueOf();
            }
            if (env.day_names) {
                this.dayNames = LLSDArray_1.LLSDArray.toStringArray(env.day_names);
            }
            if (env.day_offset) {
                this.dayOffset = env.day_offset.valueOf();
            }
            if (env.env_version) {
                this.envVersion = env.env_version.valueOf();
            }
            if (env.is_default) {
                this.isDefault = env.is_default;
            }
            if (env.parcel_id) {
                if (env.parcel_id instanceof UUID_1.UUID) {
                    this.parcelID = env.parcel_id;
                }
                else {
                    this.parcelID = Number(env.parcel_id.valueOf());
                }
            }
            if (env.region_id) {
                this.regionID = env.region_id;
            }
            if (env.track_altitudes) {
                if (env.track_altitudes.length === 3) {
                    this.trackAltitudes = [
                        env.track_altitudes[0].valueOf(),
                        env.track_altitudes[1].valueOf(),
                        env.track_altitudes[2].valueOf(),
                    ];
                }
            }
        }
    }
    toNotation() {
        const envMap = new LLSDMap_1.LLSDMap();
        if (this.dayCycle !== undefined) {
            envMap.set('day_cycle', LLSettings_1.LLSettings.encodeSettings(this.dayCycle));
        }
        if (this.dayHash !== undefined) {
            envMap.set('day_hash', new LLSDInteger_1.LLSDInteger(this.dayHash));
        }
        if (this.dayLength !== undefined) {
            envMap.set('day_length', new LLSDInteger_1.LLSDInteger(this.dayLength));
        }
        if (this.dayNames !== undefined) {
            envMap.set('day_names', this.dayNames);
        }
        if (this.dayOffset !== undefined) {
            envMap.set('day_offset', new LLSDInteger_1.LLSDInteger(this.dayOffset));
        }
        if (this.envVersion !== undefined) {
            envMap.set('env_version', new LLSDInteger_1.LLSDInteger(this.envVersion));
        }
        if (this.isDefault !== undefined) {
            envMap.set('is_default', this.isDefault);
        }
        if (this.parcelID !== undefined) {
            if (typeof this.parcelID === 'number') {
                envMap.set('parcel_id', new LLSDInteger_1.LLSDInteger(this.parcelID));
            }
            else {
                envMap.set('parcel_id', this.parcelID);
            }
        }
        if (this.regionID !== undefined) {
            envMap.set('region_id', this.regionID);
        }
        if (this.trackAltitudes !== undefined) {
            const arr = [];
            for (const val of this.trackAltitudes) {
                arr.push(new LLSDInteger_1.LLSDInteger(val));
            }
            envMap.set('track_altitudes', arr);
        }
        return LLSD_1.LLSD.toNotation(envMap);
    }
}
exports.RegionEnvironment = RegionEnvironment;
//# sourceMappingURL=RegionEnvironment.js.map