#!/usr/bin/env python3
"""Draw the app's icon set in VectorCraft and export it as SVG.

One document, one artboard per glyph, exported artboard by artboard. The
geometry is defined once here as primitives (rect / line / circle / ellipse /
polygon / path) on a 24 px grid; the 16 px tree variants are the same
primitives scaled by 2/3 with a 1.25 pt stroke, so the two grids cannot drift
apart.

    python3 tools/make-icons.py --out /tmp/icons      # inspect first
    python3 tools/make-icons.py                       # write src/brand/icons

VectorCraft writes #000000 for the stroke; the export step rewrites it to
currentColor, which is what lets an icon take the colour of its button (see
src/ui/icons.js).
"""
import argparse
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, 'src', 'brand', 'icons')

# --------------------------------------------------------------- primitives


def R(x, y, w, h, r=0, fill=False, dash=None, sw=None):
    return {'t': 'rect', 'x': x, 'y': y, 'w': w, 'h': h, 'r': r,
            'fill': fill, 'dash': dash, 'sw': sw}


def L(x1, y1, x2, y2, fill=False, dash=None, sw=None):
    return {'t': 'line', 'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2,
            'fill': fill, 'dash': dash, 'sw': sw}


def C(cx, cy, r, fill=False, dash=None):
    return {'t': 'circle', 'cx': cx, 'cy': cy, 'r': r,
            'fill': fill, 'dash': dash}


def E(cx, cy, rx, ry, fill=False, dash=None):
    return {'t': 'ellipse', 'cx': cx, 'cy': cy, 'rx': rx, 'ry': ry,
            'fill': fill, 'dash': dash}


def POLY(pts, fill=False, dash=None):
    return {'t': 'poly', 'pts': pts, 'fill': fill, 'dash': dash}


def P(*cmds, fill=False, dash=None, sw=None):
    return {'t': 'path', 'cmds': cmds, 'fill': fill, 'dash': dash, 'sw': sw}


def _n(v, s, off=0.0):
    return '%g' % round(v * s + off, 2)


def to_d(p, s, ox=0.0, oy=0.0):
    """SVG path data for a primitive, scaled by s and placed at (ox, oy)."""
    t = p['t']
    X = lambda v: _n(v, s, ox)
    Y = lambda v: _n(v, s, oy)
    if t == 'rect':
        x, y, w, h, r = p['x'], p['y'], p['w'], p['h'], p['r']
        if r:
            return ('M %s %s H %s A %s %s 0 0 1 %s %s V %s A %s %s 0 0 1 %s %s '
                    'H %s A %s %s 0 0 1 %s %s V %s A %s %s 0 0 1 %s %s Z') % (
                X(x + r), Y(y), X(x + w - r), _n(r, s), _n(r, s), X(x + w), Y(y + r),
                Y(y + h - r), _n(r, s), _n(r, s), X(x + w - r), Y(y + h), X(x + r),
                _n(r, s), _n(r, s), X(x), Y(y + h - r), Y(y + r), _n(r, s), _n(r, s),
                X(x + r), Y(y))
        return 'M %s %s H %s V %s H %s Z' % (X(x), Y(y), X(x + w), Y(y + h), X(x))
    if t == 'line':
        return 'M %s %s L %s %s' % (X(p['x1']), Y(p['y1']), X(p['x2']), Y(p['y2']))
    if t == 'circle':
        cx, cy, r = p['cx'], p['cy'], p['r']
        return ('M %s %s A %s %s 0 1 0 %s %s A %s %s 0 1 0 %s %s Z') % (
            X(cx - r), Y(cy), _n(r, s), _n(r, s), X(cx + r), Y(cy),
            _n(r, s), _n(r, s), X(cx - r), Y(cy))
    if t == 'ellipse':
        cx, cy, rx, ry = p['cx'], p['cy'], p['rx'], p['ry']
        return ('M %s %s A %s %s 0 1 0 %s %s A %s %s 0 1 0 %s %s Z') % (
            X(cx - rx), Y(cy), _n(rx, s), _n(ry, s), X(cx + rx), Y(cy),
            _n(rx, s), _n(ry, s), X(cx - rx), Y(cy))
    if t == 'poly':
        head = 'M %s %s' % (X(p['pts'][0][0]), Y(p['pts'][0][1]))
        body = ' '.join('L %s %s' % (X(x), Y(y)) for x, y in p['pts'][1:])
        return '%s %s Z' % (head, body)
    if t == 'path':
        out = []
        for c in p['cmds']:
            op = c[0]
            if op == 'Z':
                out.append('Z')
            elif op == 'A':
                rx, ry, rot, laf, sf, x, y = c[1:]
                out.append('A %s %s %s %s %s %s %s' % (
                    _n(rx, s), _n(ry, s), _n(rot, 1), int(laf), int(sf), X(x), Y(y)))
            elif op == 'C':
                a = c[1:]
                out.append('C %s' % ' '.join(
                    X(a[i]) if i % 2 == 0 else Y(a[i]) for i in range(6)))
            else:
                out.append('%s %s %s' % (op, X(c[1]), Y(c[2])))
        return ' '.join(out)
    raise ValueError(t)


