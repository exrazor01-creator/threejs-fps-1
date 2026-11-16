// One state object for the whole match. Every system reads and writes this
// object and nothing else; the renderer only reads it. Phases:
//   menu -> buy -> live -> roundEnd -> buy ... -> matchEnd
// The defender (the player) wins a round by eliminating all four Drifters,
// by letting the round timer run out with no charge planted, or by defusing a
// planted charge. The Drifters win a round by eliminating the player or by
// letting a planted charge blow.
export function createState() {
  return {
    phase: 'menu',
    round: 1,
    maxRounds: 9,
    winRounds: 5,
    playerRounds: 0,
    botRounds: 0,
    timer: 0,
    buyTime: 20,
    roundTime: 100,
    fuseTime: 35,
    money: 800,
    kills: 0,
    deaths: 0,
    roundKills: 0,
    // Consecutive rounds lost: the loss bonus grows with it, up to ×4.
    lossStreak: 0,
    // Who won each round so far: 'player' or 'bots', one entry per round.
    roundHistory: [],
    winner: null,
    matchWinner: null,
    roundReason: '',
    plantSite: null,
    plantProgress: 0,
    plantDone: false,
    fuseLeft: 0,
    defuseProgress: 0,
    defusing: false,
    hasKit: false,
    grenades: { he: 0, smoke: 0 },
    kevlar: false,
    killfeed: [],
    log: [],
  };
}

export function resetRoundState(state) {
  state.plantSite = null;
  state.plantProgress = 0;
  state.plantDone = false;
  state.fuseLeft = 0;
  state.defuseProgress = 0;
  state.defusing = false;
  state.roundKills = 0;
  state.winner = null;
  state.roundReason = '';
  state.killfeed.length = 0;
}
