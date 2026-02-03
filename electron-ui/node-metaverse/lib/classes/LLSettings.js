"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLSettings = void 0;
const LLSDReal_1 = require("./llsd/LLSDReal");
const UUID_1 = require("./UUID");
const LLSDMap_1 = require("./llsd/LLSDMap");
const Vector4_1 = require("./Vector4");
const LLSD_1 = require("./llsd/LLSD");
const LLSDArray_1 = require("./llsd/LLSDArray");
const LLSDInteger_1 = require("./llsd/LLSDInteger");
class LLSettings {
    assetID;
    flags;
    absorptionConfig;
    bloomID;
    cloudColor;
    cloudID;
    cloudPosDensity1;
    cloudPosDensity2;
    cloudScale;
    cloudScrollRate;
    cloudShadow;
    cloudVariance;
    domeOffset;
    domeRadius;
    dropletRadius;
    gamma;
    glow;
    haloID;
    iceLevel;
    legacyHaze;
    maxY;
    mieConfig;
    moistureLevel;
    moonBrightness;
    moonID;
    moonRotation;
    moonScale;
    name;
    planetRadius;
    rainbowID;
    rayleighConfig;
    skyBottomRadius;
    skyTopRadius;
    starBrightness;
    sunArcRadians;
    sunID;
    sunRotation;
    sunScale;
    sunlightColor;
    type;
    tracks;
    frames;
    blurMultiplier;
    fresnelOffset;
    fresnelScale;
    normalMap;
    normalScale;
    scaleAbove;
    scaleBelow;
    underwaterFogMod;
    waterFogColor;
    waterFogDensity;
    wave1Direction;
    wave2Direction;
    constructor(data) {
        if (data !== undefined) {
            let settings = null;
            if (typeof data === 'string') {
                if (data.startsWith('<?llsd/binary?>')) {
                    settings = LLSD_1.LLSD.parseBinary(Buffer.from(data, 'utf-8'));
                }
                else {
                    settings = LLSD_1.LLSD.parseNotation(data);
                }
            }
            else {
                settings = data;
            }
            if (settings.asset_id) {
                this.assetID = settings.asset_id;
            }
            if (settings.flags !== undefined) {
                this.flags = settings.flags.valueOf();
            }
            if (Array.isArray(settings.absorption_config)) {
                this.absorptionConfig = [];
                for (const conf of settings.absorption_config) {
                    this.absorptionConfig.push({
                        constantTerm: LLSettings.validateLLSDReal(conf.constant_term).valueOf(),
                        expScale: LLSettings.validateLLSDReal(conf.exp_scale).valueOf(),
                        expTerm: LLSettings.validateLLSDReal(conf.exp_term).valueOf(),
                        linearTerm: LLSettings.validateLLSDReal(conf.linear_term).valueOf(),
                        width: LLSettings.validateLLSDReal(conf.width).valueOf()
                    });
                }
            }
            if (settings.bloom_id !== undefined) {
                this.bloomID = LLSettings.validateUUID(settings.bloom_id);
            }
            if (settings.cloud_color !== undefined) {
                this.cloudColor = LLSDArray_1.LLSDArray.toVector3(settings.cloud_color);
            }
            if (settings.cloud_id !== undefined) {
                this.cloudID = LLSettings.validateUUID(settings.cloud_id);
            }
            if (settings.cloud_pos_density1 !== undefined) {
                this.cloudPosDensity1 = LLSDArray_1.LLSDArray.toVector3(settings.cloud_pos_density1);
            }
            if (settings.cloud_pos_density2 !== undefined) {
                this.cloudPosDensity2 = LLSDArray_1.LLSDArray.toVector3(settings.cloud_pos_density2);
            }
            if (settings.cloud_scale !== undefined) {
                this.cloudScale = LLSettings.validateLLSDReal(settings.cloud_scale).valueOf();
            }
            if (settings.cloud_scroll_rate !== undefined) {
                this.cloudScrollRate = LLSDArray_1.LLSDArray.toVector2(settings.cloud_scroll_rate);
            }
            if (settings.cloud_shadow !== undefined) {
                this.cloudShadow = LLSettings.validateLLSDReal(settings.cloud_shadow).valueOf();
            }
            if (settings.cloud_variance !== undefined) {
                this.cloudVariance = LLSettings.validateLLSDReal(settings.cloud_variance).valueOf();
            }
            if (settings.dome_offset !== undefined) {
                this.domeOffset = LLSettings.validateLLSDReal(settings.dome_offset).valueOf();
            }
            if (settings.dome_radius !== undefined) {
                this.domeRadius = LLSettings.validateLLSDReal(settings.dome_radius).valueOf();
            }
            if (settings.droplet_radius !== undefined) {
                this.dropletRadius = LLSettings.validateLLSDReal(settings.droplet_radius).valueOf();
            }
            if (settings.gamma !== undefined) {
                this.gamma = LLSettings.validateLLSDReal(settings.gamma).valueOf();
            }
            if (settings.glow !== undefined) {
                this.glow = LLSDArray_1.LLSDArray.toVector3(settings.glow);
            }
            if (settings.halo_id !== undefined) {
                this.haloID = LLSettings.validateUUID(settings.halo_id);
            }
            if (settings.ice_level !== undefined) {
                this.iceLevel = LLSettings.validateLLSDReal(settings.ice_level).valueOf();
            }
            if (settings.legacy_haze !== undefined) {
                this.legacyHaze = {
                    ambient: settings.legacy_haze.ambient !== undefined ? LLSDArray_1.LLSDArray.toVector3(settings.legacy_haze.ambient) : undefined,
                    blueDensity: settings.legacy_haze.blue_density !== undefined ? LLSDArray_1.LLSDArray.toVector3(settings.legacy_haze.blue_density) : undefined,
                    blueHorizon: settings.legacy_haze.blue_horizon !== undefined ? LLSDArray_1.LLSDArray.toVector3(settings.legacy_haze.blue_horizon) : undefined,
                    densityMultiplier: settings.legacy_haze.density_multiplier !== undefined ? LLSettings.validateLLSDReal(settings.legacy_haze.density_multiplier).valueOf() : undefined,
                    distanceMultiplier: settings.legacy_haze.distance_multiplier !== undefined ? LLSettings.validateLLSDReal(settings.legacy_haze.distance_multiplier).valueOf() : undefined,
                    hazeDensity: settings.legacy_haze.haze_density !== undefined ? LLSettings.validateLLSDReal(settings.legacy_haze.haze_density).valueOf() : undefined,
                    hazeHorizon: settings.legacy_haze.haze_horizon !== undefined ? LLSettings.validateLLSDReal(settings.legacy_haze.haze_horizon).valueOf() : undefined
                };
            }
            if (settings.max_y !== undefined) {
                this.maxY = LLSettings.validateLLSDReal(settings.max_y).valueOf();
            }
            if (settings.mie_config !== undefined) {
                this.mieConfig = [];
                for (const mie of settings.mie_config) {
                    this.mieConfig.push({
                        anisotropy: LLSettings.getRealOrUndef(mie.anisotropy),
                        constantTerm: LLSettings.validateLLSDReal(mie.constant_term).valueOf(),
                        expScale: LLSettings.validateLLSDReal(mie.exp_scale).valueOf(),
                        expTerm: LLSettings.validateLLSDReal(mie.exp_term).valueOf(),
                        linearTerm: LLSettings.validateLLSDReal(mie.linear_term).valueOf(),
                        width: LLSettings.validateLLSDReal(mie.width).valueOf()
                    });
                }
            }
            if (settings.moisture_level !== undefined) {
                this.moistureLevel = LLSettings.validateLLSDReal(settings.moisture_level).valueOf();
            }
            if (settings.moon_brightness !== undefined) {
                this.moonBrightness = LLSettings.validateLLSDReal(settings.moon_brightness).valueOf();
            }
            if (settings.moon_id !== undefined) {
                this.moonID = LLSettings.validateUUID(settings.moon_id);
            }
            if (settings.moon_rotation !== undefined) {
                this.moonRotation = LLSDArray_1.LLSDArray.toQuaternion(settings.moon_rotation);
            }
            if (settings.moon_scale !== undefined) {
                this.moonScale = LLSettings.validateLLSDReal(settings.moon_scale).valueOf();
            }
            if (settings.name !== undefined) {
                this.name = settings.name;
            }
            if (settings.planet_radius !== undefined) {
                this.planetRadius = LLSettings.validateLLSDReal(settings.planet_radius).valueOf();
            }
            if (settings.rainbow_id !== undefined) {
                this.rainbowID = LLSettings.validateUUID(settings.rainbow_id);
            }
            if (Array.isArray(settings.rayleigh_config)) {
                this.rayleighConfig = [];
                for (const ray of settings.rayleigh_config) {
                    this.rayleighConfig.push({
                        anisotropy: LLSettings.getRealOrUndef(ray.anisotropy),
                        constantTerm: LLSettings.validateLLSDReal(ray.constant_term).valueOf(),
                        expScale: LLSettings.validateLLSDReal(ray.exp_scale).valueOf(),
                        expTerm: LLSettings.validateLLSDReal(ray.exp_term).valueOf(),
                        linearTerm: LLSettings.validateLLSDReal(ray.linear_term).valueOf(),
                        width: LLSettings.validateLLSDReal(ray.width).valueOf()
                    });
                }
            }
            if (settings.sky_bottom_radius !== undefined) {
                this.skyBottomRadius = LLSettings.validateLLSDReal(settings.sky_bottom_radius).valueOf();
            }
            if (settings.sky_top_radius !== undefined) {
                this.skyTopRadius = LLSettings.validateLLSDReal(settings.sky_top_radius).valueOf();
            }
            if (settings.star_brightness !== undefined) {
                this.starBrightness = LLSettings.validateLLSDReal(settings.star_brightness).valueOf();
            }
            if (settings.sun_arc_radians !== undefined) {
                this.sunArcRadians = LLSettings.validateLLSDReal(settings.sun_arc_radians).valueOf();
            }
            if (settings.sun_id !== undefined) {
                this.sunID = LLSettings.validateUUID(settings.sun_id);
            }
            if (settings.sun_rotation !== undefined) {
                this.sunRotation = LLSDArray_1.LLSDArray.toQuaternion(settings.sun_rotation);
            }
            if (settings.sun_scale !== undefined) {
                this.sunScale = LLSettings.validateLLSDReal(settings.sun_scale).valueOf();
            }
            if (settings.sunlight_color !== undefined) {
                if (settings?.sunlight_color.length === 4) {
                    this.sunlightColor = LLSDArray_1.LLSDArray.toVector4(settings.sunlight_color);
                }
                else {
                    this.sunlightColor = LLSDArray_1.LLSDArray.toVector3(settings.sunlight_color);
                }
            }
            if (settings.type !== undefined) {
                this.type = settings.type;
            }
            if (settings.tracks !== undefined) {
                this.tracks = [];
                for (const track of settings.tracks) {
                    const t = [];
                    for (const tr of track) {
                        t.push({
                            keyKeyframe: LLSettings.validateLLSDReal(tr.key_keyframe).valueOf(),
                            keyName: LLSettings.validateString(tr.key_name).valueOf()
                        });
                    }
                    this.tracks.push(t);
                }
            }
            if (settings.frames !== undefined) {
                this.frames = new Map();
                for (const keyFrame of Object.keys(settings.frames)) {
                    const frame = settings.frames[keyFrame];
                    this.frames.set(keyFrame, new LLSettings(frame));
                }
            }
            if (settings.blur_multiplier !== undefined) {
                this.blurMultiplier = LLSettings.validateLLSDReal(settings.blur_multiplier).valueOf();
            }
            if (settings.fresnel_offset !== undefined) {
                this.fresnelOffset = LLSettings.validateLLSDReal(settings.fresnel_offset).valueOf();
            }
            if (settings.fresnel_scale !== undefined) {
                this.fresnelScale = LLSettings.validateLLSDReal(settings.fresnel_scale).valueOf();
            }
            if (settings.normal_map !== undefined) {
                this.normalMap = LLSettings.validateUUID(settings.normal_map);
            }
            if (settings.normal_scale !== undefined) {
                this.normalScale = LLSDArray_1.LLSDArray.toVector3(settings.normal_scale);
            }
            if (settings.scale_above !== undefined) {
                this.scaleAbove = LLSettings.validateLLSDReal(settings.scale_above).valueOf();
            }
            if (settings.scale_below !== undefined) {
                this.scaleBelow = LLSettings.validateLLSDReal(settings.scale_below).valueOf();
            }
            if (settings.underwater_fog_mod !== undefined) {
                this.underwaterFogMod = LLSettings.validateLLSDReal(settings.underwater_fog_mod).valueOf();
            }
            if (settings.water_fog_color !== undefined) {
                this.waterFogColor = LLSDArray_1.LLSDArray.toVector3(settings.water_fog_color);
            }
            if (settings.water_fog_density !== undefined) {
                this.waterFogDensity = LLSettings.validateLLSDReal(settings.water_fog_density).valueOf();
            }
            if (settings.wave1_direction !== undefined) {
                this.wave1Direction = LLSDArray_1.LLSDArray.toVector2(settings.wave1_direction);
            }
            if (settings.wave2_direction !== undefined) {
                this.wave2Direction = LLSDArray_1.LLSDArray.toVector2(settings.wave2_direction);
            }
        }
    }
    static encodeSettings(settings) {
        return new LLSDMap_1.LLSDMap({
            asset_id: settings.assetID,
            flags: settings.flags !== undefined ? new LLSDInteger_1.LLSDInteger(settings.flags) : undefined,
            absorption_config: LLSettings.encodeTermConfig(settings.absorptionConfig),
            bloom_id: settings.bloomID,
            cloud_color: LLSDArray_1.LLSDArray.fromVector3(settings.cloudColor),
            cloud_id: settings.cloudID,
            cloud_pos_density1: LLSDArray_1.LLSDArray.fromVector3(settings.cloudPosDensity1),
            cloud_pos_density2: LLSDArray_1.LLSDArray.fromVector3(settings.cloudPosDensity2),
            cloud_scale: LLSDReal_1.LLSDReal.parseReal(settings.cloudScale),
            cloud_scroll_rate: LLSDArray_1.LLSDArray.fromVector2(settings.cloudScrollRate),
            cloud_shadow: LLSDReal_1.LLSDReal.parseReal(settings.cloudShadow),
            cloud_variance: LLSDReal_1.LLSDReal.parseReal(settings.cloudVariance),
            dome_offset: LLSDReal_1.LLSDReal.parseReal(settings.domeOffset),
            dome_radius: LLSDReal_1.LLSDReal.parseReal(settings.domeRadius),
            droplet_radius: LLSDReal_1.LLSDReal.parseReal(settings.dropletRadius),
            gamma: LLSDReal_1.LLSDReal.parseReal(settings.gamma),
            glow: LLSDArray_1.LLSDArray.fromVector3(settings.glow),
            halo_id: LLSettings.validateUUID(settings.haloID),
            ice_level: LLSDReal_1.LLSDReal.parseReal(settings.iceLevel),
            legacy_haze: LLSettings.encodeHazeConfig(settings.legacyHaze),
            max_y: LLSDReal_1.LLSDReal.parseReal(settings.maxY),
            mie_config: LLSettings.encodeTermConfig(settings.mieConfig),
            moisture_level: LLSDReal_1.LLSDReal.parseReal(settings.moistureLevel),
            moon_brightness: LLSDReal_1.LLSDReal.parseReal(settings.moonBrightness),
            moon_id: LLSettings.validateUUID(settings.moonID),
            moon_rotation: LLSDArray_1.LLSDArray.fromQuaternion(settings.moonRotation),
            moon_scale: LLSDReal_1.LLSDReal.parseReal(settings.moonScale),
            name: settings.name,
            planet_radius: LLSDReal_1.LLSDReal.parseReal(settings.planetRadius),
            rainbow_id: settings.rainbowID,
            rayleigh_config: LLSettings.encodeTermConfig(settings.rayleighConfig),
            sky_bottom_radius: LLSDReal_1.LLSDReal.parseReal(settings.skyBottomRadius),
            sky_top_radius: LLSDReal_1.LLSDReal.parseReal(settings.skyTopRadius),
            star_brightness: LLSDReal_1.LLSDReal.parseReal(settings.starBrightness),
            sun_arc_radians: LLSDReal_1.LLSDReal.parseReal(settings.sunArcRadians),
            sun_id: LLSettings.validateUUID(settings.sunID),
            sun_rotation: LLSDArray_1.LLSDArray.fromQuaternion(settings.sunRotation),
            sun_scale: LLSDReal_1.LLSDReal.parseReal(settings.sunScale),
            sunlight_color: (settings.sunlightColor instanceof Vector4_1.Vector4) ? LLSDArray_1.LLSDArray.fromVector4(settings.sunlightColor) : LLSDArray_1.LLSDArray.fromVector3(settings.sunlightColor),
            type: settings.type,
            frames: LLSettings.encodeFrames(settings.frames),
            tracks: LLSettings.encodeTracks(settings.tracks),
            blur_multiplier: LLSDReal_1.LLSDReal.parseReal(settings.blurMultiplier),
            fresnel_offset: LLSDReal_1.LLSDReal.parseReal(settings.fresnelOffset),
            fresnel_scale: LLSDReal_1.LLSDReal.parseReal(settings.fresnelScale),
            normal_map: LLSettings.validateUUID(settings.normalMap),
            normal_scale: LLSDArray_1.LLSDArray.fromVector3(settings.normalScale),
            scale_above: LLSDReal_1.LLSDReal.parseReal(settings.scaleAbove),
            scale_below: LLSDReal_1.LLSDReal.parseReal(settings.scaleBelow),
            underwater_fog_mod: LLSDReal_1.LLSDReal.parseReal(settings.underwaterFogMod),
            water_fog_color: LLSDArray_1.LLSDArray.fromVector3(settings.waterFogColor),
            water_fog_density: LLSDReal_1.LLSDReal.parseReal(settings.waterFogDensity),
            wave1_direction: LLSDArray_1.LLSDArray.fromVector2(settings.wave1Direction),
            wave2_direction: LLSDArray_1.LLSDArray.fromVector2(settings.wave2Direction)
        });
    }
    toAsset() {
        return LLSD_1.LLSD.toNotation(LLSettings.encodeSettings(this));
    }
    static encodeTermConfig(conf) {
        if (conf === undefined) {
            return undefined;
        }
        const termConfig = [];
        for (const entry of conf) {
            termConfig.push(new LLSDMap_1.LLSDMap({
                anisotropy: LLSDReal_1.LLSDReal.parseReal(entry.anisotropy),
                constant_term: LLSDReal_1.LLSDReal.parseReal(entry.constantTerm),
                exp_scale: LLSDReal_1.LLSDReal.parseReal(entry.expScale),
                exp_term: LLSDReal_1.LLSDReal.parseReal(entry.expTerm),
                linear_term: LLSDReal_1.LLSDReal.parseReal(entry.linearTerm),
                width: LLSDReal_1.LLSDReal.parseReal(entry.width),
            }));
        }
        return termConfig;
    }
    static encodeHazeConfig(conf) {
        if (conf === undefined) {
            return undefined;
        }
        return new LLSDMap_1.LLSDMap({
            ambient: LLSDArray_1.LLSDArray.fromVector3(conf.ambient),
            blue_density: LLSDArray_1.LLSDArray.fromVector3(conf.blueDensity),
            blue_horizon: LLSDArray_1.LLSDArray.fromVector3(conf.blueHorizon),
            density_multiplier: LLSDReal_1.LLSDReal.parseReal(conf.densityMultiplier),
            distance_multiplier: LLSDReal_1.LLSDReal.parseReal(conf.distanceMultiplier),
            haze_density: LLSDReal_1.LLSDReal.parseReal(conf.hazeDensity),
            haze_horizon: LLSDReal_1.LLSDReal.parseReal(conf.hazeHorizon),
        });
    }
    static encodeTracks(tr) {
        if (tr === undefined) {
            return undefined;
        }
        const outerArray = [];
        for (const inner of tr) {
            const innerArray = [];
            for (const m of inner) {
                innerArray.push(new LLSDMap_1.LLSDMap({
                    key_keyframe: new LLSDReal_1.LLSDReal(m.keyKeyframe),
                    key_name: m.keyName
                }));
            }
            outerArray.push(innerArray);
        }
        return outerArray;
    }
    static encodeFrames(fr) {
        if (fr === undefined) {
            return undefined;
        }
        const frames = new LLSDMap_1.LLSDMap();
        for (const frameKey of fr.keys()) {
            const set = fr.get(frameKey);
            if (set === undefined) {
                continue;
            }
            frames.add(frameKey, this.encodeSettings(set));
        }
        return frames;
    }
    static validateString(val) {
        if (typeof val === 'string') {
            return val;
        }
        throw new Error('Value is not a string');
    }
    static getRealOrUndef(val) {
        if (val === undefined) {
            return undefined;
        }
        return LLSettings.validateLLSDReal(val).valueOf();
    }
    static validateLLSDReal(val) {
        if (val instanceof LLSDReal_1.LLSDReal) {
            return val;
        }
        throw new Error('Value is not an LLSDReal');
    }
    static validateUUID(val) {
        if (val === undefined || val === null) {
            return undefined;
        }
        if (val instanceof UUID_1.UUID) {
            return val;
        }
        throw new Error('Value is not a UUID');
    }
}
exports.LLSettings = LLSettings;
//# sourceMappingURL=LLSettings.js.map