# ------------------------------------------------------------- the icon set

SHAPES = {
    # --- structural -------------------------------------------------------
    'class': [R(3, 4, 18, 16), L(3, 9.5, 21, 9.5), L(3, 15, 21, 15)],
    'interface': [C(6, 12, 3.25), L(9.25, 12, 12, 12), R(12, 6.5, 9, 11),
                  L(12, 11.5, 21, 11.5)],
    'enumeration': [R(3, 4.5, 18, 15), L(3, 9.5, 21, 9.5), C(7, 12.5, 1, True),
                    C(7, 16, 1, True), L(10, 12.5, 18, 12.5), L(10, 16, 16, 16)],
    'datatype': [R(3, 4.5, 18, 15), L(3, 9.5, 21, 9.5), L(8, 12, 16, 12),
                 L(12, 12, 12, 17.5)],
    'package': [P(('M', 3, 5), ('L', 11, 5), ('L', 11, 8.5)), R(3, 8.5, 18, 10.5)],
    'model': [P(('M', 3, 5), ('L', 10, 5), ('L', 10, 8.5)), R(3, 8.5, 18, 10.5),
              R(7.5, 12, 9, 4.5)],
    'profile': [P(('M', 3, 5), ('L', 10, 5), ('L', 10, 8.5)), R(3, 8.5, 18, 10.5),
                P(('M', 9, 17.5), ('L', 9, 11.5), ('L', 11.5, 11.5),
                  ('A', 2.2, 2.2, 0, 0, 1, 11.5, 15.9), ('L', 9, 15.9))],
    'component': [R(5.75, 3.5, 15.5, 17), R(2.75, 7.5, 4.5, 3.5),
                  R(2.75, 13, 4.5, 3.5)],
    'artifact': [R(7, 2.5, 6, 3), R(4, 5.5, 16, 14.5), L(9, 10.5, 15, 10.5),
                 L(9, 14, 15, 14)],
    'deployment-spec': [R(4, 5.5, 16, 14.5), L(7.5, 9.5, 13.5, 9.5),
                        L(7.5, 12.75, 16.5, 12.75), L(7.5, 16, 14.5, 16)],
    'node': [R(3, 9, 12, 10), P(('M', 3, 9), ('L', 8, 4), ('L', 20, 4), ('L', 15, 9), ('Z',)),
             P(('M', 15, 9), ('L', 20, 4), ('L', 20, 14), ('L', 15, 19), ('Z',))],
    'device': [R(3, 9, 12, 10), P(('M', 3, 9), ('L', 8, 4), ('L', 20, 4), ('L', 15, 9), ('Z',)),
               P(('M', 15, 9), ('L', 20, 4), ('L', 20, 14), ('L', 15, 19), ('Z',)),
               R(6, 12.5, 6, 3.5)],
    'execution-environment': [
        R(3, 9, 12, 10), P(('M', 3, 9), ('L', 8, 4), ('L', 20, 4), ('L', 15, 9), ('Z',)),
        P(('M', 15, 9), ('L', 20, 4), ('L', 20, 14), ('L', 15, 19), ('Z',)),
        L(6, 13, 12, 13), L(6, 16.5, 12, 16.5)],
    'object': [R(3, 5, 18, 14), L(7, 9.5, 16, 9.5), L(7, 13.5, 14, 13.5)],
    'part': [R(3, 3.5, 5, 5, fill=True), R(6.5, 7, 14, 13.5)],
    'port': [R(3, 6, 12, 12), R(15, 9.25, 5.5, 5.5)],
    'collaboration': [E(12, 12, 8.5, 5.5), C(12, 12, 3)],
    'collaboration-use': [E(12, 12, 8.5, 5.5, dash=[4, 2.5]), C(12, 12, 3)],
    'stereotype': [R(3, 4, 18, 16), P(('M', 9.5, 10), ('L', 7, 12.5), ('L', 9.5, 15)),
                   P(('M', 14.5, 10), ('L', 17, 12.5), ('L', 14.5, 15))],
    'metaclass': [R(3, 4, 18, 16),
                  P(('M', 8, 16), ('L', 8, 10), ('L', 12, 14), ('L', 16, 10), ('L', 16, 16))],
    # --- behaviour --------------------------------------------------------
    'actor': [C(12, 6.4, 2.4),
              P(('M', 12, 8.8), ('L', 12, 14.2), ('M', 7.8, 10.6), ('L', 16.2, 10.6),
                ('M', 12, 14.2), ('L', 8.6, 19.4), ('M', 12, 14.2), ('L', 15.4, 19.4))],
    'usecase': [E(12, 12, 8.5, 5.5)],
    'system-boundary': [R(3, 4, 18, 16), L(6, 8.5, 12, 8.5)],
    'note': [POLY([(4, 4), (15, 4), (20, 9), (20, 20), (4, 20)]),
             P(('M', 15, 4), ('L', 15, 9), ('L', 20, 9))],
    'text': [L(5, 6.5, 19, 6.5), L(12, 6.5, 12, 18), L(8, 18, 16, 18)],
    'state': [R(3, 5, 18, 14, 4), L(8, 10.5, 16, 10.5), L(8, 14, 13, 14)],
    'initial': [C(12, 12, 4, True)],
    'final': [C(12, 12, 4.5), C(12, 12, 2.6, True)],
    'choice': [POLY([(12, 6.5), (17.5, 12), (12, 17.5), (6.5, 12)])],
    'junction': [C(12, 12, 2.2, True)],
    'history-shallow': [C(12, 12, 5), L(8.5, 12, 15.5, 12)],
    'history-deep': [C(12, 12, 5), L(8.5, 10.5, 15.5, 10.5), L(8.5, 13.5, 15.5, 13.5)],
    'entry-point': [C(12, 12, 5), P(('M', 7.5, 12), ('L', 13.5, 12)),
                    P(('M', 11.2, 9.7), ('L', 13.5, 12), ('L', 11.2, 14.3))],
    'exit-point': [C(12, 12, 5), P(('M', 10.5, 12), ('L', 16.5, 12)),
                   P(('M', 14.2, 9.7), ('L', 16.5, 12), ('L', 14.2, 14.3))],
    'terminate': [L(7, 7, 17, 17, sw=2.6), L(17, 7, 7, 17, sw=2.6)],
    'action': [R(3, 5, 18, 14, 4), POLY([(10, 9.5), (15, 12), (10, 14.5)])],
    'activity': [R(3, 3.5, 18, 17), L(3, 8.5, 21, 8.5), R(6.5, 12, 11, 5, 2.5)],
    'decision': [POLY([(12, 4.5), (19, 12), (12, 19.5), (5, 12)]),
                 P(('M', 10.8, 18.4), ('L', 8.5, 21.5)), P(('M', 13.2, 18.4), ('L', 15.5, 21.5))],
    'merge': [POLY([(12, 4.5), (19, 12), (12, 19.5), (5, 12)]),
              P(('M', 8.5, 2.5), ('L', 10.8, 5.6)), P(('M', 15.5, 2.5), ('L', 13.2, 5.6))],
    'fork': [R(4, 10.75, 16, 2.5, 1.25, True), P(('M', 12, 4.5), ('L', 12, 10.75)),
             P(('M', 8, 13.25), ('L', 8, 19.5)), P(('M', 16, 13.25), ('L', 16, 19.5))],
    'join': [R(4, 10.75, 16, 2.5, 1.25, True), P(('M', 8, 4.5), ('L', 8, 10.75)),
             P(('M', 16, 4.5), ('L', 16, 10.75)), P(('M', 12, 13.25), ('L', 12, 19.5))],
    'object-node': [R(3, 5, 18, 14), C(6.5, 9.5, 1.5, True), L(10, 9.5, 17, 9.5),
                    L(7, 14, 17, 14)],
    'activity-parameter': [R(6, 6, 15, 12), R(2, 9.75, 5.5, 5.5)],
    'swimlane': [R(3, 3.5, 18, 17), L(3, 8.5, 21, 8.5), L(12, 8.5, 12, 20.5)],
    'lifeline': [R(8, 3.5, 8, 5), L(12, 8.5, 12, 20.5, dash=[3, 2])],
    'actor-lifeline': [C(12, 5, 2.2),
                       P(('M', 12, 7.2), ('L', 12, 11), ('M', 8.8, 8.6), ('L', 15.2, 8.6),
                         ('M', 12, 11), ('L', 9.5, 14.5), ('M', 12, 11), ('L', 14.5, 14.5)),
                       L(12, 15.5, 12, 21, dash=[3, 2])],
    'activation': [R(9.5, 3.5, 5, 17)],
    'fragment': [R(3, 5, 18, 14), P(('M', 3, 9), ('L', 9, 9), ('L', 9, 5))],
    'interaction-use': [R(3, 5, 18, 14), P(('M', 3, 9), ('L', 9, 9), ('L', 9, 5)),
                        R(7, 11.5, 10, 5)],
    'interaction': [R(3, 5, 18, 14), P(('M', 3, 9), ('L', 9, 9), ('L', 9, 5)),
                    L(8, 10.5, 8, 19, dash=[3, 2]), L(12, 10.5, 12, 19, dash=[3, 2]),
                    L(16, 10.5, 16, 19, dash=[3, 2])],
    'timing-lane': [R(3, 5, 18, 14),
                    P(('M', 6, 15.5), ('L', 9, 15.5), ('L', 9, 10), ('L', 12.5, 10),
                      ('L', 12.5, 15.5), ('L', 15.5, 15.5), ('L', 15.5, 10), ('L', 18, 10))],
}

