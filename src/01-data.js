/* =====================================================================
 * 01. 데이터 테이블 — 밸런스 조정은 이 섹션의 숫자만 바꾸면 된다.
 * ===================================================================== */

const CFG = {
  ROWS: 4, COLS: 7,              // 한쪽 진영 크기
  BENCH: 9,
  START_HP: 100,
  TICK: 0.1,                     // 전투 틱(초)
  BATTLE_TIME: 30,               // 전투 제한 시간(초)
  OVERTIME: 15,                  // 연장전 시작(초)
  OVERTIME_RAMP: 0.08,           // 연장전 초당 피해 증가
  MOVE_TIME: 0.45,               // 한 칸 이동 시간
  REROLL_COST: 2,
  XP_COST: 4, XP_AMOUNT: 4,
  BASE_INCOME: 5,
  MAX_INTEREST: 5,
  LORD_MANA_MAX: 10,
  LORD_MANA_REGEN: 1.5,          // 초당 (전투가 약 15초라 주문 3~5회가 되도록 조정)
  AUTO_CAST_MULT: 0.9,           // 자동 시전 효율
  STAR_MULT: [0, 1, 1.8, 3.2],
  ITEM_MAX: 3,
};

// 레벨 n → n+1 에 필요한 경험치
const XP_TABLE = [0, 2, 2, 6, 10, 20, 36, 56, 80, 0];

// 레벨별 상점 코스트 확률(%)
const SHOP_ODDS = {
  1: [100, 0, 0, 0, 0], 2: [100, 0, 0, 0, 0], 3: [75, 25, 0, 0, 0],
  4: [55, 30, 15, 0, 0], 5: [45, 33, 20, 2, 0], 6: [30, 35, 28, 7, 0],
  7: [20, 30, 33, 15, 2], 8: [15, 20, 35, 25, 5], 9: [10, 15, 30, 30, 15],
};
const POOL_SIZE = [0, 29, 22, 18, 12, 9];
const COST_COLOR = ['#000', '#9aa4b1', '#3fbf6a', '#3d8bff', '#b45cff', '#ffb52e'];

/* ---------- 시너지 ---------- */
// 계열(origin) 6종 + 역할(role) 6종, 단계 2/4/6
const TRAITS = {
  fire:     { name: '화염', icon: '🔥', kind: 'origin', color: '#ff6b3d', tiers: [2, 4, 6],
              desc: ['피격 시 공격자에게 화상 (초당 15)', '화상 초당 35', '화상 초당 70, 모든 아군에게 적용'] },
  frost:    { name: '서리', icon: '❄️', kind: 'origin', color: '#6fd3ff', tiers: [2, 4, 6],
              desc: ['공격 시 적 공격 속도 -15% (2초)', '-25%', '-40%, 모든 아군에게 적용'] },
  forest:   { name: '숲', icon: '🌿', kind: 'origin', color: '#5ad16b', tiers: [2, 4, 6],
              desc: ['매 초 최대 체력의 2% 회복', '3.5% 회복', '6% 회복, 모든 아군에게 적용'] },
  wraith:   { name: '망령', icon: '👻', kind: 'origin', color: '#b07cff', tiers: [2, 4, 6],
              desc: ['처치된 망령이 2초간 유령으로 공격 (피해 50%)', '3초, 70%', '5초, 100%, 모든 아군에게 적용'] },
  mech:     { name: '기계', icon: '⚙️', kind: 'origin', color: '#c9a36b', tiers: [2, 4, 6],
              desc: ['전투 시작 시 보호막 180', '보호막 380', '보호막 750, 모든 아군에게 적용'] },
  star:     { name: '별빛', icon: '✨', kind: 'origin', color: '#ffe066', tiers: [2, 4, 6],
              desc: ['별빛 유닛 스킬 마나 -15%', '-25%', '-35% 모든 아군, 군주 마나 회복 +60%'] },
  guardian: { name: '수호자', icon: '🛡️', kind: 'role', color: '#8fa8c8', tiers: [2, 4, 6],
              desc: ['수호자 방어력·마법저항 +20', '+40, 다른 아군 +10', '+70, 다른 아군 +25'] },
  vanguard: { name: '돌격대', icon: '⚔️', kind: 'role', color: '#ff8f5a', tiers: [2, 4, 6],
              desc: ['전투 시작 시 적 후열로 도약, 공격력 +15%', '+30%', '+55%, 도약 착지 시 주변 기절 1초'] },
  sniper:   { name: '저격수', icon: '🏹', kind: 'role', color: '#9be36b', tiers: [2, 4, 6],
              desc: ['사거리 +1, 거리 1칸당 피해 +5%', '칸당 +8%', '사거리 +2, 칸당 +12%'] },
  mystic:   { name: '주술사', icon: '🔮', kind: 'role', color: '#d070ff', tiers: [2, 4, 6],
              desc: ['스킬 피해 +20%', '스킬 피해 +45%, 주문 피해 +15%', '스킬 피해 +80%, 주문 피해 +30%'] },
  assassin: { name: '암살자', icon: '🗡️', kind: 'role', color: '#ff5f7e', tiers: [2, 4, 6],
              desc: ['치명타 확률 +15%, 치명타 피해 +25%', '+30% / +45%', '+45% / +70%'] },
  healer:   { name: '치유사', icon: '✚', kind: 'role', color: '#7dffc4', tiers: [2, 4, 6],
              desc: ['아군 회복량·보호막 +25%', '+50%', '+90%'] },
};
const TRAIT_KEYS = Object.keys(TRAITS);

