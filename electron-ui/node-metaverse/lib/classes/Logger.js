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
exports.Logger = void 0;
const logger = __importStar(require("winston"));
const winston = __importStar(require("winston"));
const moment_1 = __importDefault(require("moment"));
const chalk_1 = __importDefault(require("chalk"));
const formatLevel = function (text, level) {
    switch (level) {
        case 'warn':
            return chalk_1.default.yellowBright(text);
        case 'error':
            return chalk_1.default.redBright(text);
        case 'debug':
            return chalk_1.default.green(text);
        case 'info':
            return chalk_1.default.magentaBright(text);
        default:
            return text;
    }
};
const formatMessage = function (text, level) {
    switch (level) {
        case 'warn':
            return chalk_1.default.yellowBright(text);
        case 'error':
            return chalk_1.default.redBright(text);
        default:
            return text;
    }
};
const logFormat = winston.format.printf(function (info) {
    const logComponents = [
        (0, moment_1.default)().format('YYYY-MM-DD HH:mm:ss'),
        '-',
        '[' + formatLevel(info.level.toUpperCase(), info.level) + ']',
        formatMessage(info.message, info.level)
    ];
    return logComponents.join(' ');
});
logger.configure({
    format: logFormat,
    silent: false,
    transports: [
        new winston.transports.Console({
            'level': 'debug',
            handleExceptions: true
        })
    ],
});
class Logger {
    static prefix = '';
    static prefixLevel = 0;
    static increasePrefixLevel() {
        this.prefixLevel++;
        this.generatePrefix();
    }
    static decreasePrefixLevel() {
        this.prefixLevel--;
        this.generatePrefix();
    }
    static generatePrefix() {
        this.prefix = '';
        for (let x = 0; x < this.prefixLevel; x++) {
            this.prefix += '    ';
        }
        if (this.prefix.length > 0) {
            this.prefix += '... ';
        }
    }
    static Debug(message) {
        if (typeof message === 'string') {
            message = this.prefix + message;
        }
        this.Log('debug', message);
    }
    static Info(message) {
        if (typeof message === 'string') {
            message = this.prefix + message;
        }
        this.Log('info', message);
    }
    static Warn(message) {
        if (typeof message === 'string') {
            message = this.prefix + message;
        }
        this.Log('warn', message);
    }
    static Error(message) {
        if (typeof message !== 'object') {
            message = this.prefix + String(message);
        }
        this.Log('error', message);
    }
    static Log(type, message) {
        if (typeof message === 'object') {
            if (message instanceof Error) {
                message = message.message + '\n\n' + message.stack;
            }
            else {
                message = JSON.stringify(message);
            }
        }
        logger.log(type, message);
    }
}
exports.Logger = Logger;
//# sourceMappingURL=Logger.js.map