ARROW = P(('M', 15.5, 8.5), ('L', 21, 12), ('L', 15.5, 15.5))
TRI = POLY([(15.5, 8.5), (21, 12), (15.5, 15.5)])
DIAMOND = POLY([(3, 12), (6.5, 9.5), (10, 12), (6.5, 14.5)])

CONNECTORS = {
    'association': [L(3, 12, 21, 12)],
    'aggregation': [DIAMOND, L(10, 12, 21, 12)],
    'composition': [POLY(DIAMOND['pts'], True), L(10, 12, 21, 12)],
    'generalization': [L(3, 12, 15.5, 12), TRI],
    'realization': [L(3, 12, 15.5, 12, dash=[3, 2]), TRI],
    'extension': [L(3, 12, 15.5, 12), TRI, C(4.5, 12, 1.8, True)],
    'dependency': [L(3, 12, 15.5, 12, dash=[3, 2]), ARROW],
    'usage': [L(3, 12, 15.5, 12, dash=[2, 2]), ARROW, L(4.5, 9.5, 4.5, 14.5)],
    'import': [L(3, 12, 15.5, 12, dash=[3, 2]), ARROW,
               P(('M', 3, 10), ('L', 5.5, 10), ('L', 5.5, 11.2)), R(3, 11.2, 4.6, 3.4)],
    'merge': [L(3, 12, 15.5, 12, dash=[3, 2]), ARROW,
              POLY([(3.5, 12), (5.75, 9.75), (8, 12), (5.75, 14.25)])],
    'include': [L(3, 12, 15.5, 12, dash=[3, 2]), ARROW, C(5, 12, 1.7)],
    'extend': [L(3, 12, 15.5, 12, dash=[3, 2]), ARROW,
               POLY([(3.5, 12), (6.5, 9.5), (6.5, 14.5)])],
    'manifest': [L(3, 12, 15.5, 12, dash=[3, 2]), ARROW,
                 P(('M', 4, 14.5), ('L', 4, 10), ('L', 6, 12), ('L', 8, 10), ('L', 8, 14.5))],
    'trace': [L(3, 12, 15.5, 12, dash=[1.5, 1.5]), ARROW,
              L(4.5, 9.5, 4.5, 14.5), L(6.5, 9.5, 6.5, 14.5)],
    'assembly': [L(6, 12, 18.8, 12),
                 P(('M', 6, 9.8), ('C', 4.785, 9.8, 3.8, 10.785, 3.8, 12),
                   ('C', 3.8, 13.215, 4.785, 14.2, 6, 14.2)),
                 C(18.8, 12, 2.2, True)],
    'delegation': [L(6, 12, 17.5, 12), ARROW,
                   P(('M', 6, 9.8), ('C', 4.785, 9.8, 3.8, 10.785, 3.8, 12),
                     ('C', 3.8, 13.215, 4.785, 14.2, 6, 14.2))],
    'connector': [L(5, 12, 19, 12), C(3.5, 12, 1.8), C(20.5, 12, 1.8)],
    'link': [L(3, 12, 8, 12), L(16, 12, 21, 12), C(10.5, 12, 2.5), C(13.5, 12, 2.5)],
    'communication-path': [L(3, 11, 21, 11), L(3, 13, 21, 13)],
    'control-flow': [L(3, 12, 15.5, 12), ARROW],
    'object-flow': [L(3, 12, 15.5, 12), ARROW, R(9.5, 10, 4, 4)],
    'transition': [L(3, 12, 15.5, 12), ARROW, C(4.5, 12, 1.8, True)],
    'message': [L(3, 12, 15.5, 12), POLY([(15.5, 9), (21, 12), (15.5, 15)], True)],
    'reply': [L(3, 12, 15.5, 12, dash=[2, 2]), ARROW, C(4.5, 12, 1.6, True)],
    'create-message': [L(3, 12, 13, 12, dash=[2, 2]),
                       P(('M', 13, 9.5), ('L', 16.5, 12), ('L', 13, 14.5)),
                       R(16.5, 9.75, 4.5, 4.5)],
    'destroy-message': [L(3, 12, 14, 12),
                        P(('M', 14, 9.5), ('L', 17, 12), ('L', 14, 14.5)),
                        L(17.5, 10.5, 20.5, 13.5), L(20.5, 10.5, 17.5, 13.5)],
    'deployment': [L(3, 12, 15.5, 12, dash=[4, 2]), ARROW, R(3, 9.75, 4.6, 4.6, fill=True)],
}