/* ---------- 유닛 ---------- */
// 주 역할(roles[0])에 따라 기본 능력치 원형을 정하고 코스트로 배율을 곱한다.
const ARCHETYPE = {
  guardian: { hp: 1.25, atk: 0.75, as: 0.60, range: 1, armor: 40, mr: 30, mana: 100, start: 30, crit: 0.05 },
  vanguard: { hp: 1.10, atk: 0.95, as: 0.70, range: 1, armor: 30, mr: 25, mana: 80,  start: 20, crit: 0.05 },
  assassin: { hp: 0.85, atk: 1.15, as: 0.80, range: 1, armor: 20, mr: 20, mana: 70,  start: 10, crit: 0.25 },
  sniper:   { hp: 0.70, atk: 1.10, as: 0.75, range: 4, armor: 15, mr: 15, mana: 80,  start: 10, crit: 0.10 },
  mystic:   { hp: 0.75, atk: 0.70, as: 0.65, range: 3, armor: 15, mr: 25, mana: 60,  start: 15, crit: 0.05 },
  healer:   { hp: 0.80, atk: 0.65, as: 0.65, range: 3, armor: 20, mr: 25, mana: 70,  start: 20, crit: 0.05 },
};
const COST_HP = [0, 560, 660, 780, 920, 1080];
const COST_ATK = [0, 58, 70, 82, 98, 120];

