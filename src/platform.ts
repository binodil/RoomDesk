/** Which system the room runs on, for the few words and features that differ. */
export const IS_MAC = /Mac/i.test(navigator.userAgent);

/** What the bin is called on this system. */
export const BIN_NAME = IS_MAC ? "Trash" : "Recycle Bin";
