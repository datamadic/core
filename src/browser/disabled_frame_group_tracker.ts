import { OpenFinWindow } from '../shapes';
import of_events from './of_events';
import route from '../common/route';
import WindowGroups from './window_groups';
const WindowTransaction = require('electron').windowTransaction;
import { getRuntimeProxyWindow } from './window_groups_runtime_proxy';
import { RectangleBase, Rectangle } from './rectangle';
import {
    moveFromOpenFinWindow,
    zeroDelta,
    getEventBounds,
    normalizeExternalBounds,
    getTransactionBounds,
    applyOffset
} from './normalized_rectangle';
import { writeToLog } from './log';

const isWin32 = process.platform === 'win32';
enum ChangeType {
    POSITION = 0,
    SIZE = 1,
    POSITION_AND_SIZE = 2
}
type MoveAccumulator = { otherWindows: Move[], leader?: Move };
type WinId = string;
interface GroupInfo {
    boundsChanging: boolean;
    payloadCache: [OpenFinWindow, any, RectangleBase, number][];
    interval?: any;
}
const groupInfoCache: Map<string, GroupInfo> = new Map();
const listenerCache: Map<WinId, Array<(...args: any[]) => void>> = new Map();
export interface Move { ofWin: OpenFinWindow; rect: Rectangle; offset: RectangleBase; }

function emitBoundsChanged({ ofWin, rect, offset }: Move, changeType: ChangeType, reason: string) {
    const eventBounds = getEventBounds(rect, offset);
    const eventArgs = { ...eventBounds, changeType, reason, deferred: true };
    raiseEvent(ofWin, 'bounds-changed', eventArgs);
}
async function raiseEvent(ofWin: OpenFinWindow, topic: string, payload: any) {
    const { uuid, name } = ofWin;
    const id = { uuid, name };
    const eventName = route.window(topic, uuid, name);
    const eventArgs = {
        ...payload,
        uuid,
        name,
        topic,
        type: 'window'
    };
    if (ofWin.isProxy) {
        const rt = await getRuntimeProxyWindow(id);
        const fin = rt.hostRuntime.fin;
        await fin.System.executeOnRemote(id, { action: 'raise-event', payload: { eventName, eventArgs } });
    } else {
        of_events.emit(eventName, eventArgs);
    }
}

export function updateGroupedWindowBounds(win: OpenFinWindow, delta: Partial<RectangleBase>) {
    const shift = { ...zeroDelta, ...delta };
    return handleApiMove(win, shift);
}
function getMovingWindowDelta(win: OpenFinWindow, bounds: Partial<RectangleBase>): RectangleBase {
    const { offset, rect } = moveFromOpenFinWindow(win);
    // Could be partial bounds from an API call
    const fullBounds = { ...applyOffset(rect, offset), ...bounds };
    const end = normalizeExternalBounds(fullBounds, offset); //Corrected
    return rect.delta(end);
}
export function setNewGroupedWindowBounds(win: OpenFinWindow, partialBounds: Partial<RectangleBase>) {
    const delta = getMovingWindowDelta(win, partialBounds);
    return handleApiMove(win, delta);
}
//REMEMBER - this being async means you never nack.... (REMOVE COMMENT IN PR)
function handleApiMove(win: OpenFinWindow, delta: RectangleBase) {
    const { rect, offset } = moveFromOpenFinWindow(win);
    const newBounds = rect.shift(delta);
    if (!rect.moved(newBounds)) {
        return;
    }
    const moved = (delta.x && delta.x + delta.width) || (delta.y && delta.y + delta.height);
    const resized = delta.width || delta.height;
    const changeType = resized
        ? moved
            ? ChangeType.POSITION_AND_SIZE
            : ChangeType.SIZE
        : ChangeType.POSITION;
    const moves = handleBoundsChanging(win, applyOffset(newBounds, offset), changeType);
    const { leader, otherWindows } = moves.reduce((accum: MoveAccumulator, move) => {
        // REMOVE LATER - DOES THIS WORK? IS WIN SAME REF AS OFWIN?
        move.ofWin === win ? accum.leader = move : accum.otherWindows.push(move);
        return accum;
    }, <MoveAccumulator>{ otherWindows: [] });
    if (!leader || leader.rect.moved(newBounds)) {
        //Proposed move differs from requested move
        throw new Error('Attempted move violates group constraints');
    }
    handleBatchedMove(moves, changeType);
    emitBoundsChanged(leader, changeType, 'self');
    otherWindows.map(move => emitBoundsChanged(move, changeType, 'group'));
    return leader.rect;
}