// 스킬 효과 단위(fx). v 배열은 [1성, 2성, 3성] 값.
// 대상 지정자: target, self, area(대상 주변), selfArea(자신 주변), lowestAlly, lowestAllies, allAllies,
//              allEnemies, lowestEnemy, randomEnemies, farthestEnemy
const UNIT_LIST = [
  // ── 1코스트 (12)
  ['ember',      '불꽃 도깨비', '👺', 1, 'fire',   ['vanguard'], { name: '불꽃 박치기', fx: [{ t: 'dmg', tgt: 'target', v: [160, 240, 380] }, { t: 'burn', tgt: 'target', v: [20, 30, 50], dur: 3 }] }],
  ['salamander', '도롱뇽 기사', '🦎', 1, 'fire',   ['guardian'], { name: '용암 비늘', fx: [{ t: 'shield', tgt: 'self', v: [260, 360, 560], dur: 4 }, { t: 'burn', tgt: 'selfArea', r: 1, v: [15, 25, 40], dur: 3 }] }],
  ['frostbow',   '서리 궁수',   '🧝', 1, 'frost',  ['sniper'],   { name: '얼음 화살', fx: [{ t: 'dmg', tgt: 'target', v: [180, 270, 420] }, { t: 'slow', tgt: 'target', v: [0.3, 0.35, 0.45], dur: 3 }] }],
  ['snowcub',    '눈곰 새끼',   '🐻‍❄️', 1, 'frost', ['guardian'], { name: '눈사태 포옹', fx: [{ t: 'dmg', tgt: 'target', v: [100, 150, 250] }, { t: 'stun', tgt: 'target', v: [1.5, 1.75, 2.25] }] }],
  ['sprout',     '새싹 정령',   '🌱', 1, 'forest', ['healer'],   { name: '새싹의 축복', fx: [{ t: 'heal', tgt: 'lowestAlly', v: [220, 320, 520] }] }],
  ['boar',       '멧돼지',      '🐗', 1, 'forest', ['vanguard'], { name: '돌진', fx: [{ t: 'dmg', tgt: 'target', v: [160, 240, 380] }, { t: 'stun', tgt: 'target', v: [0.75, 1, 1.25] }] }],
  ['skeleton',   '해골 병사',   '🦴', 1, 'wraith', ['guardian'], { name: '뼈 방패', fx: [{ t: 'shield', tgt: 'self', v: [320, 450, 700], dur: 4 }] }],
  ['bat',        '흡혈 박쥐',   '🦇', 1, 'wraith', ['assassin'], { name: '흡혈', fx: [{ t: 'dmg', tgt: 'target', v: [190, 285, 440] }, { t: 'heal', tgt: 'self', v: [110, 160, 260] }] }],
  ['cogbot',     '톱니 로봇',   '🤖', 1, 'mech',   ['guardian'], { name: '강철 외피', fx: [{ t: 'buff', tgt: 'self', stat: 'armor', v: [40, 60, 100], dur: 4 }, { t: 'shield', tgt: 'self', v: [200, 300, 460], dur: 4 }] }],
  ['drone',      '정찰 드론',   '🛸', 1, 'mech',   ['sniper'],   { name: '표적 레이저', fx: [{ t: 'dmg', tgt: 'target', v: [210, 315, 500] }] }],
  ['stargazer',  '견습 점성가', '🧙', 1, 'star',   ['mystic'],   { name: '별똥별', fx: [{ t: 'dmg', tgt: 'area', r: 1, v: [150, 225, 360] }] }],
  ['pixie',      '별빛 요정',   '🧚', 1, 'star',   ['healer'],   { name: '별가루', fx: [{ t: 'heal', tgt: 'lowestAllies', n: 2, v: [150, 220, 350] }] }],
  // ── 2코스트 (10)
  ['firewitch',  '화염 마녀',   '🧙‍♀️', 2, 'fire',  ['mystic'],   { name: '화염구', fx: [{ t: 'dmg', tgt: 'area', r: 1, v: [220, 330, 520] }, { t: 'burn', tgt: 'area', r: 1, v: [25, 35, 55], dur: 3 }] }],
  ['firehawk',   '화염 매',     '🦅', 2, 'fire',   ['assassin'], { name: '급강하', fx: [{ t: 'leap', tgt: 'farthestEnemy' }, { t: 'dmg', tgt: 'target', v: [220, 330, 520] }] }],
  ['icewolf',    '얼음 늑대',   '🐺', 2, 'frost',  ['assassin'], { name: '서리 송곳니', fx: [{ t: 'dmg', tgt: 'target', kind: 'phys', v: [260, 390, 600] }, { t: 'slow', tgt: 'target', v: [0.4, 0.45, 0.55], dur: 2 }] }],
  ['yeti',       '설인',        '🦍', 2, 'frost',  ['vanguard'], { name: '대지 강타', fx: [{ t: 'dmg', tgt: 'selfArea', r: 1, v: [170, 255, 400] }, { t: 'slow', tgt: 'selfArea', r: 1, v: [0.3, 0.35, 0.45], dur: 3 }] }],
  ['mushroom',   '버섯 수호자', '🍄', 2, 'forest', ['guardian'], { name: '포자 구름', fx: [{ t: 'heal', tgt: 'self', v: [260, 390, 620] }, { t: 'dmg', tgt: 'selfArea', r: 1, v: [80, 120, 190] }] }],
  ['deer',       '사슴 궁수',   '🦌', 2, 'forest', ['sniper'],   { name: '관통 화살', fx: [{ t: 'dmg', tgt: 'target', kind: 'phys', v: [280, 420, 660] }] }],
  ['banshee',    '밴시',        '😱', 2, 'wraith', ['mystic'],   { name: '비명', fx: [{ t: 'dmg', tgt: 'area', r: 1, v: [190, 285, 450] }, { t: 'stun', tgt: 'area', r: 1, v: [0.5, 0.6, 0.8] }] }],
  ['ghoul',      '구울',        '🧟', 2, 'wraith', ['vanguard'], { name: '물어뜯기', fx: [{ t: 'dmg', tgt: 'target', v: [190, 285, 450] }, { t: 'heal', tgt: 'self', v: [160, 240, 380] }] }],
  ['golem',      '강철 골렘',   '🦾', 2, 'mech',   ['vanguard'], { name: '충격파', fx: [{ t: 'dmg', tgt: 'target', v: [160, 240, 380] }, { t: 'stun', tgt: 'target', v: [1.25, 1.5, 1.75] }] }],
  ['comet',      '혜성 기사',   '☄️', 2, 'star',   ['assassin'], { name: '혜성 일격', fx: [{ t: 'leap', tgt: 'farthestEnemy' }, { t: 'dmg', tgt: 'target', v: [230, 345, 540] }] }],
  // ── 3코스트 (8)
  ['lavagiant',  '용암 거인',   '🌋', 3, 'fire',   ['guardian'], { name: '분화', fx: [{ t: 'dmg', tgt: 'selfArea', r: 1, v: [250, 375, 700] }, { t: 'burn', tgt: 'selfArea', r: 1, v: [35, 50, 90], dur: 3 }, { t: 'shield', tgt: 'self', v: [300, 450, 800], dur: 4 }] }],
  ['icemage',    '빙결 술사',   '🥶', 3, 'frost',  ['mystic'],   { name: '눈보라', fx: [{ t: 'dmg', tgt: 'area', r: 1, v: [270, 405, 720] }, { t: 'stun', tgt: 'area', r: 1, v: [1, 1.1, 1.4] }] }],
  ['treant',     '고목 수호자', '🌲', 3, 'forest', ['guardian', 'healer'], { name: '뿌리 치유', fx: [{ t: 'heal', tgt: 'allAllies', v: [110, 165, 320] }, { t: 'shield', tgt: 'self', v: [250, 375, 700], dur: 4 }] }],
  ['vampire',    '흡혈귀',      '🧛', 3, 'wraith', ['assassin'], { name: '피의 향연', fx: [{ t: 'dmg', tgt: 'target', v: [340, 510, 950] }, { t: 'heal', tgt: 'self', v: [200, 300, 560] }] }],
  ['starhunter', '별 사냥꾼',   '🔭', 3, 'star',   ['sniper'],   { name: '별빛 저격', fx: [{ t: 'dmg', tgt: 'lowestEnemy', v: [360, 540, 980] }] }],
  ['cannon',     '포격 기계',   '💣', 3, 'mech',   ['sniper'],   { name: '포격', fx: [{ t: 'dmg', tgt: 'area', r: 1, v: [250, 375, 700] }] }],
  ['repairbot',  '수리 로봇',   '🔧', 3, 'mech',   ['healer'],   { name: '긴급 수리', fx: [{ t: 'shield', tgt: 'lowestAllies', n: 2, v: [260, 390, 720], dur: 4 }] }],
  ['moonpriest', '달의 사제',   '🌙', 3, 'star',   ['healer'],   { name: '월광', fx: [{ t: 'heal', tgt: 'allAllies', v: [130, 195, 360] }] }],
  // ── 4코스트 (6)
  ['dragon',     '화염룡',      '🐉', 4, 'fire',   ['mystic'],   { name: '용의 숨결', fx: [{ t: 'dmg', tgt: 'area', r: 1, v: [420, 630, 1800] }, { t: 'burn', tgt: 'area', r: 1, v: [60, 90, 200], dur: 3 }] }],
  ['frostgiant', '서리 거인',   '🧊', 4, 'frost',  ['guardian'], { name: '빙하 강타', fx: [{ t: 'dmg', tgt: 'selfArea', r: 1, v: [220, 330, 900] }, { t: 'stun', tgt: 'selfArea', r: 1, v: [1.5, 1.75, 3] }, { t: 'shield', tgt: 'self', v: [500, 750, 2000], dur: 4 }] }],
  ['ranger',     '엘프 레인저', '🧝‍♂️', 4, 'forest', ['sniper'], { name: '연속 사격', fx: [{ t: 'buff', tgt: 'self', stat: 'as', v: [0.6, 0.8, 2], dur: 5 }, { t: 'dmg', tgt: 'target', kind: 'phys', v: [260, 390, 1100] }] }],
  ['reaper',     '사신',        '☠️', 4, 'wraith', ['vanguard', 'assassin'], { name: '수확', fx: [{ t: 'execute', tgt: 'target', v: [0.2, 0.25, 0.5] }, { t: 'dmg', tgt: 'target', v: [460, 690, 2000] }] }],
  ['thunder',    '벼락 기갑',   '⚡', 4, 'mech',   ['mystic'],   { name: '연쇄 번개', fx: [{ t: 'dmg', tgt: 'randomEnemies', n: 4, v: [290, 435, 1300] }, { t: 'stun', tgt: 'last', v: [0.5, 0.6, 1.5] }] }],
  ['starknight', '성좌 기사',   '🌟', 4, 'star',   ['guardian'], { name: '성좌의 가호', fx: [{ t: 'shield', tgt: 'allAllies', v: [210, 315, 900], dur: 4 }] }],
  // ── 5코스트 (4)
  ['sunphoenix', '태양 불사조', '🌞', 5, 'fire',   ['sniper'],   { name: '태양 화살', fx: [{ t: 'dmg', tgt: 'area', r: 1, v: [620, 930, 9999] }, { t: 'burn', tgt: 'area', r: 1, v: [80, 120, 500], dur: 4 }] }],
  ['winterqueen','겨울 여왕',   '👸', 5, 'frost',  ['mystic'],   { name: '영원한 겨울', fx: [{ t: 'dmg', tgt: 'allEnemies', v: [260, 390, 2000] }, { t: 'stun', tgt: 'allEnemies', v: [1.5, 2, 6] }] }],
  ['worldtree',  '세계수',      '🌳', 5, 'forest', ['healer'],   { name: '숲의 부름', fx: [{ t: 'summon', unit: 'sapling', n: 2 }, { t: 'heal', tgt: 'allAllies', v: [160, 240, 1000] }] }],
  ['lich',       '리치 왕',     '💀', 5, 'wraith', ['mystic'],   { name: '죽음의 손길', fx: [{ t: 'dmg', tgt: 'randomEnemies', n: 3, v: [520, 780, 3000] }] }],
  // ═════ 확장 유닛 50종 (코스트별 10종) ═════
  // ── 1코스트 확장 (10)
  ['cinderfox',  '불씨 여우',   '🦊', 1, 'fire',   ['assassin'], { name: '불씨 할퀴기', fx: [{ t: 'dmg', tgt: 'target', kind: 'phys', v: [190, 285, 440] }, { t: 'burn', tgt: 'target', v: [15, 25, 40], dur: 3 }] }],
  ['steelcrab',  '강철 게',     '🦀', 1, 'mech',   ['guardian'], { name: '집게 방벽', fx: [{ t: 'shield', tgt: 'self', v: [280, 400, 620], dur: 4 }, { t: 'slow', tgt: 'selfArea', r: 1, v: [0.25, 0.3, 0.4], dur: 2 }] }],
  ['penguin',    '펭귄 척후병', '🐧', 1, 'frost',  ['vanguard'], { name: '얼음 미끄럼', fx: [{ t: 'dmg', tgt: 'target', v: [150, 225, 350] }, { t: 'slow', tgt: 'target', v: [0.3, 0.35, 0.45], dur: 3 }] }],
  ['bee',        '꿀벌 치유사', '🐝', 1, 'forest', ['healer'],   { name: '꿀 한 방울', fx: [{ t: 'heal', tgt: 'lowestAlly', v: [210, 315, 500] }, { t: 'buff', tgt: 'lowestAlly', stat: 'armor', v: [20, 30, 50], dur: 3 }] }],
  ['hedgehog',   '고슴도치 궁수', '🦔', 1, 'forest', ['sniper'], { name: '가시 사격', fx: [{ t: 'dmg', tgt: 'target', kind: 'phys', v: [190, 285, 450] }] }],
  ['wisp',       '도깨비불',    '🕯️', 1, 'wraith', ['mystic'],   { name: '혼불 폭발', fx: [{ t: 'dmg', tgt: 'area', r: 1, v: [140, 210, 330] }] }],
  ['crow',       '까마귀 정찰병', '🐦', 1, 'wraith', ['sniper'], { name: '사냥감 표시', fx: [{ t: 'dmg', tgt: 'lowestEnemy', v: [180, 270, 420] }] }],
  ['gearsmith',  '톱니 기술자', '🧑‍🔧', 1, 'mech', ['healer'],   { name: '응급 용접', fx: [{ t: 'shield', tgt: 'lowestAlly', v: [230, 340, 520], dur: 4 }] }],
  ['robodog',    '로봇 강아지', '🐶', 1, 'mech',   ['vanguard'], { name: '전기 물기', fx: [{ t: 'dmg', tgt: 'target', v: [150, 225, 350] }, { t: 'stun', tgt: 'target', v: [0.75, 1, 1.25] }] }],
  ['moth',       '달빛 나방',   '🦋', 1, 'star',   ['assassin'], { name: '달빛 비행', fx: [{ t: 'leap', tgt: 'farthestEnemy' }, { t: 'dmg', tgt: 'target', v: [170, 255, 400] }] }],
  // ── 2코스트 확장 (10)
  ['fireknight', '화염 기사',   '🤺', 2, 'fire',   ['guardian'], { name: '불꽃 방패', fx: [{ t: 'shield', tgt: 'self', v: [360, 520, 820], dur: 4 }, { t: 'burn', tgt: 'selfArea', r: 1, v: [20, 30, 45], dur: 3 }] }],
  ['lamppriest', '등불 사제',   '🪔', 2, 'fire',   ['healer'],   { name: '따스한 불빛', fx: [{ t: 'heal', tgt: 'allAllies', v: [90, 135, 210] }] }],
  ['lynx',       '빙하 살쾡이', '🐈', 2, 'frost',  ['assassin'], { name: '눈보라 발톱', fx: [{ t: 'dmg', tgt: 'target', kind: 'phys', v: [250, 375, 580] }, { t: 'slow', tgt: 'target', v: [0.35, 0.4, 0.5], dur: 2 }] }],
  ['frostowl',   '설원 올빼미', '🦉', 2, 'frost',  ['sniper'],   { name: '얼음 깃털', fx: [{ t: 'dmg', tgt: 'target', v: [240, 360, 560] }, { t: 'slow', tgt: 'target', v: [0.35, 0.4, 0.5], dur: 3 }] }],
  ['mantis',     '사마귀 검객', '🦗', 2, 'forest', ['assassin'], { name: '쌍낫 베기', fx: [{ t: 'dmg', tgt: 'target', kind: 'phys', v: [260, 390, 600] }] }],
  ['luckystar',  '행운의 정령', '🍀', 2, 'star',   ['mystic'],   { name: '행운 폭발', fx: [{ t: 'dmg', tgt: 'area', r: 1, v: [200, 300, 470] }, { t: 'heal', tgt: 'lowestAlly', v: [100, 150, 240] }] }],
  ['soulkeeper', '영혼 수습가', '🪦', 2, 'wraith', ['healer'],   { name: '영혼 봉합', fx: [{ t: 'heal', tgt: 'lowestAllies', n: 2, v: [170, 255, 400] }] }],
  ['spider',     '독거미',      '🕷️', 2, 'wraith', ['sniper'],   { name: '독침', fx: [{ t: 'dmg', tgt: 'target', v: [220, 330, 520] }, { t: 'burn', tgt: 'target', v: [25, 35, 55], dur: 3 }] }],
  ['sawdroid',   '톱날 드로이드', '🪚', 2, 'mech', ['assassin'], { name: '회전 톱날', fx: [{ t: 'dmg', tgt: 'target', kind: 'phys', v: [270, 405, 630] }] }],
  ['bard',       '별의 음유시인', '🎻', 2, 'star', ['healer'],   { name: '별의 노래', fx: [{ t: 'heal', tgt: 'allAllies', v: [70, 105, 170] }, { t: 'buff', tgt: 'allAllies', stat: 'as', v: [0.15, 0.2, 0.3], dur: 3 }] }],
  // ── 3코스트 확장 (10)
  ['lanternmage', '등롱 술사',  '🏮', 3, 'fire',   ['mystic'],   { name: '떠도는 불씨', fx: [{ t: 'dmg', tgt: 'randomEnemies', n: 3, v: [210, 315, 560] }, { t: 'burn', tgt: 'last', v: [30, 45, 80], dur: 3 }] }],
  ['flameleopard','화염 표범',  '🐆', 3, 'fire',   ['assassin'], { name: '사냥 본능', fx: [{ t: 'leap', tgt: 'lowestEnemy' }, { t: 'dmg', tgt: 'target', kind: 'phys', v: [330, 495, 920] }] }],
  ['frostknight','빙결 기사',   '⛄', 3, 'frost',  ['guardian'], { name: '얼음 성벽', fx: [{ t: 'stun', tgt: 'selfArea', r: 1, v: [1.25, 1.5, 2] }, { t: 'shield', tgt: 'self', v: [400, 600, 1100], dur: 4 }] }],
  ['mammoth',    '매머드 돌격병', '🦣', 3, 'frost', ['vanguard'], { name: '빙하 짓밟기', fx: [{ t: 'dmg', tgt: 'selfArea', r: 1, v: [230, 345, 640] }, { t: 'stun', tgt: 'target', v: [1, 1.25, 1.75] }] }],
  ['badger',     '오소리 드루이드', '🦡', 3, 'forest', ['mystic'], { name: '가시덩굴', fx: [{ t: 'dmg', tgt: 'area', r: 1, v: [260, 390, 720] }, { t: 'slow', tgt: 'area', r: 1, v: [0.3, 0.35, 0.45], dur: 3 }] }],
  ['greybear',   '회색곰 전사', '🐻', 3, 'forest', ['vanguard'], { name: '포효하는 일격', fx: [{ t: 'dmg', tgt: 'target', v: [300, 450, 850] }, { t: 'heal', tgt: 'self', v: [200, 300, 560] }] }],
  ['necromancer','강령술사',    '🧙‍♂️', 3, 'wraith', ['mystic'], { name: '망자 소환', fx: [{ t: 'summon', unit: 'bonemin', n: 2 }, { t: 'dmg', tgt: 'target', v: [200, 300, 560] }] }],
  ['meteorrider','유성 기수',   '🐴', 3, 'star',   ['vanguard'], { name: '유성 돌격', fx: [{ t: 'leap', tgt: 'farthestEnemy' }, { t: 'dmg', tgt: 'target', v: [250, 375, 700] }, { t: 'stun', tgt: 'target', v: [1, 1.25, 1.75] }] }],
  ['helicannon', '헬리콥터 포대', '🚁', 3, 'mech', ['sniper'],   { name: '기총 소사', fx: [{ t: 'dmg', tgt: 'randomEnemies', n: 2, v: [260, 390, 720] }] }],
  ['nebula',     '성운 마도사', '🌌', 3, 'star',   ['mystic'],   { name: '성운 붕괴', fx: [{ t: 'dmg', tgt: 'area', r: 1, v: [270, 405, 750] }, { t: 'mana', tgt: 'allAllies', v: [10, 15, 25] }] }],
  // ── 4코스트 확장 (10)
  ['efreet',     '이프리트',    '🧞', 4, 'fire',   ['vanguard'], { name: '화염 강림', fx: [{ t: 'leap', tgt: 'farthestEnemy' }, { t: 'dmg', tgt: 'selfArea', r: 1, v: [360, 540, 1500] }, { t: 'burn', tgt: 'selfArea', r: 1, v: [50, 75, 180], dur: 3 }] }],
  ['stardancer', '별빛 무희',   '🏵️', 4, 'star',   ['healer'],   { name: '별의 춤', fx: [{ t: 'heal', tgt: 'allAllies', v: [180, 270, 800] }, { t: 'buff', tgt: 'allAllies', stat: 'atk', v: [0.2, 0.25, 0.5], dur: 4 }] }],
  ['icedragon',  '빙룡',        '🐲', 4, 'frost',  ['mystic'],   { name: '서리 숨결', fx: [{ t: 'dmg', tgt: 'area', r: 1, v: [380, 570, 1700] }, { t: 'stun', tgt: 'area', r: 1, v: [1.5, 1.75, 3] }] }],
  ['polarhunter','극지 사냥꾼', '🎿', 4, 'frost',  ['sniper'],   { name: '한파 저격', fx: [{ t: 'dmg', tgt: 'target', kind: 'phys', v: [460, 690, 2000] }, { t: 'slow', tgt: 'target', v: [0.5, 0.55, 0.7], dur: 3 }] }],
  ['elderdino',  '대지의 고룡', '🦕', 4, 'forest', ['guardian'], { name: '대지 진동', fx: [{ t: 'dmg', tgt: 'selfArea', r: 1, v: [250, 375, 1100] }, { t: 'stun', tgt: 'selfArea', r: 1, v: [1.5, 1.75, 3] }, { t: 'heal', tgt: 'self', v: [400, 600, 2000] }] }],
  ['nanomedic',  '나노 의무병', '💉', 4, 'mech',   ['healer'],   { name: '나노 재생', fx: [{ t: 'heal', tgt: 'allAllies', v: [170, 255, 750] }, { t: 'shield', tgt: 'lowestAllies', n: 2, v: [300, 450, 1300], dur: 4 }] }],
  ['deathknight','죽음의 기사', '🏇', 4, 'wraith', ['guardian'], { name: '망자의 갑주', fx: [{ t: 'shield', tgt: 'self', v: [600, 900, 2500], dur: 5 }, { t: 'dmg', tgt: 'selfArea', r: 1, v: [200, 300, 900] }] }],
  ['shadowlord', '그림자 군주', '🦹', 4, 'wraith', ['assassin'], { name: '그림자 포식', fx: [{ t: 'dmg', tgt: 'lowestEnemy', v: [500, 750, 2200] }, { t: 'heal', tgt: 'self', v: [300, 450, 1200] }] }],
  ['jetfighter', '강철 비룡',   '✈️', 4, 'mech',   ['sniper'],   { name: '융단 폭격', fx: [{ t: 'dmg', tgt: 'randomEnemies', n: 3, v: [350, 525, 1500] }] }],
  ['starsage',   '별의 현자',   '🪐', 4, 'star',   ['mystic'],   { name: '천체 공명', fx: [{ t: 'dmg', tgt: 'allEnemies', v: [160, 240, 700] }, { t: 'mana', tgt: 'allAllies', v: [15, 20, 40] }] }],
  // ── 5코스트 확장 (10)
  ['infernal',   '지옥불 군주', '😈', 5, 'fire',   ['guardian'], { name: '지옥불 고리', fx: [{ t: 'dmg', tgt: 'selfArea', r: 2, v: [420, 630, 5000] }, { t: 'burn', tgt: 'selfArea', r: 2, v: [80, 120, 500], dur: 3 }, { t: 'shield', tgt: 'self', v: [800, 1200, 5000], dur: 5 }] }],
  ['volcanotitan','화산 거신',  '🗻', 5, 'fire',   ['vanguard'], { name: '화산 낙하', fx: [{ t: 'leap', tgt: 'farthestEnemy' }, { t: 'dmg', tgt: 'selfArea', r: 1, v: [520, 780, 6000] }, { t: 'stun', tgt: 'selfArea', r: 1, v: [1.5, 2, 5] }] }],
  ['glaciertitan','빙하 거신',  '🏔️', 5, 'frost',  ['guardian'], { name: '빙하기', fx: [{ t: 'stun', tgt: 'allEnemies', v: [1, 1.25, 4] }, { t: 'shield', tgt: 'allAllies', v: [250, 375, 2000], dur: 4 }] }],
  ['snowphoenix','설원 봉황',   '🕊️', 5, 'frost',  ['sniper'],   { name: '눈꽃 깃털비', fx: [{ t: 'dmg', tgt: 'randomEnemies', n: 4, v: [400, 600, 5000] }, { t: 'slow', tgt: 'last', v: [0.5, 0.6, 0.9], dur: 3 }] }],
  ['elephantking','코끼리왕',   '🐘', 5, 'forest', ['guardian'], { name: '대지의 포효', fx: [{ t: 'dmg', tgt: 'selfArea', r: 1, v: [300, 450, 5000] }, { t: 'stun', tgt: 'selfArea', r: 1, v: [2, 2.5, 6] }, { t: 'heal', tgt: 'allAllies', v: [250, 375, 3000] }] }],
  ['beastqueen', '야수 여왕',   '🐅', 5, 'forest', ['assassin'], { name: '포식자의 도약', fx: [{ t: 'leap', tgt: 'lowestEnemy' }, { t: 'dmg', tgt: 'target', kind: 'phys', v: [800, 1200, 9999] }] }],
  ['ninja',      '그림자 닌자', '🥷', 5, 'wraith', ['assassin'], { name: '그림자 처형', fx: [{ t: 'leap', tgt: 'lowestEnemy' }, { t: 'execute', tgt: 'target', v: [0.25, 0.3, 1] }, { t: 'dmg', tgt: 'target', v: [700, 1050, 9999] }] }],
  ['warmachine', '전쟁 기계',   '🚀', 5, 'mech',   ['vanguard'], { name: '돌파 포격', fx: [{ t: 'leap', tgt: 'farthestEnemy' }, { t: 'dmg', tgt: 'selfArea', r: 1, v: [500, 750, 6000] }, { t: 'stun', tgt: 'selfArea', r: 1, v: [1, 1.25, 4] }] }],
  ['aicore',     '초월 연산핵', '🧠', 5, 'mech',   ['mystic'],   { name: '전장 연산', fx: [{ t: 'dmg', tgt: 'allEnemies', v: [300, 450, 4000] }, { t: 'stun', tgt: 'last', v: [0.75, 1, 3] }] }],
  ['stargoddess','별의 여신',   '💫', 5, 'star',   ['healer'],   { name: '은하의 축복', fx: [{ t: 'heal', tgt: 'allAllies', v: [300, 450, 4000] }, { t: 'shield', tgt: 'allAllies', v: [200, 300, 2000], dur: 4 }, { t: 'mana', tgt: 'allAllies', v: [20, 25, 60] }] }],
];