UI = {
    'ui-panel-left': [R(3, 4, 18, 16), L(9, 4, 9, 20)],
    'ui-panel-right': [R(3, 4, 18, 16), L(15, 4, 15, 20)],
    'ui-help': [C(12, 12, 8.5),
                P(('M', 9.4, 9.6), ('A', 2.7, 2.7, 0, 0, 1, 12.6, 12.4),
                  ('C', 12, 12.9, 12, 13.4, 12, 14)),
                C(12, 17.2, 0.9, True)],
    'ui-plus': [L(12, 5, 12, 19), L(5, 12, 19, 12)],
    'ui-close': [L(6.5, 6.5, 17.5, 17.5), L(17.5, 6.5, 6.5, 17.5)],
    'ui-chevron-down': [P(('M', 7, 10), ('L', 12, 15), ('L', 17, 10))],
    'ui-arrow-up': [L(12, 19, 12, 5), P(('M', 6.5, 10.5), ('L', 12, 5), ('L', 17.5, 10.5))],
    'ui-arrow-down': [L(12, 5, 12, 19), P(('M', 6.5, 13.5), ('L', 12, 19), ('L', 17.5, 13.5))],
    'ui-diagram': [R(3, 4, 18, 16), L(3, 9, 21, 9), L(9, 9, 9, 20)],
    'ui-undo': [P(('M', 9, 6), ('L', 4.5, 10.5), ('L', 9, 15)),
                P(('M', 4.5, 10.5), ('L', 14, 10.5), ('A', 4, 4, 0, 0, 1, 14, 18.5),
                  ('L', 11, 18.5))],
    'ui-redo': [P(('M', 15, 6), ('L', 19.5, 10.5), ('L', 15, 15)),
                P(('M', 19.5, 10.5), ('L', 10, 10.5), ('A', 4, 4, 0, 0, 0, 10, 18.5),
                  ('L', 13, 18.5))],
    'ui-save': [R(4, 4, 16, 16), P(('M', 8, 4), ('L', 8, 9), ('L', 16, 9), ('L', 16, 4)),
                R(7, 13, 10, 7)],
    'ui-open': [P(('M', 3, 6), ('L', 9.5, 6), ('L', 11.5, 8.5), ('L', 21, 8.5),
                  ('L', 21, 19), ('L', 3, 19), ('Z',))],
    'ui-export': [P(('M', 12, 3.5), ('L', 12, 14)), P(('M', 8, 7.5), ('L', 12, 3.5),
                                                       ('L', 16, 7.5)),
                  P(('M', 4, 14), ('L', 4, 20), ('L', 20, 20), ('L', 20, 14))],
    'ui-grid': [R(3, 3, 18, 18), L(3, 9, 21, 9), L(3, 15, 21, 15), L(9, 3, 9, 21),
                L(15, 3, 15, 21)],
    'ui-palette': [C(12, 12, 8.5), C(9, 9.5, 1.1, True), C(14.8, 9, 1.1, True),
                   C(15, 14, 1.1, True)],
    # Библиотека — раскрытая книга: «собрание знаний». Ни один другой глиф
    # набора не книга, поэтому силуэт узнаётся и в 16 px: корешок по центру,
    # две страницы крыльями.
    'ui-library': [P(('M', 3.2, 6.4), ('C', 6, 4.8, 9, 4.8, 12, 6.2),
                     ('C', 15, 4.8, 18, 4.8, 20.8, 6.4),
                     ('L', 20.8, 18), ('C', 18, 16.6, 15, 16.6, 12, 18),
                     ('C', 9, 16.6, 6, 16.6, 3.2, 18), ('Z',)),
                   L(12, 6.2, 12, 18)],
    # Курс — последовательность уроков: три строки с отметками, а не книга.
    # В 16 px читается как список из трёх пунктов; с библиотекой не путается
    # ни силуэтом, ни плотностью.
    'ui-course': [C(5.2, 7, 1.1, True), L(9, 7, 20, 7),
                  C(5.2, 12, 1.1, True), L(9, 12, 20, 12),
                  C(5.2, 17, 1.1, True), L(9, 17, 15.5, 17)],
}


