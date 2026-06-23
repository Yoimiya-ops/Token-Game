import assert from 'node:assert/strict';
import test from 'node:test';
import { buildingsWithPanels, buildingPanelFor, type BuildingPanelState } from './building-panel';

const state: BuildingPanelState = {
  player: {
    realmLevel: 2,
    qi: 120,
    spiritStone: 9,
    spiritHerb: 28,
    pills: 3,
    cultivation: 480,
    kindling: 7
  },
  homestead: {
    omen: {
      fortune: '小吉',
      favors: ['种田', '炼丹'],
      verse: '斗柄微斜，炉火不躁。'
    },
    treasureBasin: {
      dailyCondenses: 1,
      lastCondensedAt: '2026-06-23T03:00:00.000Z'
    },
    spiritBeast: {
      name: '青霜',
      status: 'idle',
      route: null,
      returnsAt: null
    },
    inventory: [
      {
        id: 'item-1',
        name: '月露灵石',
        kind: 'stone',
        quantity: 2,
        createdAt: '2026-06-23T03:00:00.000Z',
        description: '聚宝盆凝出的温润灵石。'
      }
    ],
    logs: [
      {
        id: 'log-1',
        type: 'treasure',
        title: '聚宝盆凝出月露灵石',
        body: '投入一缕薪火。',
        occurredAt: '2026-06-23T03:00:00.000Z'
      }
    ]
  },
  progression: {
    nextPracticeCost: 48,
    nextBreakthroughCost: 400
  }
};

test('provides a secondary drawer panel for every building', () => {
  assert.deepEqual(buildingsWithPanels, [
    'farm',
    'alchemy',
    'beast',
    'divination',
    'treasure',
    'practice',
    'meditate',
    'archive'
  ]);

  for (const building of buildingsWithPanels) {
    const panel = buildingPanelFor(building, state);
    assert.equal(panel.id, building);
    assert.ok(panel.title.length > 0);
    assert.ok(panel.description.length > 0);
    assert.ok(panel.metrics.length >= 2);
  }
});

test('marks archive as an information panel without a primary action', () => {
  const panel = buildingPanelFor('archive', state);

  assert.equal(panel.primaryAction, null);
  assert.equal(panel.primaryLabel, null);
  assert.equal(panel.entries[0]?.title, '月露灵石 x2');
});

test('uses building-specific primary actions in drawer panels', () => {
  assert.equal(buildingPanelFor('farm', state).primaryAction, 'farm');
  assert.equal(buildingPanelFor('alchemy', state).primaryAction, 'alchemy');
  assert.equal(buildingPanelFor('beast', state).primaryAction, 'beast');
  assert.equal(buildingPanelFor('treasure', state).primaryAction, 'treasure');
  assert.equal(buildingPanelFor('practice', state).primaryAction, 'practice');
  assert.equal(buildingPanelFor('meditate', state).primaryAction, 'meditate');
  assert.equal(buildingPanelFor('divination', state).primaryAction, 'divination');
});
