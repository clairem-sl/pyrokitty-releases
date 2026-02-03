import type { IPv4, IPv6 } from 'ipaddr.js';
export declare class IPAddress {
    ip: IPv4 | IPv6 | null;
    constructor(buf?: Buffer | string, pos?: number);
    static zero(): IPAddress;
    toString: () => string;
    writeToBuffer(buf: Buffer, pos: number): void;
}
//# sourceMappingURL=IPAddress.d.ts.map