export declare class LoginError extends Error {
    reason: string;
    message_id: string;
    constructor(err: {
        login: 'false';
        reason: string;
        message: string;
        message_id: string;
    });
}
//# sourceMappingURL=LoginError.d.ts.map