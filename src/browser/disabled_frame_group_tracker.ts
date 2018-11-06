import { OpenFinWindow } from '../shapes';
import of_events from './of_events';
import route from '../common/route';
import { BrowserWindow } from 'electron';
const WindowTransaction = require('electron').windowTransaction;
import {Rectangle, RectangleBase} from './rectangle';
const isWin32 = process.platform === 'win32';
import { writeToLog } from './log';
const l = (x: any) => writeToLog(1, x, true);
const getState = (browserWindow: BrowserWindow) => {
    if (browserWindow && browserWindow.isMinimized()) {
        return 'minimized';
    } else if (browserWindow && browserWindow.isMaximized()) {
        return 'maximized';
    } else {
        return 'normal';
    }
};

/*
Edge cases
respect max
whether to restore frame on leave
disabled window moving
event propagation
*/
type WinId = string;
const groupTrackerCache = new Map<string, GroupTracker>();
export class GroupTracker {
    private windowMap: Map<WinId, OpenFinWindow>;
    private listenerCache: Map<WinId, (...args: any[]) => void> = new Map();
    private interval: any;
    private boundsChanging = false;
    private constructor(private groupId: string) {
       groupTrackerCache.set(groupId, this);
       this.windowMap = new Map();
    }
    public static GET_GROUP_TRACKER (id: string) {
       return groupTrackerCache.get(id) || new GroupTracker(id);
    }
    private payloadCache: [string, any, RectangleBase, number][] = [];
    public addWindowToGroup(win: OpenFinWindow) {
        const winId = <WinId>win.browserWindow.nativeId;
        win.browserWindow.setUserMovementEnabled(false);
        this.windowMap.set(winId, win);
        //Need to remove handler on leave
        const listener = (e: any, newBounds: RectangleBase, changeType: number) => {
            if (this.boundsChanging) {
                this.payloadCache.push([winId, e, newBounds, changeType]);
            } else {
                const uuid = win.uuid;
                const name = win.name;
                const rect = Rectangle.CREATE_FROM_BROWSER_WINDOW(win.browserWindow);
                const moved = new Set();
                of_events.emit(route.window('begin-user-bounds-changing', uuid, name), {
                    ...rect.eventBounds,
                    uuid,
                    name,
                    topic: 'begin-user-bounds-changing',
                    type: 'window',
                    windowState: getState(win.browserWindow)
                });
                this.boundsChanging = true;
                this.handleBoundsChanging(winId, e, newBounds, changeType);
                this.interval = setInterval(() => {
                    if (this.payloadCache.length) {
                        const [a, b, c, d] = this.payloadCache.pop();
                        const moves = this.handleBoundsChanging(a, b, c, d);
                        moves.forEach((pair) => {
                            moved.add(pair[0].browserWindow.nativeId);
                            this.emitChange(pair, d);
                        });
                       this.payloadCache = [];
                    }
                }, 16);
                win.browserWindow.once('disabled-frame-bounds-changed', (e: any, newBounds: RectangleBase, changeType: number) => {
                    this.boundsChanging = false;
                    clearInterval(this.interval);
                    this.payloadCache = [];
                    this.handleBoundsChanging(winId, e, newBounds, changeType);
                    moved.forEach((winId) => {
                        const win = this.windowMap.get(winId);
                        const rect = Rectangle.CREATE_FROM_BROWSER_WINDOW(win.browserWindow);
                        this.emitChange([win, rect], changeType, 'changed');
                    });
                });
            }
        };
        this.listenerCache.set(winId, listener);
        win.browserWindow.on('disabled-frame-bounds-changing', listener);
    }
    private handleBatchedMove(moves: [OpenFinWindow, Rectangle][]) {
        if (isWin32) {
            const { flag: { noZorder, noSize, noActivate } } = WindowTransaction;
            const flags = noZorder + noActivate;
            const wt = new WindowTransaction.Transaction(0);
            moves.forEach(([win, rect]) => {
                const hwnd = parseInt(win.browserWindow.nativeId, 16);
                wt.setWindowPos(hwnd, { ...rect.transactionBounds, flags });
            });
            wt.commit();
        } else {
            moves.forEach(([win, rect]) => {
                win.browserWindow.setBounds(rect.bounds);
            });
        }
    }
    private emitChange = (
        [win, rect] : [OpenFinWindow, Rectangle],
        changeType: number,
        eventType: 'changing' | 'changed' = 'changing'
    ) => {
        const topic = `bounds-${eventType}`;
        const uuid = win.uuid;
        const name = win.name;
        of_events.emit(route.window(topic, uuid, name), {
            ...rect.eventBounds,
            changeType,
            uuid,
            name,
            topic,
            type: 'window',
            deffered: true
        });
    }
    private handleBoundsChanging = (
        winId: WinId,
        e: any,
        newBounds: RectangleBase,
        changeType: number
    ) => {
        let shouldMove = true;
        let moves: [OpenFinWindow, Rectangle][] = [];
        switch (changeType) {
            case 0: {
                const thisBounds = this.windowMap.get(winId).browserWindow.getBounds();
                const delta = Rectangle.CREATE_FROM_BOUNDS(thisBounds).delta(newBounds);
                moves = Array.from(this.windowMap, ([id, win]): [OpenFinWindow, Rectangle] => {
                    const bounds = win.browserWindow.getBounds();
                    const rect = Rectangle.CREATE_FROM_BOUNDS(bounds).shift(delta);
                    return [win, rect];
                });
            } break;
            default: {
                const thisRect = Rectangle.CREATE_FROM_BROWSER_WINDOW(this.windowMap.get(winId).browserWindow);

                let leaderIdx: number;
                const positions: Map<string, Rectangle> = new Map();

                [...this.windowMap].forEach(([nativeId, win], index) => {
                    positions.set(nativeId, Rectangle.CREATE_FROM_BROWSER_WINDOW(win.browserWindow));

                    if (nativeId === winId) {
                        leaderIdx = index;
                    }
                });

                const graphInitial = Rectangle.GRAPH_WITH_SIDE_DISTANCES([...positions].map(([, b]) => b));

                const graph = Rectangle.GRAPH([...positions].map(([, b]) => b));
                const paths = Rectangle.BREADTH_WALK(graph, leaderIdx);

                l([...paths]);

                // this needs to be the order from the dist graph...
                this.windowMap.forEach(win => {
                    const bounds = win.browserWindow.getBounds();


                    const rect = clipBounds(Rectangle.CREATE_FROM_BOUNDS(bounds).move(thisRect, newBounds), win.browserWindow);

                    positions.set(win.browserWindow.nativeId, rect);
                    // moves.push(() => win.browserWindow.setBounds(rect));
                });

                positions.set(winId, Rectangle.CREATE_FROM_BOUNDS(newBounds));

                const graphFinal = Rectangle.GRAPH_WITH_SIDE_DISTANCES([...positions].map(([, b]) => b));

                if (!Rectangle.IS_SUBGRAPH_CLOSER(graphInitial, graphFinal)) {
                    // shouldMove = false;

                    shouldMove = false;
                    l('nooooooo!!');
                    l([...graphInitial.edges].join(' || '));
                    l('---------');
                    l([...graphFinal.edges].join(' || '));
                    l('========');
                }

                // %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
                this.windowMap.forEach(win => {
                    const baseRect = Rectangle.CREATE_FROM_BROWSER_WINDOW(win.browserWindow);
                    const movedRect = baseRect.move(thisRect, newBounds);
                    if (baseRect.moved(movedRect)) {
                        moves.push([win, movedRect]);
                    }
                });
            } break;
        }

        if (shouldMove) {
            this.handleBatchedMove(moves);
        }

        // todo is this for the non-flag implementation?
        return moves;
    };
    public removeWindowFromGroup = (win: OpenFinWindow) => {
        win.browserWindow.setUserMovementEnabled(true);
        const winId = win.browserWindow.nativeId;
        win.browserWindow.removeListener('disabled-frame-bounds-changing', this.listenerCache.get(winId));
        this.listenerCache.delete(winId);
        this.windowMap.delete(winId);
        if (this.windowMap.size === 0) {
            groupTrackerCache.delete(this.groupId);
        }
    }
}

