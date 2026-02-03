"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLWearable = void 0;
const UUID_1 = require("./UUID");
const SaleTypeLL_1 = require("../enums/SaleTypeLL");
const Utils_1 = require("./Utils");
class LLWearable {
    name;
    type;
    parameters = {};
    textures = {};
    permission = {
        baseMask: 0,
        ownerMask: 0,
        groupMask: 0,
        everyoneMask: 0,
        nextOwnerMask: 0,
        creatorID: UUID_1.UUID.zero(),
        ownerID: UUID_1.UUID.zero(),
        lastOwnerID: UUID_1.UUID.zero(),
        groupID: UUID_1.UUID.zero()
    };
    saleType;
    salePrice;
    constructor(data) {
        if (data !== undefined) {
            const lines = data.replace(/\r\n/g, '\n').split('\n');
            for (let index = 0; index < lines.length; index++) {
                if (index === 0) {
                    const header = lines[index].split(' ');
                    if (header[0] !== 'LLWearable') {
                        return;
                    }
                }
                else if (index === 1) {
                    this.name = lines[index];
                }
                else {
                    const parsedLine = Utils_1.Utils.parseLine(lines[index]);
                    if (parsedLine.key !== null) {
                        switch (parsedLine.key) {
                            case 'base_mask':
                                this.permission.baseMask = parseInt(parsedLine.value, 16);
                                break;
                            case 'owner_mask':
                                this.permission.ownerMask = parseInt(parsedLine.value, 16);
                                break;
                            case 'group_mask':
                                this.permission.groupMask = parseInt(parsedLine.value, 16);
                                break;
                            case 'everyone_mask':
                                this.permission.everyoneMask = parseInt(parsedLine.value, 16);
                                break;
                            case 'next_owner_mask':
                                this.permission.nextOwnerMask = parseInt(parsedLine.value, 16);
                                break;
                            case 'creator_id':
                                this.permission.creatorID = new UUID_1.UUID(parsedLine.value);
                                break;
                            case 'owner_id':
                                this.permission.ownerID = new UUID_1.UUID(parsedLine.value);
                                break;
                            case 'last_owner_id':
                                this.permission.lastOwnerID = new UUID_1.UUID(parsedLine.value);
                                break;
                            case 'group_id':
                                this.permission.groupID = new UUID_1.UUID(parsedLine.value);
                                break;
                            case 'sale_type':
                                switch (parsedLine.value.trim().toLowerCase()) {
                                    case 'not':
                                        this.saleType = 0;
                                        break;
                                    case 'orig':
                                        this.saleType = 1;
                                        break;
                                    case 'copy':
                                        this.saleType = 2;
                                        break;
                                    case 'cntn':
                                        this.saleType = 3;
                                        break;
                                    default:
                                        console.log('Unrecognised saleType: ' + parsedLine.value.trim().toLowerCase());
                                }
                                break;
                            case 'sale_price':
                                this.salePrice = parseInt(parsedLine.value, 10);
                                break;
                            case 'type':
                                this.type = parseInt(parsedLine.value, 10);
                                break;
                            case 'parameters':
                                {
                                    const num = parseInt(parsedLine.value, 10);
                                    const max = index + num;
                                    for (index; index < max; index++) {
                                        const paramLine = Utils_1.Utils.parseLine(lines[index + 1]);
                                        if (paramLine.key !== null) {
                                            this.parameters[parseInt(paramLine.key, 10)] = parseFloat(paramLine.value.replace('-.', '-0.'));
                                        }
                                    }
                                    break;
                                }
                            case 'textures':
                                {
                                    const num = parseInt(parsedLine.value, 10);
                                    const max = index + num;
                                    for (index; index < max; index++) {
                                        if (lines[index + 1] === undefined) {
                                            break;
                                        }
                                        const texLine = Utils_1.Utils.parseLine(lines[index + 1]);
                                        if (texLine.key !== null) {
                                            this.textures[parseInt(texLine.key, 10)] = new UUID_1.UUID(texLine.value);
                                        }
                                    }
                                    break;
                                }
                            case 'permissions':
                            case 'sale_info':
                            case '{':
                            case '}':
                                // ignore
                                break;
                            default:
                                break;
                        }
                    }
                }
            }
        }
    }
    toAsset() {
        const lines = [
            'LLWearable version 22'
        ];
        lines.push(this.name);
        lines.push('');
        lines.push('\tpermissions 0');
        lines.push('\t{');
        lines.push('\t\tbase_mask\t' + Utils_1.Utils.numberToFixedHex(this.permission.baseMask));
        lines.push('\t\towner_mask\t' + Utils_1.Utils.numberToFixedHex(this.permission.ownerMask));
        lines.push('\t\tgroup_mask\t' + Utils_1.Utils.numberToFixedHex(this.permission.groupMask));
        lines.push('\t\teveryone_mask\t' + Utils_1.Utils.numberToFixedHex(this.permission.everyoneMask));
        lines.push('\t\tnext_owner_mask\t' + Utils_1.Utils.numberToFixedHex(this.permission.nextOwnerMask));
        lines.push('\t\tcreator_id\t' + this.permission.creatorID.toString());
        lines.push('\t\towner_id\t' + this.permission.ownerID.toString());
        lines.push('\t\tlast_owner_id\t' + this.permission.lastOwnerID.toString());
        lines.push('\t\tgroup_id\t' + this.permission.groupID.toString());
        lines.push('\t}');
        lines.push('\tsale_info\t0');
        lines.push('\t{');
        lines.push('\t\tsale_type\t' + SaleTypeLL_1.SaleTypeLL[this.saleType]);
        lines.push('\t\tsale_price\t' + this.salePrice);
        lines.push('\t}');
        lines.push('type ' + this.type);
        lines.push('parameters ' + Object.keys(this.parameters).length);
        for (const num of Object.keys(this.parameters)) {
            const val = this.parameters[parseInt(num, 10)];
            lines.push(num + (' ' + String(val).replace('-0.', '-.')).replace(' 0.', ' .'));
        }
        lines.push('textures ' + Object.keys(this.textures).length);
        for (const num of Object.keys(this.textures)) {
            const val = this.textures[parseInt(num, 10)];
            lines.push(num + ' ' + val.toString());
        }
        return lines.join('\n') + '\n';
    }
}
exports.LLWearable = LLWearable;
//# sourceMappingURL=LLWearable.js.map