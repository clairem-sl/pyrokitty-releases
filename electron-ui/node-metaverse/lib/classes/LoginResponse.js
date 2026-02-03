"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoginResponse = void 0;
const UUID_1 = require("./UUID");
const Agent_1 = require("./Agent");
const Region_1 = require("./Region");
const Vector3_1 = require("./Vector3");
const long_1 = __importDefault(require("long"));
const InventoryFolder_1 = require("./InventoryFolder");
const __1 = require("..");
const InventoryLibrary_1 = require("../enums/InventoryLibrary");
class LoginResponse {
    loginFlags;
    loginMessage;
    agent;
    region;
    events = {
        categories: []
    };
    classifieds = {
        categories: []
    };
    searchToken;
    mfaHash;
    clientEvents;
    // Benefits data for external login handoff
    accountType;
    accountLevelBenefits;
    premiumPackages;
    constructor(json, clientEvents, options) {
        this.clientEvents = clientEvents;
        this.agent = new Agent_1.Agent(this.clientEvents);
        this.region = new Region_1.Region(this.agent, this.clientEvents, options);
        if (json.agent_id) {
            this.agent.agentID = new UUID_1.UUID(json.agent_id);
        }
        for (const key of Object.keys(json)) {
            const val = json[key];
            switch (key) {
                case 'inventory-skeleton':
                    for (const item of val) {
                        const folder = new InventoryFolder_1.InventoryFolder(InventoryLibrary_1.InventoryLibrary.Main, this.agent.inventory.main, this.agent);
                        folder.typeDefault = parseInt(item.type_default, 10);
                        folder.version = parseInt(item.version, 10);
                        folder.name = String(item.name);
                        folder.folderID = new UUID_1.UUID(item.folder_id);
                        folder.parentID = new UUID_1.UUID(item.parent_id);
                        this.agent.inventory.main.skeleton.set(folder.folderID.toString(), folder);
                    }
                    break;
                case 'inventory-skel-lib':
                    for (const item of val) {
                        const folder = new InventoryFolder_1.InventoryFolder(InventoryLibrary_1.InventoryLibrary.Library, this.agent.inventory.library, this.agent);
                        folder.typeDefault = parseInt(item.type_default, 10);
                        folder.version = parseInt(item.version, 10);
                        folder.name = String(item.name);
                        folder.folderID = new UUID_1.UUID(item.folder_id);
                        folder.parentID = new UUID_1.UUID(item.parent_id);
                        this.agent.inventory.library.skeleton.set(folder.folderID.toString(), folder);
                    }
                    break;
                case 'inventory-root':
                    {
                        this.agent.inventory.main.root = new UUID_1.UUID(val[0].folder_id);
                        const folder = new InventoryFolder_1.InventoryFolder(InventoryLibrary_1.InventoryLibrary.Main, this.agent.inventory.main, this.agent);
                        folder.typeDefault = 0;
                        folder.version = 0;
                        folder.name = 'root';
                        folder.folderID = new UUID_1.UUID(val[0].folder_id);
                        folder.parentID = UUID_1.UUID.zero();
                        this.agent.inventory.main.skeleton.set(folder.folderID.toString(), folder);
                        break;
                    }
                case 'inventory-lib-owner':
                    this.agent.inventory.library.owner = new UUID_1.UUID(val[0].agent_id);
                    break;
                case 'inventory-lib-root':
                    {
                        this.agent.inventory.library.root = new UUID_1.UUID(val[0].folder_id);
                        const folder = new InventoryFolder_1.InventoryFolder(InventoryLibrary_1.InventoryLibrary.Library, this.agent.inventory.library, this.agent);
                        folder.typeDefault = 0;
                        folder.version = 0;
                        folder.name = 'root';
                        folder.folderID = new UUID_1.UUID(val[0].folder_id);
                        folder.parentID = UUID_1.UUID.zero();
                        this.agent.inventory.library.skeleton.set(folder.folderID.toString(), folder);
                        break;
                    }
                case 'agent_access_max':
                    this.agent.accessMax = String(val);
                    break;
                case 'event_notifications':
                    // dunno what this does just yet
                    break;
                case 'secure_session_id':
                    this.region.circuit.secureSessionID = new UUID_1.UUID(val);
                    break;
                case 'openid_token':
                    this.agent.openID.token = String(val);
                    break;
                case 'region_x':
                    this.region.xCoordinate = parseInt(val, 10);
                    break;
                case 'ao_transition':
                    this.agent.AOTransition = (val !== 0);
                    break;
                case 'global-textures':
                    for (const obj of val) {
                        if (obj.cloud_texture_id) {
                            this.region.textures.cloudTextureID = obj.cloud_texture_id;
                        }
                        if (obj.sun_texture_id) {
                            this.region.textures.sunTextureID = obj.sun_texture_id;
                        }
                        if (obj.moon_texture_id) {
                            this.region.textures.moonTextureID = obj.moon_texture_id;
                        }
                    }
                    break;
                case 'mfa_hash':
                    this.mfaHash = String(val);
                    break;
                case 'search_token':
                    this.searchToken = String(val);
                    break;
                case 'login-flags':
                    {
                        let flags = 0;
                        for (const obj of val) {
                            if (obj.ever_logged_in === 'Y') {
                                flags = flags | __1.LoginFlags.everLoggedIn;
                            }
                            if (obj.daylight_savings === 'Y') {
                                flags = flags | __1.LoginFlags.daylightSavings;
                            }
                            if (obj.stipend_since_login === 'Y') {
                                flags = flags | __1.LoginFlags.stipendSinceLogin;
                            }
                            if (obj.gendered === 'Y') {
                                flags = flags | __1.LoginFlags.gendered;
                            }
                        }
                        this.loginFlags = flags;
                        break;
                    }
                case 'buddy-list':
                    {
                        for (const obj of val) {
                            this.agent.buddyList.push({
                                buddyRightsGiven: obj.buddy_rights_given !== 0,
                                buddyID: new UUID_1.UUID(obj.buddy_id),
                                buddyRightsHas: obj.buddy_rights_has !== 0,
                            });
                        }
                        break;
                    }
                case 'sim_port':
                    this.region.circuit.port = parseInt(val, 10);
                    break;
                case 'sim_ip':
                    this.region.circuit.ipAddress = String(val);
                    break;
                case 'agent_appearance_service':
                    {
                        this.agent.agentAppearanceService = val;
                        break;
                    }
                case 'ui-config':
                    for (const item of val) {
                        if (item.allow_first_life === 'Y') {
                            this.agent.uiFlags.allowFirstLife = true;
                        }
                    }
                    break;
                case 'look_at':
                    try {
                        this.agent.cameraLookAt = LoginResponse.parseVector3(val);
                    }
                    catch (_error) {
                        console.error('Invalid look_at from LoginResponse');
                    }
                    break;
                case 'openid_url':
                    this.agent.openID.url = String(val);
                    break;
                case 'max-agent-groups':
                    this.agent.maxGroups = parseInt(val, 10);
                    break;
                case 'session_id':
                    this.region.circuit.sessionID = new UUID_1.UUID(val);
                    break;
                case 'agent_flags':
                    this.agent.agentFlags = parseInt(val, 10);
                    break;
                case 'event_categories':
                    for (const item of val) {
                        this.events.categories.push({
                            'categoryID': parseInt(item.category_id, 10),
                            'categoryName': String(item.category_name)
                        });
                    }
                    break;
                case 'start_location':
                    this.agent.startLocation = String(val);
                    break;
                case 'agent_region_access':
                    this.agent.regionAccess = String(val);
                    break;
                case 'last_name':
                    this.agent.lastName = String(val);
                    break;
                case 'cof_version':
                    this.agent.cofVersion = parseInt(val, 10);
                    break;
                case 'home':
                    this.agent.home = LoginResponse.parseHome(val);
                    break;
                case 'classified_categories':
                    for (const item of val) {
                        this.classifieds.categories.push({
                            'categoryID': parseInt(item.category_id, 10),
                            'categoryName': String(item.category_name)
                        });
                    }
                    break;
                case 'snapshot_config_url':
                    this.agent.snapshotConfigURL = String(val);
                    break;
                case 'region_y':
                    this.region.yCoordinate = parseInt(val, 10);
                    break;
                case 'agent_access':
                    this.agent.agentAccess = String(val);
                    break;
                case 'circuit_code':
                    this.region.circuit.circuitCode = parseInt(val, 10);
                    break;
                case 'message':
                    this.loginMessage = String(val);
                    break;
                case 'gestures':
                    for (const item of val) {
                        this.agent.gestures.push({
                            'assetID': new UUID_1.UUID(item.asset_id),
                            'itemID': new UUID_1.UUID(item.item_id)
                        });
                    }
                    break;
                case 'udp_blacklist':
                    {
                        const list = String(val).split(',');
                        this.region.circuit.udpBlacklist = list;
                        break;
                    }
                case 'seconds_since_epoch':
                    this.region.circuit.timestamp = parseInt(val, 10);
                    break;
                case 'seed_capability':
                    this.region.activateCaps(String(val));
                    break;
                case 'first_name':
                    this.agent.firstName = String(val).replace(/"/g, '');
                    break;
                case 'account_type':
                    this.accountType = String(val);
                    break;
                case 'account_level_benefits':
                    this.accountLevelBenefits = {
                        animated_object_limit: parseInt(val.animated_object_limit, 10) || 0,
                        animation_upload_cost: parseInt(val.animation_upload_cost, 10) || 0,
                        attachment_limit: parseInt(val.attachment_limit, 10) || 0,
                        create_group_cost: parseInt(val.create_group_cost, 10) || 0,
                        group_membership_limit: parseInt(val.group_membership_limit, 10) || 0,
                        picks_limit: parseInt(val.picks_limit, 10) || 0,
                        sound_upload_cost: parseInt(val.sound_upload_cost, 10) || 0,
                        texture_upload_cost: parseInt(val.texture_upload_cost, 10) || 0,
                    };
                    if (val.large_texture_upload_cost && Array.isArray(val.large_texture_upload_cost)) {
                        this.accountLevelBenefits.large_texture_upload_cost = val.large_texture_upload_cost.map((v) => parseInt(v, 10));
                    }
                    break;
                case 'premium_packages':
                    this.premiumPackages = val;
                    break;
            }
        }
        this.agent.setCurrentRegion(this.region);
    }
    static toRegionHandle(x_global, y_global) {
        let x_origin = x_global;
        x_origin -= x_origin % 256;
        let y_origin = y_global;
        y_origin -= y_origin % 256;
        return new long_1.default(x_origin, y_origin, true);
    }
    static parseVector3(str) {
        const num = str.replace(/[[\]r\s]/g, '').split(',');
        const x = parseFloat(num[0]);
        const y = parseFloat(num[1]);
        const z = parseFloat(num[2]);
        if (isNaN(x) || isNaN(y) || isNaN(z)) {
            throw new Error('Invalid Vector');
        }
        return new Vector3_1.Vector3([x, y, z]);
    }
    static parseHome(home) {
        const result = {};
        let parseStart = null;
        if (typeof home === 'string') {
            const json = home.replace(/[[\]']/g, '"');
            parseStart = JSON.parse(json);
        }
        else {
            parseStart = home;
        }
        const parsed = parseStart;
        if (parsed.region_handle) {
            const coords = parsed.region_handle.replace(/r/g, '').split(', ');
            result.regionHandle = LoginResponse.toRegionHandle(parseInt(coords[0], 10), parseInt(coords[1], 10));
        }
        if (parsed.position) {
            try {
                result.position = this.parseVector3('[' + parsed.position + ']');
            }
            catch (_error) {
                result.position = new Vector3_1.Vector3([128.0, 128.0, 0.0]);
            }
        }
        if (parsed.look_at) {
            try {
                result.lookAt = this.parseVector3('[' + parsed.look_at + ']');
            }
            catch (_error) {
                result.lookAt = new Vector3_1.Vector3([128.0, 128.0, 0.0]);
            }
        }
        return result;
    }
}
exports.LoginResponse = LoginResponse;
//# sourceMappingURL=LoginResponse.js.map