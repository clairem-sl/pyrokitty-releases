import { UUID } from '../UUID';
import { MessageBase } from '../MessageBase';
import { Message } from '../../enums/Message';
export declare class TransferInventoryMessage implements MessageBase {
    name: string;
    messageFlags: number;
    id: Message;
    InfoBlock: {
        SourceID: UUID;
        DestID: UUID;
        TransactionID: UUID;
    };
    InventoryBlock: {
        InventoryID: UUID;
        Type: number;
    }[];
    getSize(): number;
    writeToBuffer(buf: Buffer, pos: number): number;
    readFromBuffer(buf: Buffer, pos: number): number;
}
//# sourceMappingURL=TransferInventory.d.ts.map