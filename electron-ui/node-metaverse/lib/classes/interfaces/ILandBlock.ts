import type { LandFlags } from '../../enums/LandFlags';
import type { LandType } from '../../enums/LandType';
 
export interface ILandBlock
{
    landType: LandType;
    landFlags: LandFlags;
    /** Internal overlay index assigned by flood-fill — NOT the server's parcel LocalID.
     *  Use region.getParcelLocalId(x, y) to get the real LocalID. */
    overlayIndex: number;
}