const UNITS = {};
for (const [id, name, emoji, cost, origin, roles, skill] of UNIT_LIST) {
  const a = ARCHETYPE[roles[0]];
  const range = a.range;
  UNITS[id] = {
    id, name, emoji, cost, origin, roles, skill,
    traits: [origin, ...roles],
    hp: Math.round(COST_HP[cost] * a.hp / 10) * 10,
    atk: Math.round(COST_ATK[cost] * a.atk),
    as: a.as, range, armor: a.armor, mr: a.mr,
    mana: a.mana, startMana: a.start, crit: a.crit,
  };
}
// 소환/중립 몬스터 전용 정의 (상점에 나오지 않음)
const EXTRA_UNITS = {
  bonemin:  { id: 'bonemin',  name: '뼈 졸개',   emoji: '🦴', cost: 0, origin: null, roles: [], traits: [], hp: 420, atk: 45, as: 0.8, range: 1, armor: 20, mr: 20, mana: 999, startMana: 0, crit: 0.05, skill: null, summon: true },
  militia:  { id: 'militia',  name: '강철 병사', emoji: '💂', cost: 0, origin: null, roles: [], traits: [], hp: 650, atk: 50, as: 0.7, range: 1, armor: 35, mr: 25, mana: 999, startMana: 0, crit: 0.05, skill: null, summon: true },
  sapling: { id: 'sapling', name: '묘목', emoji: '🌿', cost: 0, origin: null, roles: [], traits: [], hp: 500, atk: 40, as: 0.7, range: 1, armor: 30, mr: 30, mana: 999, startMana: 0, crit: 0, skill: null, summon: true },
  m_slime:  { id: 'm_slime',  name: '슬라임',   emoji: '🟢', cost: 0, traits: [], roles: [], hp: 300, atk: 22, as: 0.6, range: 1, armor: 5,  mr: 5,  mana: 999, startMana: 0, crit: 0, skill: null },
  m_wolf:   { id: 'm_wolf',   name: '들개',     emoji: '🐕', cost: 0, traits: [], roles: [], hp: 520, atk: 45, as: 0.8, range: 1, armor: 15, mr: 10, mana: 999, startMana: 0, crit: 0.1, skill: null },
  m_rock:   { id: 'm_rock',   name: '바위 골렘', emoji: '🗿', cost: 0, traits: [], roles: [], hp: 1300, atk: 60, as: 0.5, range: 1, armor: 60, mr: 30, mana: 999, startMana: 0, crit: 0, skill: null },
  m_raptor: { id: 'm_raptor', name: '랩터',     emoji: '🦖', cost: 0, traits: [], roles: [], hp: 950, atk: 85, as: 0.8, range: 1, armor: 30, mr: 20, mana: 999, startMana: 0, crit: 0.15, skill: null },
  m_wyvern: { id: 'm_wyvern', name: '와이번',   emoji: '🐲', cost: 0, traits: [], roles: [], hp: 1500, atk: 110, as: 0.7, range: 2, armor: 40, mr: 40, mana: 999, startMana: 0, crit: 0.1, skill: null },
  m_elder:  { id: 'm_elder',  name: '고대 용',  emoji: '🐉', cost: 0, traits: [], roles: [], hp: 6000, atk: 180, as: 0.6, range: 2, armor: 70, mr: 70, mana: 999, startMana: 0, crit: 0.1, skill: null },
};
function unitDef(id) { return UNITS[id] || EXTRA_UNITS[id]; }
