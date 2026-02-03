"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLSDReal = void 0;
class LLSDReal {
    real;
    constructor(val) {
        if (typeof val === 'number') {
            this.real = val;
            return;
        }
        switch (val) {
            case 'rInfinity':
                this.real = Number.POSITIVE_INFINITY;
                break;
            case 'r-Infinity':
                this.real = Number.NEGATIVE_INFINITY;
                break;
            case 'rNaN':
                this.real = Number.NaN;
                break;
            case '+Zero':
                this.real = 0;
                break;
            case '-Zero':
                this.real = -0;
                break;
            case '+Infinity':
                this.real = Number.POSITIVE_INFINITY;
                break;
            case '-Infinity':
                this.real = Number.NEGATIVE_INFINITY;
                break;
            case 'NaNQ':
                this.real = Number.NaN;
                break;
            case 'NaNS':
                this.real = Number.NaN;
                break;
            case 'NaN':
                this.real = Number.NaN;
                break;
            default:
                this.real = parseFloat(val);
        }
    }
    static parseBinary(reader) {
        return new LLSDReal(reader.readDoubleBE());
    }
    static parseReal(val) {
        if (val === undefined) {
            return undefined;
        }
        else if (typeof val === 'number') {
            return new LLSDReal(val);
        }
        else if (val instanceof LLSDReal) {
            return val;
        }
        throw new Error('Parsed value is not a number');
    }
    valueOf() {
        return this.real;
    }
    toJSON() {
        return this.real;
    }
    set value(newValue) {
        this.real = newValue;
    }
}
exports.LLSDReal = LLSDReal;
//# sourceMappingURL=LLSDReal.js.map