interface Clamped {
    value: number;
    clampedOffset: number;
}

function clipBounds(bounds: Rectangle, browserWindow: OpenFinWindow['browserWindow']): Rectangle {
    if (!('_options' in browserWindow)) {
      return bounds;
    }

    const { minWidth, minHeight, maxWidth, maxHeight } = browserWindow._options;

    const xclamp = clamp(bounds.width, minWidth, maxWidth);
    const yclamp = clamp(bounds.height, minHeight, maxHeight);

    if (yclamp.clampedOffset || xclamp.clampedOffset) {
      // here is where we can indicate a "pushed" window and may need to check all bounds
    }

    // return {
    //   x: bounds.x + xclamp.clampedOffset,
    //   y: bounds.y + yclamp.clampedOffset,
    //   width: xclamp.value,
    //   height: yclamp.value
    // };

    return new Rectangle(bounds.x + xclamp.clampedOffset, bounds.y + yclamp.clampedOffset, xclamp.value, yclamp.value);
  }

  /*
    Adjust the number to be within the range of minimum and maximum values
  */
  function clamp(num: number, min: number = 0, max: number = Number.MAX_SAFE_INTEGER): Clamped {
    max = max < 0 ? Number.MAX_SAFE_INTEGER : max;
    const value = Math.min(Math.max(num, min, 0), max);
    return {
      value,
      clampedOffset: num < min ? -1 * (min - num) : 0 || num > max ? -1 * (num - max) : 0
    };
  }

  /**
   *
                    if (win.name === 'finj') {
                        writeToLog(1, JSON.stringify(bounds), true);
                        writeToLog(1, JSON.stringify(rect), true);
                    }

   */