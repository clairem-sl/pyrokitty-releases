"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClientEvents = void 0;
const rxjs_1 = require("rxjs");
const TimeoutError_1 = require("./TimeoutError");
const FilterResponse_1 = require("../enums/FilterResponse");
class ClientEvents {
    onNearbyChat = new rxjs_1.Subject();
    onInstantMessage = new rxjs_1.Subject();
    onGroupInvite = new rxjs_1.Subject();
    onFriendRequest = new rxjs_1.Subject();
    onInventoryOffered = new rxjs_1.Subject();
    onLure = new rxjs_1.Subject();
    onTeleportEvent = new rxjs_1.Subject();
    onDisconnected = new rxjs_1.Subject();
    onCircuitLatency = new rxjs_1.Subject();
    onGroupChat = new rxjs_1.Subject();
    onGroupChatClosed = new rxjs_1.Subject();
    onGroupNotice = new rxjs_1.Subject();
    onGroupChatSessionJoin = new rxjs_1.Subject();
    onGroupChatAgentListUpdate = new rxjs_1.Subject();
    onFriendResponse = new rxjs_1.Subject();
    onInventoryResponse = new rxjs_1.Subject();
    onScriptDialog = new rxjs_1.Subject();
    onEventQueueStateChange = new rxjs_1.Subject();
    onFriendOnline = new rxjs_1.Subject();
    onFriendRights = new rxjs_1.Subject();
    onFriendRemoved = new rxjs_1.Subject();
    onPhysicsDataEvent = new rxjs_1.Subject();
    onParcelPropertiesEvent = new rxjs_1.Subject();
    onNewObjectEvent = new rxjs_1.Subject();
    onObjectUpdatedEvent = new rxjs_1.Subject();
    onObjectUpdatedTerseEvent = new rxjs_1.Subject();
    onObjectKilledEvent = new rxjs_1.Subject();
    onSelectedObjectEvent = new rxjs_1.Subject();
    onObjectResolvedEvent = new rxjs_1.Subject();
    onAvatarEnteredRegion = new rxjs_1.Subject();
    onRegionTimeDilation = new rxjs_1.Subject();
    onBulkUpdateInventoryEvent = new rxjs_1.Subject();
    onLandStatReplyEvent = new rxjs_1.Subject();
    onSimStats = new rxjs_1.Subject();
    onBalanceUpdated = new rxjs_1.Subject();
    onScriptRunningReply = new rxjs_1.Subject();
    async waitForEvent(subj, messageFilter, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const handleObj = {
                timeout: null,
                subscription: null
            };
            const timeoutFunc = () => {
                if (handleObj.subscription !== null) {
                    handleObj.subscription.unsubscribe();
                    reject(new TimeoutError_1.TimeoutError('Timeout waiting for event'));
                }
            };
            handleObj.timeout = setTimeout(timeoutFunc, timeout);
            handleObj.subscription = subj.subscribe((item) => {
                let finish = false;
                if (messageFilter === undefined) {
                    finish = true;
                }
                else {
                    try {
                        const filterResult = messageFilter(item);
                        if (filterResult === FilterResponse_1.FilterResponse.Finish) {
                            finish = true;
                        }
                        else if (filterResult === FilterResponse_1.FilterResponse.Match) {
                            // Extend
                            if (handleObj.timeout !== null) {
                                clearTimeout(handleObj.timeout);
                            }
                            handleObj.timeout = setTimeout(timeoutFunc, timeout);
                        }
                    }
                    catch (e) {
                        if (handleObj.timeout !== null) {
                            clearTimeout(handleObj.timeout);
                            handleObj.timeout = null;
                        }
                        if (handleObj.subscription !== null) {
                            handleObj.subscription.unsubscribe();
                            handleObj.subscription = null;
                        }
                        if (e instanceof Error) {
                            reject(e);
                        }
                        else {
                            reject(new Error('Failed running event filter'));
                        }
                    }
                }
                if (finish) {
                    if (handleObj.timeout !== null) {
                        clearTimeout(handleObj.timeout);
                        handleObj.timeout = null;
                    }
                    if (handleObj.subscription !== null) {
                        handleObj.subscription.unsubscribe();
                        handleObj.subscription = null;
                    }
                    resolve(item);
                }
            });
        });
    }
}
exports.ClientEvents = ClientEvents;
//# sourceMappingURL=ClientEvents.js.map