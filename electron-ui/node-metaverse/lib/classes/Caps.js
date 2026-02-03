"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Caps = void 0;
const EventQueueClient_1 = require("./EventQueueClient");
const rxjs_1 = require("rxjs");
const LLSD = __importStar(require("@caspertech/llsd"));
const url = __importStar(require("url"));
const got_1 = __importDefault(require("got"));
const AssetType_1 = require("../enums/AssetType");
const AssetTypeRegistry_1 = require("./AssetTypeRegistry");
class Caps {
    eventQueueClient = null;
    static CAP_INVOCATION_DELAY_MS = {
        'NewFileAgentInventory': 2000,
        'FetchInventory2': 200
    };
    onGotSeedCap = new rxjs_1.Subject();
    gotSeedCap = false;
    capabilities = {};
    clientEvents;
    agent;
    active = false;
    timeLastCapExecuted = {};
    constructor(agent, seedURL, clientEvents) {
        this.agent = agent;
        this.clientEvents = clientEvents;
        const req = [];
        req.push('AbuseCategories');
        req.push('AcceptFriendship');
        req.push('AcceptGroupInvite');
        req.push('AgentPreferences');
        req.push('AgentProfile');
        req.push('AgentState');
        req.push('AttachmentResources');
        req.push('AvatarPickerSearch');
        req.push('AvatarRenderInfo');
        req.push('CharacterProperties');
        req.push('ChatSessionRequest');
        req.push('CopyInventoryFromNotecard');
        req.push('CreateInventoryCategory');
        req.push('DeclineFriendship');
        req.push('DeclineGroupInvite');
        req.push('DispatchRegionInfo');
        req.push('DirectDelivery');
        req.push('EnvironmentSettings');
        req.push('EstateAccess');
        req.push('EstateChangeInfo');
        req.push('EventQueueGet');
        req.push('ExtEnvironment');
        req.push('FetchLib2');
        req.push('FetchLibDescendents2');
        req.push('FetchInventory2');
        req.push('FetchInventoryDescendents2');
        req.push('IncrementCOFVersion');
        req.push('InterestList');
        req.push('InventoryThumbnailUpload');
        req.push('GetDisplayNames');
        req.push('GetExperiences');
        req.push('AgentExperiences');
        req.push('FindExperienceByName');
        req.push('GetExperienceInfo');
        req.push('GetAdminExperiences');
        req.push('GetCreatorExperiences');
        req.push('ExperiencePreferences');
        req.push('GroupExperiences');
        req.push('UpdateExperience');
        req.push('IsExperienceAdmin');
        req.push('IsExperienceContributor');
        req.push('RegionExperiences');
        req.push('ExperienceQuery');
        req.push('GetMesh');
        req.push('GetMesh2');
        req.push('GetMetadata');
        req.push('GetObjectCost');
        req.push('GetObjectPhysicsData');
        req.push('GetTexture');
        req.push('GroupAPIv1');
        req.push('GroupMemberData');
        req.push('GroupProposalBallot');
        req.push('HomeLocation');
        req.push('LandResources');
        req.push('LSLSyntax');
        req.push('MapLayer');
        req.push('MapLayerGod');
        req.push('MeshUploadFlag');
        req.push('ModifyMaterialParams');
        req.push('NavMeshGenerationStatus');
        req.push('NewFileAgentInventory');
        req.push('ObjectAnimation');
        req.push('ObjectMedia');
        req.push('ObjectMediaNavigate');
        req.push('ObjectNavMeshProperties');
        req.push('ParcelPropertiesUpdate');
        req.push('ParcelVoiceInfoRequest');
        req.push('ProductInfoRequest');
        req.push('ProvisionVoiceAccountRequest');
        req.push('ReadOfflineMsgs');
        req.push('RegionObjects');
        req.push('RemoteParcelRequest');
        req.push('RenderMaterials');
        req.push('RequestTextureDownload');
        req.push('RequestTaskInventory');
        req.push('ResourceCostSelected');
        req.push('RetrieveNavMeshSrc');
        req.push('SearchStatRequest');
        req.push('SearchStatTracking');
        req.push('SendPostcard');
        req.push('SendUserReport');
        req.push('SendUserReportWithScreenshot');
        req.push('ServerReleaseNotes');
        req.push('SetDisplayName');
        req.push('SimConsoleAsync');
        req.push('SimulatorFeatures');
        req.push('StartGroupProposal');
        req.push('TerrainNavMeshProperties');
        req.push('TextureStats');
        req.push('UntrustedSimulatorMessage');
        req.push('UpdateAgentInformation');
        req.push('UpdateAgentLanguage');
        req.push('UpdateAvatarAppearance');
        req.push('UpdateGestureAgentInventory');
        req.push('UpdateGestureTaskInventory');
        req.push('UpdateNotecardAgentInventory');
        req.push('UpdateNotecardTaskInventory');
        req.push('UpdateScriptAgent');
        req.push('UpdateScriptTask');
        req.push('UpdateSettingsAgentInventory');
        req.push('UpdateSettingsTaskInventory');
        req.push('UploadAgentProfileImage');
        req.push('UpdateMaterialAgentInventory');
        req.push('UpdateMaterialTaskInventory');
        req.push('UploadBakedTexture');
        req.push('UserInfo');
        req.push('ViewerAsset');
        req.push('ViewerBenefits');
        req.push('ViewerMetrics');
        req.push('ViewerStartAuction');
        req.push('ViewerStats');
        this.active = true;
        this.requestPost(seedURL, LLSD.LLSD.formatXML(req), 'application/llsd+xml').then((resp) => {
            this.capabilities = LLSD.LLSD.parseXML(resp.body);
            this.gotSeedCap = true;
            this.onGotSeedCap.next();
            if (this.capabilities.EventQueueGet) {
                if (this.eventQueueClient !== null) {
                    void this.eventQueueClient.shutdown();
                }
                this.eventQueueClient = new EventQueueClient_1.EventQueueClient(this.agent, this, this.clientEvents);
            }
        }).catch((err) => {
            console.error('Error getting seed capability');
            console.error(err);
        });
    }
    async downloadAsset(uuid, type) {
        if (type === AssetType_1.AssetType.LSLText || type === AssetType_1.AssetType.Notecard) {
            throw new Error('Invalid Syntax');
        }
        const capURL = await this.getCapability('ViewerAsset');
        const assetURL = capURL + '/?' + AssetTypeRegistry_1.AssetTypeRegistry.getTypeName(type) + '_id=' + uuid.toString();
        const response = await got_1.default.get(assetURL, {
            https: {
                rejectUnauthorized: false,
            },
            method: 'GET',
            responseType: 'buffer'
        });
        if (response.statusCode < 200 || response.statusCode > 299) {
            throw new Error(response.body.toString('utf-8'));
        }
        return response.body;
    }
    async requestPost(capURL, data, contentType) {
        const response = await got_1.default.post(capURL, {
            headers: {
                'Content-Length': String(Buffer.byteLength(data)),
                'Content-Type': contentType
            },
            body: data,
            https: {
                rejectUnauthorized: false,
            },
        });
        return { status: response.statusCode, body: response.body };
    }
    async requestPut(capURL, data, contentType) {
        const response = await got_1.default.put(capURL, {
            headers: {
                'Content-Length': String(Buffer.byteLength(data)),
                'Content-Type': contentType
            },
            body: data,
            https: {
                rejectUnauthorized: false,
            },
        });
        return { status: response.statusCode, body: response.body };
    }
    async requestGet(requestURL) {
        const response = await got_1.default.get(requestURL, {
            https: {
                rejectUnauthorized: false,
            },
        });
        return { status: response.statusCode, body: response.body };
    }
    async requestDelete(requestURL) {
        const response = await got_1.default.delete(requestURL, {
            https: {
                rejectUnauthorized: false,
            },
        });
        return { status: response.statusCode, body: response.body };
    }
    async isCapAvailable(capability) {
        await this.waitForSeedCapability();
        return (this.capabilities[capability] !== undefined);
    }
    async getCapability(capability) {
        if (!this.active) {
            throw new Error('Requesting getCapability to an inactive Caps instance');
        }
        await this.waitForSeedCapability();
        if (this.capabilities[capability] !== undefined) {
            return this.capabilities[capability];
        }
        throw new Error('Capability ' + capability + ' not available');
    }
    async capsRequestUpload(capURL, data) {
        const resp = await this.requestPost(capURL, data, 'application/octet-stream');
        try {
            return LLSD.LLSD.parseXML(resp.body);
        }
        catch (err) {
            if (resp.status === 201) {
                return resp.body;
            }
            else if (resp.status === 403) {
                throw new Error('Access Denied');
            }
            throw (err);
        }
    }
    async capsPerformXMLPost(capURL, data) {
        const xml = LLSD.LLSD.formatXML(data);
        const resp = await this.requestPost(capURL, xml, 'application/llsd+xml');
        try {
            return LLSD.LLSD.parseXML(resp.body);
        }
        catch (_err) {
            if (resp.status === 201) {
                return {};
            }
            else if (resp.status === 403) {
                throw new Error('Access Denied');
            }
            else if (resp.status === 404) {
                throw new Error('Not found');
            }
            else {
                // eslint-disable-next-line @typescript-eslint/only-throw-error
                throw resp.body;
            }
        }
    }
    async capsPerformXMLPut(capURL, data) {
        const xml = LLSD.LLSD.formatXML(data);
        const resp = await this.requestPut(capURL, xml, 'application/llsd+xml');
        try {
            return LLSD.LLSD.parseXML(resp.body);
        }
        catch (err) {
            if (resp.status === 201) {
                return {};
            }
            else if (resp.status === 403) {
                throw new Error('Access Denied');
            }
            else {
                throw err;
            }
        }
    }
    async capsPerformXMLGet(capURL) {
        const resp = await this.requestGet(capURL);
        try {
            return LLSD.LLSD.parseXML(resp.body);
        }
        catch (err) {
            if (resp.status === 201) {
                return {};
            }
            else if (resp.status === 403) {
                throw new Error('Access Denied');
            }
            else {
                throw err;
            }
        }
    }
    async capsPerformGet(capURL) {
        const resp = await this.requestGet(capURL);
        try {
            return resp.body;
        }
        catch (err) {
            if (resp.status === 201) {
                return '';
            }
            else if (resp.status === 403) {
                throw new Error('Access Denied');
            }
            else {
                throw err;
            }
        }
    }
    async capsGetXML(capability) {
        let capName = '';
        let queryParams = {};
        if (typeof capability === 'string') {
            capName = capability;
        }
        else {
            capName = capability[0];
            queryParams = capability[1];
        }
        await this.waitForCapTimeout(capName);
        let capURL = await this.getCapability(capName);
        if (Object.keys(queryParams).length > 0) {
            const parsedURL = url.parse(capURL, true);
            for (const key of Object.keys(queryParams)) {
                parsedURL.query[key] = queryParams[key];
            }
            capURL = url.format(parsedURL);
        }
        try {
            return await this.capsPerformXMLGet(capURL);
        }
        catch (error) {
            console.log('Error with cap ' + capName);
            console.log(error);
            throw error;
        }
    }
    async capsGetString(capability) {
        let capName = '';
        let queryParams = {};
        if (typeof capability === 'string') {
            capName = capability;
        }
        else {
            capName = capability[0];
            queryParams = capability[1];
        }
        await this.waitForCapTimeout(capName);
        let capURL = await this.getCapability(capName);
        if (Object.keys(queryParams).length > 0) {
            const parsedURL = url.parse(capURL, true);
            for (const key of Object.keys(queryParams)) {
                parsedURL.query[key] = queryParams[key];
            }
            capURL = url.format(parsedURL);
        }
        try {
            return await this.capsPerformGet(capURL);
        }
        catch (error) {
            console.log('Error with cap ' + capName);
            console.log(error);
            throw error;
        }
    }
    async capsPostXML(capability, data) {
        let capName = '';
        let queryParams = {};
        if (typeof capability === 'string') {
            capName = capability;
        }
        else {
            capName = capability[0];
            queryParams = capability[1];
        }
        await this.waitForCapTimeout(capName);
        let capURL = await this.getCapability(capName);
        if (Object.keys(queryParams).length > 0) {
            const parsedURL = url.parse(capURL, true);
            for (const key of Object.keys(queryParams)) {
                parsedURL.query[key] = queryParams[key];
            }
            capURL = url.format(parsedURL);
        }
        try {
            return await this.capsPerformXMLPost(capURL, data);
        }
        catch (error) {
            console.log('Error with cap ' + capName);
            console.log(error);
            throw error;
        }
    }
    async capsPutXML(capability, data) {
        let capName = '';
        let queryParams = {};
        if (typeof capability === 'string') {
            capName = capability;
        }
        else {
            capName = capability[0];
            queryParams = capability[1];
        }
        await this.waitForCapTimeout(capName);
        let capURL = await this.getCapability(capName);
        if (Object.keys(queryParams).length > 0) {
            const parsedURL = url.parse(capURL, true);
            for (const key of Object.keys(queryParams)) {
                parsedURL.query[key] = queryParams[key];
            }
            capURL = url.format(parsedURL);
        }
        try {
            return await this.capsPerformXMLPut(capURL, data);
        }
        catch (error) {
            console.log('Error with cap ' + capName);
            console.log(error);
            throw error;
        }
    }
    shutdown() {
        this.onGotSeedCap.complete();
        if (this.eventQueueClient) {
            void this.eventQueueClient.shutdown();
        }
        this.active = false;
    }
    async waitForSeedCapability() {
        return new Promise((resolve) => {
            if (this.gotSeedCap) {
                resolve();
            }
            else {
                const sub = this.onGotSeedCap.subscribe(() => {
                    sub.unsubscribe();
                    resolve();
                });
            }
        });
    }
    async waitForCapTimeout(capName) {
        return new Promise((resolve) => {
            if (!Caps.CAP_INVOCATION_DELAY_MS[capName]) {
                resolve();
            }
            else {
                if (!this.timeLastCapExecuted[capName] || this.timeLastCapExecuted[capName] < (new Date().getTime() - Caps.CAP_INVOCATION_DELAY_MS[capName])) {
                    this.timeLastCapExecuted[capName] = new Date().getTime();
                }
                else {
                    this.timeLastCapExecuted[capName] += Caps.CAP_INVOCATION_DELAY_MS[capName];
                }
                const timeToWait = this.timeLastCapExecuted[capName] - new Date().getTime();
                if (timeToWait > 0) {
                    setTimeout(() => {
                        resolve();
                    }, timeToWait);
                }
                else {
                    resolve();
                }
            }
        });
    }
}
exports.Caps = Caps;
//# sourceMappingURL=Caps.js.map