function handleBatchedMove(moves: Move[], changeType: ChangeType, bringWinsToFront: boolean = false) {
    if (isWin32) {
        const { flag: { noZorder, noSize, noActivate } } = WindowTransaction;
        let flags = noZorder + noActivate;
        flags = changeType === 0 ? flags + noSize : flags;
        const wt = new WindowTransaction.Transaction(0);
        moves.forEach(({ ofWin, rect, offset }) => {
            const hwnd = parseInt(ofWin.browserWindow.nativeId, 16);
            wt.setWindowPos(hwnd, { ...getTransactionBounds(rect, offset), flags });
            if (bringWinsToFront) { ofWin.browserWindow.bringToFront(); }
        });
        wt.commit();
    } else {
        moves.forEach(({ ofWin, rect, offset }) => {
            ofWin.browserWindow.setBounds(applyOffset(rect, offset));
            if (bringWinsToFront) { ofWin.browserWindow.bringToFront(); }
        });
    }
}
const makeTranslate = (delta: RectangleBase) => ({ ofWin, rect, offset }: Move): Move => {
    return { ofWin, rect: rect.shift(delta), offset };
};
function getInitialPositions(win: OpenFinWindow) {
    return WindowGroups.getGroup(win.groupUuid).map(moveFromOpenFinWindow);
}
function handleBoundsChanging(
    win: OpenFinWindow,
    rawPayloadBounds: RectangleBase,
    changeType: ChangeType,
    treatBothChangedAsJustAResize: boolean = false
): Move[] {
    const initialPositions: Move[] = getInitialPositions(win);
    let moves = initialPositions;
    const delta = getMovingWindowDelta(win, rawPayloadBounds);
    switch (changeType) {
        case ChangeType.POSITION:
            moves = handleMoveOnly(delta, initialPositions);
            break;
        case ChangeType.SIZE:
            moves = handleResizeOnly(win, delta);
            break;
        case ChangeType.POSITION_AND_SIZE:
            const resized = (delta.width || delta.height);
            const xShift = delta.x ? delta.x + delta.width : 0;
            const yShift = delta.y ? delta.y + delta.height : 0;
            const moved = (xShift || yShift);
            if (resized) {
                const resizeDelta = {x: delta.x - xShift, y: delta.y - yShift, width: delta.width, height: delta.height};
                moves = handleResizeOnly(win, resizeDelta);
            }
            if (moved && !treatBothChangedAsJustAResize) {
                //This flag is here because sometimes the runtime lies and says we moved on a resize
                //This flag should always be set to true when relying on runtime events. It should be false on api moves.
                //Setting it to false on runtime events can cause a growing window bug.
                const shift = { x: xShift, y: yShift, width: 0, height: 0 };
                moves = handleMoveOnly(shift, moves);
            }
            break;
        default: {
            moves = [];
        } break;
    }
    return moves;
}

