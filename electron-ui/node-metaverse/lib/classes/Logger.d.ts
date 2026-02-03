export declare class Logger {
    static prefix: string;
    private static prefixLevel;
    static increasePrefixLevel(): void;
    static decreasePrefixLevel(): void;
    static generatePrefix(): void;
    static Debug(message: string | object): void;
    static Info(message: string | object): void;
    static Warn(message: string | object): void;
    static Error(message: unknown): void;
    static Log(type: string, message: unknown): void;
}
//# sourceMappingURL=Logger.d.ts.map