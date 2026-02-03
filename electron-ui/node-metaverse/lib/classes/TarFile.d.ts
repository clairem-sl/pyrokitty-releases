export declare class TarFile {
    fileName: string;
    fileMode: number;
    userID: number;
    groupID: number;
    modifyTime: Date;
    linkIndicator: number;
    linkedFile: string;
    offset: number;
    fileSize: number;
    archiveFile: string;
    read(): Promise<Buffer>;
}
//# sourceMappingURL=TarFile.d.ts.map