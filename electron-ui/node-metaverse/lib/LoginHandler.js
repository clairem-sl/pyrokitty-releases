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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoginHandler = void 0;
const validator_1 = __importDefault(require("validator"));
const xmlrpc = __importStar(require("xmlrpc"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const LoginError_1 = require("./classes/LoginError");
const LoginResponse_1 = require("./classes/LoginResponse");
const Utils_1 = require("./classes/Utils");
const UUID_1 = require("./classes/UUID");
const url_1 = require("url");
const os = __importStar(require("os"));
const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const packageJson = require(packageJsonPath);
const version = packageJson.version;
class LoginHandler {
    clientEvents;
    options;
    constructor(ce, options) {
        this.clientEvents = ce;
        this.options = options;
    }
    async Login(params) {
        const loginURI = new url_1.URL(params.url);
        let secure = false;
        if (loginURI.protocol !== null && loginURI.protocol.trim().toLowerCase() === 'https:') {
            secure = true;
        }
        let port = loginURI.port;
        if (port === null) {
            port = secure ? '443' : '80';
        }
        const secureClientOptions = {
            host: loginURI.hostname || undefined,
            port: parseInt(port, 10),
            path: loginURI.pathname || undefined,
            rejectUnauthorized: false,
            timeout: 60000
        };
        const viewerDigest = 'ce50e500-e6f0-15ab-4b9d-0591afb91ffe';
        const client = (secure) ? xmlrpc.createSecureClient(secureClientOptions) : xmlrpc.createClient(secureClientOptions);
        const nameHash = Utils_1.Utils.SHA1String(params.firstName + params.lastName + viewerDigest);
        const macAddress = [];
        for (let i = 0; i < 12; i = i + 2) {
            macAddress.push(nameHash.substring(i, i + 2));
        }
        let hardwareID = null;
        const hardwareIDFile = path.resolve(__dirname, 'deviceToken.json');
        try {
            const hwID = await fs.promises.readFile(hardwareIDFile);
            const data = JSON.parse(hwID.toString('utf-8'));
            hardwareID = data.id0;
        }
        catch (_e) {
            // Ignore any error
        }
        if (hardwareID === null || !validator_1.default.isUUID(String(hardwareID), 'loose')) {
            hardwareID = UUID_1.UUID.random().toString();
            await fs.promises.writeFile(hardwareIDFile, JSON.stringify({ id0: hardwareID }));
        }
        const mfaToken = params.token ?? '';
        const mfaHash = params.mfa_hash ?? '';
        return new Promise((resolve, reject) => {
            let password = params.password;
            if (params.getHashedPassword) {
                password = params.getHashedPassword();
            }
            let platform = '???';
            switch (os.platform()) {
                case 'darwin':
                    platform = 'mac';
                    break;
                case 'linux':
                    platform = 'lnx';
                    break;
                case 'win32':
                    platform = 'win';
                    break;
                default:
                    throw new Error('Unsupported platform');
            }
            const versions = version.split('.');
            const major = versions.length > 0 ? versions[0] : '0';
            const minor = versions.length > 1 ? versions[1] : '0';
            const patch = versions.length > 2 ? versions[2] : '0';
            let build = major.padStart(2, '0') + minor.padStart(2, '0') + patch.padStart(2, '0');
            build = build.replace(/^0+/, '');
            client.methodCall('login_to_simulator', [
                {
                    first: params.firstName,
                    last: params.lastName,
                    passwd: password,
                    start: params.start,
                    channel: 'libnmv',
                    major,
                    minor,
                    patch,
                    build,
                    platform,
                    version: version + '.' + build,
                    token: mfaToken,
                    mfa_hash: mfaHash,
                    id0: Utils_1.Utils.MD5String(String(hardwareID)),
                    mac: macAddress.join(':'),
                    viewer_digest: viewerDigest,
                    agree_to_tos: params.agreeToTOS,
                    read_critical: params.readCritical,
                    options: [
                        'inventory-root',
                        'inventory-skeleton',
                        'inventory-lib-root',
                        'inventory-lib-owner',
                        'inventory-skel-lib',
                        'gestures',
                        'event_categories',
                        'event_notifications',
                        'classified_categories',
                        'buddy-list',
                        'ui-config',
                        'login-flags',
                        'global-textures'
                    ]
                }
            ], (error, value) => {
                if (error) {
                    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
                    reject(error);
                }
                else {
                    if (!value.login || value.login === 'false') {
                        reject(new LoginError_1.LoginError(value));
                    }
                    else {
                        const response = new LoginResponse_1.LoginResponse(value, this.clientEvents, this.options);
                        resolve(response);
                    }
                }
            });
        });
    }
}
exports.LoginHandler = LoginHandler;
//# sourceMappingURL=LoginHandler.js.map