function handleResizeOnly(win: OpenFinWindow, delta: RectangleBase) {
    const initialPositions = getInitialPositions(win);
    const rects = initialPositions.map(x => x.rect);
    const leaderRectIndex = initialPositions.map(x => x.ofWin).indexOf(win);
    const start = rects[leaderRectIndex];
    const iterMoves = Rectangle.PROPAGATE_MOVE(leaderRectIndex, start, delta, rects);

    const allMoves = iterMoves.map((x, i) => ({
        ofWin: initialPositions[i].ofWin,
        rect: x,
        offset: initialPositions[i].offset}));

    const moves = allMoves.filter((move, i) => initialPositions[i].rect.moved(move.rect));
    const endMove = moves.find(({ ofWin }) => ofWin === win);
    if (!endMove) {
        return [];
    }
    const final = endMove.rect;
    const xChangedWithoutWidth = final.width === start.width && final.x !== start.x;
    if (xChangedWithoutWidth) {
        return [];
    }
    const yChangedWithoutHeight = final.height === start.height && final.y !== start.y;
    if (yChangedWithoutHeight) {
        return [];
    }
    return moves;
}

function handleMoveOnly(delta: RectangleBase, initialPositions: Move[]) {
    return initialPositions
        .map(makeTranslate(delta));
}

export function addWindowToGroup(win: OpenFinWindow) {
    const MonitorInfo = require('./monitor_info.js');
    const scaleFactor = MonitorInfo.getInfo().deviceScaleFactor;
    let moved = new Set<OpenFinWindow>();

    const genericListener = (e: any, rawPayloadBounds: RectangleBase, changeType: ChangeType) => {
        try {
            e.preventDefault();
            Object.keys(rawPayloadBounds).map(key => {
                //@ts-ignore
                rawPayloadBounds[key] = rawPayloadBounds[key] / scaleFactor;
            });
            const groupInfo = getGroupInfoCacheForWindow(win);
            if (!groupInfo.boundsChanging) {
                groupInfo.boundsChanging = true;
                moved = new Set<OpenFinWindow>();
                const moves = handleBoundsChanging(win, rawPayloadBounds, changeType, true);
                handleBatchedMove(moves, changeType, true);
                moves.forEach((move) => moved.add(move.ofWin));
                win.browserWindow.once('end-user-bounds-change', () => {
                    groupInfo.boundsChanging = false;
                    moved.forEach((movedWin) => {
                        const isLeader = movedWin === win;
                        if (!isLeader) {
                            const endPosition = moveFromOpenFinWindow(movedWin);
                            emitBoundsChanged(endPosition, changeType, 'group');
                        }
                    });
                });
            } else {
                const moves = handleBoundsChanging(win, rawPayloadBounds, changeType, true);
                handleBatchedMove(moves, changeType, true);
                moves.forEach((move) => moved.add(move.ofWin));
            }
        } catch (error) {
            writeToLog('error', error);
        }
    };
    const moveListener = (e: any, newBounds: RectangleBase) => genericListener(e, newBounds, 0);
    const resizeListener = (e: any, newBounds: RectangleBase) => genericListener(e, newBounds, 1);

    listenerCache.set(win.browserWindow.nativeId, [moveListener, resizeListener]);
    win.browserWindow.on('will-move', moveListener);
    win.browserWindow.on('will-resize', resizeListener);
}

export function getGroupInfoCacheForWindow(win: OpenFinWindow): GroupInfo {
    let groupInfo: GroupInfo = groupInfoCache.get(win.groupUuid);
    if (!groupInfo) {
        groupInfo = {
            boundsChanging: false,
            payloadCache: []
        };
        //merging of groups of windows that are not in a group will be late in producing a window group.
        if (win.groupUuid) {
            groupInfoCache.set(win.groupUuid, groupInfo);
        }
    }
    return groupInfo;
}

export function removeWindowFromGroup(win: OpenFinWindow) {
    if (!win.browserWindow.isDestroyed()) {
        const winId = win.browserWindow.nativeId;
        const listeners = listenerCache.get(winId);
        if (listeners) {
            win.browserWindow.removeListener('will-move', listeners[0]);
            win.browserWindow.removeListener('will-resize', listeners[1]);
        }
        listenerCache.delete(winId);
    }
}