# ------------------------------------------------------------------ drawing

def build(out_dir, scale16=2 / 3.0):
    jobs = []            # (name, prims, size, artboard_index)
    for name, prims in list(SHAPES.items()):
        jobs.append((f'shape-{name}', prims, 24))
        jobs.append((f'shape-{name}-16', prims, 16))
    for name, prims in CONNECTORS.items():
        jobs.append((f'conn-{name}', prims, 24))
    for name, prims in UI.items():
        jobs.append((name, prims, 24))

    # One document per glyph. A single document with many artboards would be
    # cheaper, but VectorCraft exports an artboard by index and translates its
    # art by the artboard's origin — and an object is filed under the artboard
    # that holds its centre, so the index order is not guaranteed to match the
    # drawing order. One artboard per document has no such ambiguity.
    cmds = []
    for name, prims, size in jobs:
        k = 1.0 if size == 24 else scale16
        weight = 1.5 if size == 24 else 1.25
        cmds.append({'command': 'file.new', 'params': {
            'name': name, 'width': size, 'height': size, 'units': 'Pixels',
            'artboards': 1, 'backgroundContents': 'transparent'}})
        for p in prims:
            cmds.append({'command': 'path.create', 'params': {'d': to_d(p, k)}})
            cmds.append({'command': 'paint.setFill', 'params': (
                {'color': '#000000'} if p['fill'] else {'none': True})})
            # A round cap grows every dash by half the stroke on each end and
            # closes the gap again; dashes take a butt cap so they stay dashes.
            stroke = {'weight': p.get('sw') or weight,
                      'cap': 'butt' if p.get('dash') else 'round', 'join': 'round'}
            if p.get('dash'):
                stroke['dash'] = [round(d * k, 2) for d in p['dash']]
            cmds.append({'command': 'stroke.set', 'params': stroke})
            cmds.append({'command': 'paint.setStroke',
                         'params': {'none': True} if p['fill'] else {'color': '#000000'}})
        cmds.append({'command': 'document.export', 'params': {
            'path': os.path.join(out_dir, f'{name}.svg'), 'format': 'svg',
            'artboard': 0}})

    os.makedirs(out_dir, exist_ok=True)

    cmd_file = os.path.join(out_dir, '_commands.json')
    with open(cmd_file, 'w') as f:
        json.dump(cmds, f)
    return jobs, cmd_file


