import { TarArchive } from './TarArchive';
import type { Readable } from 'stream';
export declare class TarReader {
    private outFile;
    parse(stream: Readable): Promise<TarArchive>;
    close(): void;
    private trimEntry;
    private decodeOctal;
}
//# sourceMappingURL=TarReader.d.ts.map