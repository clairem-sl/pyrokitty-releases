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
Object.defineProperty(exports, "__esModule", { value: true });
exports.Parcel = void 0;
const builder = __importStar(require("xmlbuilder"));
const ParcelFlags_1 = require("../../enums/ParcelFlags");
class Parcel {
    region;
    LocalID;
    ParcelID;
    RegionDenyAgeUnverified;
    MediaDesc;
    MediaWidth;
    MediaHeight;
    MediaLoop;
    MediaType;
    ObscureMedia;
    ObscureMusic;
    AABBMax;
    AABBMin;
    AnyAVSounds;
    Area;
    AuctionID;
    AuthBuyerID;
    Bitmap;
    Category;
    ClaimDate;
    ClaimPrice;
    Desc;
    Dwell;
    GroupAVSounds;
    GroupID;
    GroupPrims;
    IsGroupOwned;
    LandingType;
    MaxPrims;
    MediaAutoScale;
    MediaID;
    MediaURL;
    MusicURL;
    Name;
    OtherCleanTime;
    OtherCount;
    OtherPrims;
    OwnerID;
    OwnerPrims;
    ParcelFlags;
    ParcelPrimBonus;
    PassHours;
    PassPrice;
    PublicCount;
    RegionDenyAnonymous;
    RegionDenyIdentified;
    RegionDenyTransacted;
    RegionPushOverride;
    RentPrice;
    RequestResult;
    SalePrice;
    SeeAvs;
    SelectedPrims;
    SelfCount;
    SequenceID;
    SimWideMaxPrims;
    SimWideTotalPrims;
    SnapSelection;
    SnapshotID;
    Status;
    TotalPrims;
    UserLocation;
    UserLookAt;
    RegionAllowAccessOverride;
    constructor(region) {
        this.region = region;
    }
    canIRez() {
        if (this.ParcelFlags & ParcelFlags_1.ParcelFlags.CreateObjects) {
            return true;
        }
        if (this.region.agent.activeGroupID.equals(this.OwnerID) && this.ParcelFlags & ParcelFlags_1.ParcelFlags.CreateGroupObjects) {
            return true;
        }
        if (this.OwnerID.equals(this.region.agent.agentID)) {
            return true;
        }
        return false;
    }
    exportXML() {
        const document = builder.create('LandData');
        document.ele('Area', this.Area);
        document.ele('AuctionID', this.AuctionID ?? 0);
        document.ele('AuthBuyerID', this.AuthBuyerID.toString());
        document.ele('Category', this.Category);
        document.ele('ClaimDate', this.ClaimDate);
        document.ele('ClaimPrice', this.ClaimPrice);
        document.ele('GlobalID', this.ParcelID.toString());
        document.ele('GroupID', this.GroupID.toString());
        document.ele('IsGroupOwned', this.IsGroupOwned);
        document.ele('Bitmap', this.Bitmap.toString('base64'));
        document.ele('Description', this.Desc);
        document.ele('Flags', this.ParcelFlags);
        document.ele('LandingType', this.LandingType);
        document.ele('Name', this.Name);
        document.ele('Status', this.Status);
        document.ele('LocalID', this.LocalID);
        document.ele('MediaAutoScale', this.MediaAutoScale);
        document.ele('MediaID', this.MediaID.toString());
        document.ele('MediaURL', this.MediaURL);
        document.ele('MusicURL', this.MusicURL);
        document.ele('OwnerID', this.OwnerID.toString());
        document.ele('ParcelAccessList');
        document.ele('PassHours', this.PassHours);
        document.ele('PassPrice', this.PassPrice);
        document.ele('SalePrice', this.SalePrice);
        document.ele('SnapshotID', this.SnapshotID.toString());
        document.ele('UserLocation', this.UserLocation.toString());
        document.ele('UserLookAt', this.UserLookAt.toString());
        document.ele('Dwell', 0);
        document.ele('OtherCleanTime', this.OtherCleanTime);
        return document.end({ pretty: true, allowEmpty: true });
    }
}
exports.Parcel = Parcel;
//# sourceMappingURL=Parcel.js.map