def build_master(out_path, scale16=2 / 3.0):
    """One editable VectorCraft document with every glyph on its own artboard.

    The exports are per-document (see build), but a single .vectorcraft is what
    a person opens to nudge a stroke or move an anchor, so the same primitives
    are also laid out on one canvas and saved as the source file.
    """
    jobs = []
    for name, prims in SHAPES.items():
        jobs.append((f'shape-{name}', prims, 24))
        jobs.append((f'shape-{name}-16', prims, 16))
    for name, prims in CONNECTORS.items():
        jobs.append((f'conn-{name}', prims, 24))
    for name, prims in UI.items():
        jobs.append((name, prims, 24))

    pos = {}
    col = row = 0
    for name, _, size in jobs:
        if size != 24:
            continue
        pos[name] = (col * 32, row * 32)
        col += 1
        if col == 16:
            col, row = 0, row + 1
    y16 = (row + (1 if col else 0)) * 32 + 8
    col = row = 0
    for name, _, size in jobs:
        if size != 16:
            continue
        pos[name] = (col * 24, y16 + row * 24)
        col += 1
        if col == 16:
            col, row = 0, row + 1

    cmds = [{'command': 'file.new', 'params': {
        'name': 'icons', 'width': 24, 'height': 24, 'units': 'Pixels',
        'artboards': 1, 'backgroundContents': 'transparent'}}]
    for name, _, size in jobs:
        if pos[name] == (0, 0):
            continue
        cmds.append({'command': 'artboard.new', 'params': {
            'x': pos[name][0], 'y': pos[name][1], 'width': size, 'height': size,
            'name': name}})
    for name, prims, size in jobs:
        k = 1.0 if size == 24 else scale16
        weight = 1.5 if size == 24 else 1.25
        ox, oy = pos[name]
        for p in prims:
            cmds.append({'command': 'path.create',
                         'params': {'d': to_d(p, k, ox, oy)}})
            cmds.append({'command': 'paint.setFill', 'params': (
                {'color': '#000000'} if p['fill'] else {'none': True})})
            stroke = {'weight': p.get('sw') or weight,
                      'cap': 'butt' if p.get('dash') else 'round', 'join': 'round'}
            if p.get('dash'):
                stroke['dash'] = [round(d * k, 2) for d in p['dash']]
            cmds.append({'command': 'stroke.set', 'params': stroke})
            cmds.append({'command': 'paint.setStroke',
                         'params': {'none': True} if p['fill'] else {'color': '#000000'}})
    cmds.append({'command': 'file.saveAs', 'params': {
        'path': out_path, 'format': 'vectorcraft'}})
    tmp = out_path + '.commands.json'
    with open(tmp, 'w') as f:
        json.dump(cmds, f)
    return tmp


