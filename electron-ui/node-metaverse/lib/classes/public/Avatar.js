"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Avatar = void 0;
const AvatarQueryResult_1 = require("./AvatarQueryResult");
const GameObject_1 = require("./GameObject");
const Vector3_1 = require("../Vector3");
const Quaternion_1 = require("../Quaternion");
const rxjs_1 = require("rxjs");
const UUID_1 = require("../UUID");
class Avatar extends AvatarQueryResult_1.AvatarQueryResult {
    onMoved = new rxjs_1.Subject();
    onTitleChanged = new rxjs_1.Subject();
    onLeftRegion = new rxjs_1.Subject();
    onAttachmentAdded = new rxjs_1.Subject();
    onAttachmentRemoved = new rxjs_1.Subject();
    onVisibleChanged = new rxjs_1.Subject();
    rotation = Quaternion_1.Quaternion.getIdentity();
    title = '';
    _isVisible = false;
    _gameObject;
    _position = Vector3_1.Vector3.getZero();
    _coarsePosition = Vector3_1.Vector3.getZero();
    attachments = new Map();
    constructor(gameObjectOrID, firstName, lastName) {
        super((gameObjectOrID instanceof UUID_1.UUID) ? gameObjectOrID : gameObjectOrID.FullID, firstName, lastName);
        if (gameObjectOrID instanceof GameObject_1.GameObject) {
            this.gameObject = gameObjectOrID;
        }
    }
    static fromGameObject(obj) {
        let firstName = 'Unknown';
        let lastName = 'Avatar';
        const fnValue = obj.NameValue.get('FirstName');
        if (fnValue !== undefined) {
            firstName = fnValue.value;
        }
        const lnValue = obj.NameValue.get('LastName');
        if (lnValue !== undefined) {
            lastName = lnValue.value;
        }
        const av = new Avatar(obj, firstName, lastName);
        const titleValue = obj.NameValue.get('Title');
        if (titleValue !== undefined) {
            av.setTitle(titleValue.value);
        }
        av.processObjectUpdate(obj);
        return av;
    }
    set gameObject(obj) {
        if (this._gameObject !== obj) {
            this._gameObject = obj;
            const objs = this._gameObject.region.objects.getObjectsByParent(this._gameObject.ID);
            for (const attachment of objs) {
                this._gameObject.region.clientCommands.region.resolveObject(attachment, {}).then(() => {
                    this.addAttachment(attachment);
                }).catch(() => {
                    console.error('Failed to resolve attachment for avatar');
                });
            }
        }
    }
    get isVisible() {
        return this._isVisible;
    }
    set isVisible(value) {
        if (this._isVisible !== value) {
            this._isVisible = value;
            this.onVisibleChanged.next(this);
        }
    }
    setTitle(newTitle) {
        if (newTitle !== this.title) {
            this.title = newTitle;
            this.onTitleChanged.next(this);
        }
    }
    getTitle() {
        return this.title;
    }
    get position() {
        if (this._isVisible) {
            return new Vector3_1.Vector3(this._position);
        }
        else {
            const pos = new Vector3_1.Vector3(this._coarsePosition);
            if (pos.z === 1020 && this._position.z > 1020) {
                pos.z = this._position.z;
            }
            return pos;
        }
    }
    set coarsePosition(pos) {
        const oldPos = this._coarsePosition;
        this._coarsePosition = pos;
        if (!this._isVisible) {
            if (pos.distance(oldPos) > 0.0001) {
                this.onMoved.next(this);
            }
        }
    }
    getRotation() {
        return new Quaternion_1.Quaternion(this.rotation);
    }
    processObjectUpdate(obj) {
        if (obj !== this._gameObject) {
            this.gameObject = obj;
        }
        if (obj.Position !== undefined && obj.Rotation !== undefined) {
            this.setGeometry(obj.Position, obj.Rotation);
        }
        const lnTitle = obj.NameValue.get('Title');
        if (lnTitle !== undefined) {
            this.setTitle(lnTitle.value);
        }
        this.isVisible = true;
    }
    setGeometry(position, rotation) {
        const oldPosition = this._position;
        const oldRotation = this.rotation;
        this._position = new Vector3_1.Vector3(position);
        this._coarsePosition = new Vector3_1.Vector3(position);
        this.rotation = new Quaternion_1.Quaternion(rotation);
        const rotDist = new Quaternion_1.Quaternion(this.rotation).angleBetween(oldRotation);
        if (position.distance(oldPosition) > 0.0001 || rotDist > 0.0001) {
            this.onMoved.next(this);
        }
    }
    getAttachment(itemID) {
        const attachment = this.attachments.get(itemID.toString());
        if (attachment) {
            return attachment;
        }
        throw new Error('Attachment not found');
    }
    getAttachments() {
        return this.attachments;
    }
    async waitForAttachment(itemID, timeout = 30000) {
        return new Promise((resolve, reject) => {
            if (typeof itemID === 'string') {
                itemID = new UUID_1.UUID(itemID);
            }
            try {
                const attach = this.getAttachment(itemID);
                resolve(attach);
            }
            catch (_ignore) {
                let subs = undefined;
                let timr = undefined;
                subs = this.onAttachmentAdded.subscribe((obj) => {
                    if (obj.itemID.equals(itemID)) {
                        if (subs !== undefined) {
                            subs.unsubscribe();
                            subs = undefined;
                        }
                        if (timr !== undefined) {
                            clearTimeout(timr);
                            timr = undefined;
                        }
                        resolve(obj);
                    }
                });
                timr = setTimeout(() => {
                    if (subs !== undefined) {
                        subs.unsubscribe();
                        subs = undefined;
                    }
                    if (timr !== undefined) {
                        clearTimeout(timr);
                        timr = undefined;
                    }
                    reject(new Error('WaitForAttachment timed out'));
                }, timeout);
            }
        });
    }
    addAttachment(obj) {
        if (obj.itemID !== undefined) {
            if (!this.attachments.has(obj.itemID.toString())) {
                this.attachments.set(obj.itemID.toString(), obj);
                this.onAttachmentAdded.next(obj);
            }
        }
    }
    removeAttachment(obj) {
        const attachItemID = obj.NameValue.get('AttachItemID');
        if (attachItemID !== undefined) {
            const itemID = new UUID_1.UUID(attachItemID.value);
            if (this.attachments.has(itemID.toString())) {
                this.onAttachmentRemoved.next(obj);
                this.attachments.delete(itemID.toString());
            }
        }
    }
    coarseLeftRegion() {
        this.onLeftRegion.next(this);
    }
}
exports.Avatar = Avatar;
//# sourceMappingURL=Avatar.js.map