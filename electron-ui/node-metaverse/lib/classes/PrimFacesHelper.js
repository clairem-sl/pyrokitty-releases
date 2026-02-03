"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrimFacesHelper = void 0;
const rxjs_1 = require("rxjs");
const UUID_1 = require("./UUID");
const ChatType_1 = require("../enums/ChatType");
const Logger_1 = require("./Logger");
class PrimFacesHelper {
    bot;
    container;
    readerID;
    chatSubs;
    onGotFaces = new rxjs_1.Subject();
    finished = false;
    sides = 0;
    constructor(bot, container) {
        this.bot = bot;
        this.container = container;
        this.readerID = UUID_1.UUID.random().toString();
    }
    async getFaces() {
        const scriptName = UUID_1.UUID.random().toString();
        const script = await this.container.rezScript(scriptName, '');
        this.chatSubs = this.bot.clientEvents.onNearbyChat.subscribe((value) => {
            if (value.chatType === ChatType_1.ChatType.OwnerSay) {
                const msg = value.message.split(this.readerID + ' ');
                if (msg.length > 1) {
                    this.sides = parseInt(msg[1], 10);
                    if (this.chatSubs !== undefined) {
                        this.chatSubs.unsubscribe();
                        delete this.chatSubs;
                    }
                    this.onGotFaces.next();
                    this.onGotFaces.complete();
                }
            }
        });
        script.updateScript(Buffer.from(`default{state_entry(){llOwnerSay("${this.readerID} " + (string)llGetNumberOfSides());llRemoveInventory(llGetScriptName());}}`, 'utf-8')).then(() => { }).catch((error) => { Logger_1.Logger.Error(error); });
        return this.waitForSides();
    }
    async waitForSides() {
        return new Promise((resolve, reject) => {
            let subscription = null;
            if (this.finished) {
                if (this.chatSubs !== undefined) {
                    this.chatSubs.unsubscribe();
                    delete this.chatSubs;
                }
                resolve(this.sides);
                return;
            }
            const timeout = setTimeout(() => {
                if (subscription !== null) {
                    subscription.unsubscribe();
                    subscription = null;
                }
                if (this.chatSubs !== undefined) {
                    this.chatSubs.unsubscribe();
                    delete this.chatSubs;
                }
                reject(new Error('Timed out waiting for number of sides'));
            }, 60000);
            subscription = this.onGotFaces.subscribe(() => {
                clearTimeout(timeout);
                if (subscription !== null) {
                    subscription.unsubscribe();
                    subscription = null;
                }
                if (this.chatSubs !== undefined) {
                    this.chatSubs.unsubscribe();
                    delete this.chatSubs;
                }
                resolve(this.sides);
            });
        });
    }
}
exports.PrimFacesHelper = PrimFacesHelper;
//# sourceMappingURL=PrimFacesHelper.js.map