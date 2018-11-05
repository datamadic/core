import * as assert from 'assert';
import * as mockery from 'mockery';

import {mockElectron} from './electron';

mockery.registerMock('electron', mockElectron);
mockery.enable({
    warnOnReplace: false,
    warnOnUnregistered: false
});
import { Rectangle, SharedBoundsList } from '../src/browser/rectangle';

describe('Rectangle', () => {
    it('should provide the correct sizes', () => {
        const rect = new Rectangle(0, 0, 100, 100);
        assert(rect.right === 100, 'should compute the right edge');
        assert(rect.bottom === 100, 'should have computed the bottom');
    });

    it('should return the shared bounds within threshold, above', () => {
        const rect1 = new Rectangle(0, 0, 100, 100);
        const rect2 = new Rectangle(0, 97, 100, 100);
        const sharedBounds = rect1.sharedBounds(rect2);
        const {hasSharedBounds, top, right, bottom, left} = sharedBounds;

        assert(hasSharedBounds, 'should have had shared bounds');
        assert(top === null, 'should not have had shared top bounds');
        assert(right === 'right', 'should have had shared right bounds');
        assert(bottom === 'top', 'should have had shared bottom bounds');
        assert(left === 'left', 'should have had shared left bounds');
    });

    it('should return the shared bounds within threshold, below', () => {
        const rect1 = new Rectangle(0, 0, 100, 100);
        const rect2 = new Rectangle(0, 104, 100, 100);
        const sharedBounds = rect1.sharedBounds(rect2);
        const {hasSharedBounds, top, right, bottom, left} = sharedBounds;

        assert(hasSharedBounds, 'should have had shared bounds');
        assert(top === null, 'should not have had shared top bounds');
        assert(right === 'right', 'should have had shared right bounds');
        assert(bottom === 'top', 'should have had shared bottom bounds');
        assert(left === 'left', 'should have had shared left bounds');
    });

    it('should return the shared bounds exactly on the threshold', () => {

        const rect1 = new Rectangle(0, 0, 100, 100);
        const rect2 = new Rectangle(0, 100, 100, 100);
        const sharedBounds = rect1.sharedBounds(rect2);
        const {hasSharedBounds, top, right, bottom, left} = sharedBounds;

        assert(hasSharedBounds, 'should have had shared bounds');
        assert(top === null, 'should not have had shared top bounds');
        assert(right === 'right', 'should have had shared right bounds');
        assert(bottom === 'top', 'should have had shared bottom bounds');
        assert(left === 'left', 'should have had shared left bounds');
    });

    it('should return the false if past the threshold', () => {

        const rect1 = new Rectangle(0, 0, 100, 100);
        const rect2 = new Rectangle(0, 106, 100, 100);
        const sharedBounds = rect1.sharedBounds(rect2);
        const {hasSharedBounds, top, right, bottom, left} = sharedBounds;

        assert(hasSharedBounds === false, 'should have had shared bounds');
        assert(top === null, 'should not have had shared top bounds');
        assert(right === null, 'should not have had shared right bounds');
        assert(bottom === null, 'should not have had shared bottom bounds');
        assert(left === null, 'should not have had shared left bounds');
    });


    it('should return true for all if directly on top', () => {

        const rect1 = new Rectangle(0, 0, 100, 100);
        const rect2 = new Rectangle(0, 0, 100, 100);
        const sharedBounds = rect1.sharedBounds(rect2);
        const {hasSharedBounds, top, right, bottom, left} = sharedBounds;

        assert(hasSharedBounds, 'should have had shared bounds');
        assert(top === 'top', 'should have had shared top bounds');
        assert(right === 'right', 'should have had shared right bounds');
        assert(bottom === 'bottom', 'should have had shared bottom bounds');
        assert(left === 'left', 'should have had shared left bounds');
    });

    it('should return true for all if directly on top, matching left bounds', () => {
        const rect1 = new Rectangle(0, 0, 100, 100);
        const rect2 = new Rectangle(0, 10, 90, 80);
        const sharedBounds = rect1.sharedBounds(rect2);
        const {hasSharedBounds, top, right, bottom, left} = sharedBounds;

        assert(hasSharedBounds, 'should have had shared bounds');
        assert(top === null, 'should not have had shared top bounds');
        assert(right === null, 'should have had shared right bounds');
        assert(bottom === null, 'should have had shared bottom bounds');
        assert(left === 'left', 'should have had shared left bounds');
    });

    it('should return true for all if directly on top, matching top, left bounds', () => {
        const rect1 = new Rectangle(0, 0, 100, 100);
        const rect2 = new Rectangle(0, 0, 90, 90);
        const sharedBounds = rect1.sharedBounds(rect2);
        const {hasSharedBounds, top, right, bottom, left} = sharedBounds;

        assert(hasSharedBounds, 'should have had shared bounds');
        assert(top === 'top', 'should not have had shared top bounds');
        assert(right === null, 'should have had shared right bounds');
        assert(bottom === null, 'should have had shared bottom bounds');
        assert(left === 'left', 'should have had shared left bounds');
    });

    it('should return true for all if directly on top, matching top only', () => {
        // bottom
        const rect1 = new Rectangle(0, 0, 100, 100);
        const rect2 = new Rectangle(10, 0, 80, 90);
        const sharedBounds = rect1.sharedBounds(rect2);
        const {hasSharedBounds, top, right, bottom, left} = sharedBounds;

        assert(hasSharedBounds, 'should have had shared bounds');
        assert(top === 'top', 'should not have had shared top bounds');
        assert(right === null, 'should have had shared right bounds');
        assert(bottom === null, 'should have had shared bottom bounds');
        assert(left === null, 'should have had shared left bounds');
    });

    it('shared bound list should return true for all if directly on top, matching top only', () => {
        const rect1 = new Rectangle(0, 0, 100, 100);
        const rect2 = new Rectangle(10, 0, 80, 90);
        const sharedBoundsList = rect1.sharedBoundsList(rect2);
        assert.deepStrictEqual(sharedBoundsList, [['top', 'top']], 'should only match top top');
    });

    it('shared bound list should return true for all if directly on top, matching top, left', () => {
        const rect1 = new Rectangle(0, 0, 100, 100);
        const rect2 = new Rectangle(0, 0, 90, 90);
        const sharedBoundsList = rect1.sharedBoundsList(rect2);
        assert.deepStrictEqual(sharedBoundsList, [['top', 'top'], ['left', 'left']], 'should only match top top');
    });

    it('should not move if no shared edges', () => {
        const rect = new Rectangle(0, 0, 100, 100);
        const move = rect.move({x: 200, y: 0, width: 100, height: 100}, {x: 300, y: 0, width: 100, height: 100});
        assert.deepStrictEqual(move.bounds, {x: 0, y: 0, width: 100, height: 100});
    });

    it('should not move if the resizing edge is not a shared one, (leader right, leader grows not shared)', () => {
        const rect = new Rectangle(0, 0, 100, 100);
        const move = rect.move({x: 100, y: 0, width: 100, height: 100}, {x: 100, y: 0, width: 110, height: 100});
        assert.deepStrictEqual(move.bounds, {x: 0, y: 0, width: 100, height: 100});
    });


    it('should move with just the leader window move (leader top, leader grows)', () => {
        const rect = new Rectangle(100, 100, 100, 100);
        const move = rect.move({x: 0, y: 0, width: 100, height: 100}, {x: 0, y: 0, width: 100, height: 110});
        assert.deepStrictEqual(move.bounds, {x: 100, y: 110, width: 100, height: 90});
    });

    it('should move with just the leader window move (leader top, leader shrinks)', () => {
        const rect = new Rectangle(100, 100, 100, 100);
        const move = rect.move({x: 0, y: 0, width: 100, height: 100}, {x: 0, y: 0, width: 100, height: 90});
        assert.deepStrictEqual(move.bounds, {x: 100, y: 90, width: 100, height: 110});
    });

    it('should move with just the leader window move (leader bottom, leader grows)', () => {
        const rect = new Rectangle(100, 100, 100, 100);
        const move = rect.move({x: 0, y: 200, width: 100, height: 100}, {x: 0, y: 190, width: 100, height: 110});
        assert.deepStrictEqual(move.bounds, {x: 100, y: 100, width: 100, height: 90});
    });

    it('should move with just the leader window move (leader bottom, leader shrinks)', () => {
        const rect = new Rectangle(100, 100, 100, 100);
        const move = rect.move({x: 0, y: 200, width: 100, height: 100}, {x: 0, y: 210, width: 100, height: 90});
        assert.deepStrictEqual(move.bounds, {x: 100, y: 100, width: 100, height: 110});
    });

    it('should move with just the leader window move (leader left, leader grows)', () => {
        const rect = new Rectangle(100, 0, 100, 100);
        const move = rect.move({x: 0, y: 0, width: 100, height: 100}, {x: 0, y: 0, width: 110, height: 100});
        assert.deepStrictEqual(move.bounds, {x: 110, y: 0, width: 90, height: 100});
    });

    it('should move with just the leader window move (leader left, leader shrinks)', () => {
        const rect = new Rectangle(100, 0, 100, 100);
        const move = rect.move({x: 0, y: 0, width: 100, height: 100}, {x: 0, y: 0, width: 90, height: 100});
        assert.deepStrictEqual(move.bounds, {x: 90, y: 0, width: 110, height: 100});
    });

    it('should move with just the leader window move (leader right, leader grows)', () => {
        const rect = new Rectangle(0, 0, 100, 100);
        const move = rect.move({x: 100, y: 0, width: 100, height: 100}, {x: 90, y: 0, width: 110, height: 100});
        assert.deepStrictEqual(move.bounds, {x: 0, y: 0, width: 90, height: 100});
    });

    it('should move with just the leader window move (leader right, leader shrinks)', () => {
        const rect = new Rectangle(0, 0, 100, 100);
        const move = rect.move({x: 100, y: 0, width: 100, height: 100}, {x: 110, y: 0, width: 90, height: 100});
        assert.deepStrictEqual(move.bounds, {x: 0, y: 0, width: 110, height: 100});
    });


    it('should align the side given, left to right', () => {
        const rect = new Rectangle(100, 0, 100, 100);
        const otherRect = {x: 0, y: 0, width: 90, height: 100};
        const aligned = rect.alignSide('left', Rectangle.CREATE_FROM_BOUNDS(otherRect), 'right');
        assert(aligned.x === 90, 'side should line up');
        assert(aligned.width === 110, 'width should have been adjusted');
    });

    it('should align the side given, top to bottom', () => {
        const rect = new Rectangle(0, 110, 100, 100);
        const otherRect = {x: 0, y: 0, width: 100, height: 100};
        const aligned = rect.alignSide('top', Rectangle.CREATE_FROM_BOUNDS(otherRect), 'bottom');
        assert.deepStrictEqual(aligned.bounds, {x: 0, y: 100, width: 100, height: 110});
    });

    it('should return an adjacency list, quickly :)', () => {
        const NS_PER_SEC = 1e9;
        const time = process.hrtime();
        const adjList = Rectangle.ADJACENCY_LIST([
            new Rectangle(0, 0, 100, 100),
            new Rectangle(4, 4, 100, 100),
            new Rectangle(8, 8, 100, 100),
            new Rectangle(50, 0, 100, 100),
            new Rectangle(400, 400, 100, 100),
            new Rectangle(6, 6, 100, 100)
        ]);

        const diff = process.hrtime(time);
        const diffInMilliSec = (diff[0] * NS_PER_SEC + diff[1]) / 1e6;
        assert(diffInMilliSec < 5);
    });

    it ('should grow correctly on external monitors with negative y', () => {
        const rect = Rectangle.CREATE_FROM_BOUNDS({'x': 1206, 'y': -540, 'width': 491, 'height': 253});
        const grownUp = rect.grow(5, 5);

        assert.deepStrictEqual(grownUp, Rectangle.CREATE_FROM_BOUNDS({'x': 1201, 'y': -545, 'width': 501, 'height': 263}));
    });

    it ('should grow correctly on external monitors with negative x', () => {
        const rect = Rectangle.CREATE_FROM_BOUNDS({'x': -1206, 'y': 540, 'width': 491, 'height': 253});
        const grownUp = rect.grow(5, 5);

        assert.deepStrictEqual(grownUp, Rectangle.CREATE_FROM_BOUNDS({'x': -1211, 'y': 535, 'width': 501, 'height': 263}));
    });

    it ('should grow correctly on external monitors with negative x, y', () => {
        const rect = Rectangle.CREATE_FROM_BOUNDS({'x': -1206, 'y': -540, 'width': 491, 'height': 253});
        const grownUp = rect.grow(5, 5);

        assert.deepStrictEqual(grownUp, Rectangle.CREATE_FROM_BOUNDS({'x': -1211, 'y': -545, 'width': 501, 'height': 263}));
    });

    it('should collide', () => {
        const rect = Rectangle.CREATE_FROM_BOUNDS({'x': 918, 'y': -1009, 'width': 670, 'height': 454});
        const rect2 = Rectangle.CREATE_FROM_BOUNDS({'x': 952, 'y': -556, 'width': 641, 'height': 549});
        const collides = rect.collidesWith(rect2);

        assert(collides, 'should have collided, top to bottom and right to right');
    });
    it('doesnt move to negative height', () => {
        const rect1From = Rectangle.CREATE_FROM_BOUNDS({ 'x': 5104, 'y': -560, 'width': 340, 'height': 349 });
        const rect1To = Rectangle.CREATE_FROM_BOUNDS({'x': 5104, 'y': -908, 'width': 306, 'height': 697});
        const rect = Rectangle.CREATE_FROM_BOUNDS({ 'x': 5104, 'y': -686, 'width': 340, 'height': 126 });
        const result = rect.move(rect1From, rect1To);
        assert(result.height === 38);
    });
    it('doesnt move to negative height2', () => {
        const rect1From = Rectangle.CREATE_FROM_BOUNDS({ 'x': 0, 'y': -100, 'width': 100, 'height': 100 });
        const rect1To = Rectangle.CREATE_FROM_BOUNDS({ 'x': 0, 'y': -200, 'width': 100, 'height': 200 });
        const rect = Rectangle.CREATE_FROM_BOUNDS({ 'x': 0, 'y': -150, 'width': 100, 'height': 50 });
        const result = rect.move(rect1From, rect1To);
        assert(result.height === 38);
    });

    it('should check if one graph is a subgraph of the other', () => {
        const g1 = Rectangle.SETIFY_GRAPH( Rectangle.GRAPH([
            new Rectangle(0, 0, 100, 100),
            new Rectangle(4, 4, 100, 100),
            new Rectangle(8, 8, 100, 100),
            new Rectangle(50, 0, 100, 100),
            new Rectangle(400, 400, 100, 100),
            new Rectangle(6, 6, 100, 100),
            new Rectangle(8, 8, 100, 100),
            new Rectangle(10, 10, 100, 100)
        ]));

        const isSubGraph = Rectangle.IS_SUBGRAPH(g1, g1);
        assert(isSubGraph, 'all graphs are a subgraph of themselves');
    });

    it('should fail to be a subgraph if missing rect', () => {
        const g1 = Rectangle.SETIFY_GRAPH( Rectangle.GRAPH([
            new Rectangle(0, 0, 100, 100),
            new Rectangle(4, 4, 100, 100),
            new Rectangle(8, 8, 100, 100),
            new Rectangle(50, 0, 100, 100),
            new Rectangle(400, 400, 100, 100),
            new Rectangle(6, 6, 100, 100),
            new Rectangle(8, 8, 100, 100),
            new Rectangle(10, 10, 100, 100)
        ]));

        const g2 = Rectangle.SETIFY_GRAPH( Rectangle.GRAPH([
            new Rectangle(0, 0, 100, 100),
            new Rectangle(4, 4, 100, 100),
            new Rectangle(8, 8, 100, 100),
            new Rectangle(50, 0, 100, 100),
            new Rectangle(400, 400, 100, 100),
            new Rectangle(6, 6, 100, 100),
            new Rectangle(8, 8, 100, 100)
        ]));

        const isSubGraph = Rectangle.IS_SUBGRAPH(g1, g2);
        assert(!isSubGraph, 'all graphs are a subgraph of themselves');
    });
});