def run(cmd_file):
    proc = subprocess.run(['vectorcraft-cli', 'run', '--commands', cmd_file],
                          capture_output=True, text=True)
    errs = [l for l in proc.stdout.splitlines() if '"error"' in l]
    if proc.returncode or errs:
        print(proc.stdout[-3000:], proc.stderr[-2000:], sep='\n')
        sys.exit('vectorcraft failed')
    return proc.stdout


def tidy(path, name):
    """VectorCraft's #000000 -> currentColor; keep the app's <title>."""
    with open(path) as f:
        s = f.read()
    s = s.replace('stroke="#000000"', 'stroke="currentColor"')
    s = s.replace('fill="#000000"', 'fill="currentColor"')
    s = re.sub(r'<title>.*?</title>', f'<title>{name}</title>', s, flags=re.S)
    s = re.sub(r'\s*stroke-miterlimit="10"', '', s)
    with open(path, 'w') as f:
        f.write(s)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=ICONS)
    ap.add_argument('--master', action='store_true',
                    help='also save the editable one-document source')
    args = ap.parse_args()
    jobs, cmd_file = build(args.out)
    print(f'{len(jobs)} icons -> {args.out}')
    run(cmd_file)
    missing = [n for n, _, _ in jobs
               if not os.path.exists(os.path.join(args.out, f'{n}.svg'))]
    if missing:
        sys.exit(f'missing exports: {missing}')
    for name, _, _ in jobs:
        tidy(os.path.join(args.out, f'{name}.svg'), name)
    os.remove(cmd_file)
    if args.master:
        m = os.path.join(ROOT, 'tools', 'icons.vectorcraft')
        run(build_master(m))
        os.remove(m + '.commands.json')
        print('master', m)
    print('ok')


if __name__ == '__main__':
    main()
