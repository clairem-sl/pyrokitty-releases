import { Readable, Transform } from 'stream';
export declare class TarWriter extends Transform {
    private thisFileSize;
    private fileActive;
    newFile(archivePath: string, realPath: string): Promise<void>;
    pipeFromBuffer(buf: Buffer): Promise<void>;
    pipeFrom(str: Readable): Promise<void>;
    endFile(): Promise<void>;
    _transform(chunk: any, encoding: 'ascii' | 'utf-8' | 'utf16le' | 'ucs-2' | 'base64' | 'latin1' | 'binary' | 'hex', callback: (error?: Error, data?: any) => void): void;
    private writeHeader;
    private chopString;
    private octalBuf;
    private octalString;
}
//# sourceMappingURL=TarWriter.d.ts.map