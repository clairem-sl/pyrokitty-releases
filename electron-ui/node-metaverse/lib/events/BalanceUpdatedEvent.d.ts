import type { UUID } from '../classes/UUID';
import type { MoneyTransactionType } from '../enums/MoneyTransactionType';
export declare class BalanceUpdatedEvent {
    balance: number;
    transaction: {
        type: MoneyTransactionType;
        success: boolean;
        from: UUID;
        to: UUID;
        fromGroup: boolean;
        toGroup: boolean;
        amount: number;
        description: string;
    };
}
//# sourceMappingURL=BalanceUpdatedEvent.d.ts.map