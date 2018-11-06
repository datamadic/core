import { OpenFinWindow } from '../shapes';
import of_events from './of_events';
import route from '../common/route';
import { windowTransaction } from 'electron';
const WindowTransaction = require('electron').windowTransaction;
import {Rectangle, RectangleBase} from './rectangle';
import { writeToLog } from './log';

const isWin32 = process.platform === 'win32';

/*
Edge cases
respect max
whether to restore frame on leave
disabled window moving
event propagation
*/

const groupTrackerCache = new Map<string, GroupTracker>();
export class GroupTracker {
    private windowMap: Map<string, OpenFinWindow>;
    private listenerCache: Map<string, (...args: any[]) => void> = new Map();
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
        const winId = win.browserWindow.nativeId;
        win.browserWindow.setUserMovementEnabled(false);
        this.windowMap.set(winId, win);
        //Need to remove handler on leave
        const listener = (e: any, newBounds: RectangleBase, changeType: number) => {
            if (this.boundsChanging) {
                this.payloadCache.push([winId, e, newBounds, changeType]);
            } else {
                this.boundsChanging = true;
                this.handleBoundsChanging(winId, e, newBounds, changeType);
                this.interval = setInterval(() => {
                    if (this.payloadCache.length) {
                       const [a, b, c, d] = this.payloadCache.pop();
                       this.handleBoundsChanging(a, b, c, d);
                       this.payloadCache = [];
                    }
                }, 16);
                win.browserWindow.once('disabled-frame-bounds-changed', (e: any, newBounds: RectangleBase, changeType: number) => {
                    this.boundsChanging = false;
                    this.payloadCache = [];
                    this.handleBoundsChanging(winId, e, newBounds, changeType);
                    clearInterval(this.interval);
                });
            }
        };
        this.listenerCache.set(winId, listener);
        win.browserWindow.on('disabled-frame-bounds-changing', listener);
    }

    private handleBoundsChanging = (winId: string, e: any, newBounds: RectangleBase, changeType: number): any => {

        writeToLog(1, `owning window: ${this.windowMap.get(winId).name}`, true);
        switch (changeType) {
            case 0: {
                const thisBounds = this.windowMap.get(winId).browserWindow.getBounds();
                const delta = Rectangle.CREATE_FROM_BOUNDS(thisBounds).delta(newBounds);
                if (isWin32) {
                    this.win32Move(delta);
                } else {
                    this.windowMap.forEach(win => {
                        const bounds = win.browserWindow.getBounds();
                        // const hwnd = parseInt(win.browserWindow.nativeId, 16);
                        const rect = Rectangle.CREATE_FROM_BOUNDS(bounds).shift(delta).transactionBounds;
                        const {x, y, w: width, h: height} = rect;
                        // wt.setWindowPos(hwnd, { ...rect, flags });
                        win.browserWindow.setBounds({x, y, width, height});
                    });
                }
            } break;
            default: {
                if (isWin32) {
                    this.win32DefaultMove(winId, newBounds);
                } else {
                    const leadingWindow = this.windowMap.get(winId);
                    let leaderIdx: number;
                    const positions: Map<string, Rectangle> = new Map();

                    [...this.windowMap].forEach(([nativeId, win], index) => {
                        positions.set(nativeId, Rectangle.CREATE_FROM_BROWSER_WINDOW(win.browserWindow));

                        if (nativeId === winId) {
                            leaderIdx = index;
                        }
                    });

                    const graphInitial = Rectangle.SETIFY_GRAPH(Rectangle.GRAPH_WITH_SIDE_DISTANCES([...positions].map(([, b]) => b)));
                    const moves: Array<() => void> = [];


                    const thisRect = Rectangle.CREATE_FROM_BROWSER_WINDOW(this.windowMap.get(winId).browserWindow);

                    this.windowMap.forEach(win => {
                        const bounds = win.browserWindow.getBounds();


                        const rect = clipBounds(Rectangle.CREATE_FROM_BOUNDS(bounds).move(thisRect, newBounds), win.browserWindow);

                        if (win.name === 'finj') {
                            writeToLog(1, JSON.stringify(bounds), true);
                            writeToLog(1, JSON.stringify(rect), true);
                        }

                        positions.set(win.browserWindow.nativeId, rect);
                        moves.push(() => win.browserWindow.setBounds(rect));
                    });

                    const graphFinal = Rectangle.SETIFY_GRAPH(Rectangle.GRAPH_WITH_SIDE_DISTANCES([...positions].map(([, b]) => b)));

                    if (Rectangle.IS_SUBGRAPH(graphInitial, graphFinal)) {
                        moves.forEach(move => move());
                    } else {
                        writeToLog(1, '$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$', true);
                    }
                }

            } break;
            // default: {
            //     const thisBounds = this.windowMap.get(winId).browserWindow.getBounds();
            //     const delta = Rectangle.CREATE_FROM_BOUNDS(thisBounds).delta(newBounds);
            //     const wt = new WindowTransaction.Transaction(0);
            //     const { flag: { noZorder, noActivate } } = WindowTransaction;
            //     const flags = noZorder + noActivate;

            //     this.windowMap.forEach(win => {
            //         const bounds = win.browserWindow.getBounds();
            //         const hwnd = parseInt(win.browserWindow.nativeId, 16);
            //         const rect = Rectangle.CREATE_FROM_BOUNDS(bounds).move(thisBounds, newBounds).transactionBounds;
            //         wt.setWindowPos(hwnd, { ...rect, flags });
            //     });
            //     wt.commit();

            // }break;
        }
    }
    private win32DefaultMove(winId: string, newBounds: RectangleBase) {
        const thisRect = Rectangle.CREATE_FROM_BROWSER_WINDOW(this.windowMap.get(winId).browserWindow);
        // const moveZone = thisRect.outerBounds(newBounds);
        const wt = new WindowTransaction.Transaction(0);
        const { flag: { noZorder, noActivate } } = WindowTransaction;
        const flags = noZorder + noActivate;
        // const otherWindows = Array.from(this.windowMap.values()).filter(w => w !== win);
        // const otherRects = otherWindows.map(w => Rectangle.CREATE_FROM_BROWSER_WINDOW(w.browserWindow));
        // const adjacent = thisRect.adjacent(otherRects);
        this.windowMap.forEach(win => {
            const bounds = win.browserWindow.getBounds();
            const hwnd = parseInt(win.browserWindow.nativeId, 16);
            const rect = Rectangle.CREATE_FROM_BOUNDS(bounds).move(thisRect, newBounds).transactionBounds;
            wt.setWindowPos(hwnd, { ...rect, flags });
        });
        wt.commit();
    }

    private win32Move(delta: RectangleBase) {
        const wt = new WindowTransaction.Transaction(0);
        const { flag: { noZorder, noSize, noActivate } } = WindowTransaction;
        const flags = noZorder + noSize + noActivate;
        this.windowMap.forEach(win => {
            const bounds = win.browserWindow.getBounds();
            const hwnd = parseInt(win.browserWindow.nativeId, 16);
            const rect = Rectangle.CREATE_FROM_BOUNDS(bounds).shift(delta).transactionBounds;
            wt.setWindowPos(hwnd, { ...rect, flags });
        });
        wt.commit();
    }

    public removeWindowFromGroup(win: OpenFinWindow) {
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