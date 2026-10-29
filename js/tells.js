/*
 * Live tells guide (player notes, including a tells tally, are in js/players.js).
 * Content draws on Mike Caro's "Book of Poker Tells", Joe Navarro's "Read 'Em and Reap",
 * Zachary Elwood's "Reading Poker Tells", and Slepian et al. (2013, Psychological Science).
 */
(function () {
  'use strict';

  const AREAS = {
    eyes: 'Eyes',
    face: 'Face & mouth',
    hands: 'Hands & chips',
    body: 'Body & feet',
    voice: 'Voice & talk',
    timing: 'Timing & acting',
  };

  // reliability: 3 = among the most dependable, 2 = useful with a baseline, 1 = weak on its own.
  const TELLS = [
    // ----- Signs of strength -----
    {
      id: 'shaking-hands', side: 'strong', area: 'hands', reliability: 3,
      title: 'Hands shake while betting',
      look: 'Hands or chips tremble as the bet goes in, or just after.',
      why: 'An adrenaline release from excitement. It is hard to fake and hard to stop, and a scared bluffer usually freezes instead.',
      caveat: 'Some players shake all the time (nerves, age, caffeine), so only a change from their baseline counts.',
    },
    {
      id: 'acting-weak', side: 'strong', area: 'timing', reliability: 3,
      title: 'Acts weak while betting',
      look: 'Sighs, shrugs, sad tone: "I guess I have to bet…", "I probably shouldn’t, but…".',
      why: 'This is a deliberate act, and players who act usually act the opposite of their hand ("weak means strong").',
      caveat: 'Skilled players know this and may double-bluff; it is most reliable against casual players.',
    },
    {
      id: 'glance-chips', side: 'strong', area: 'eyes', reliability: 2,
      title: 'Glances at their chips when the cards come',
      look: 'Looks at the flop, turn or river, then quickly looks down at their own stack.',
      why: 'An unconscious first step toward betting: they like the card and are already planning the bet.',
      caveat: 'Rare among experienced players, and easy to miss; watch for it while the board is dealt.',
    },
    {
      id: 'looks-away', side: 'strong', area: 'eyes', reliability: 2,
      title: 'Looks away after betting',
      look: 'Bets, then watches the TV, scans the room, or chats with a neighbour.',
      why: 'Comfort, not worried about a call, and partly an act to look uninterested so you call.',
      caveat: 'Some bluffers are taught to look away; compare with what they do with weak hands.',
    },
    {
      id: 'relaxed-talk', side: 'strong', area: 'voice', reliability: 2,
      title: 'Keeps talking naturally after betting',
      look: 'Answers questions easily, normal tone and pace, jokes, keeps the conversation going.',
      why: 'Bluffing is stressful and most bluffers go quiet or speak carefully; relaxed speech suggests comfort.',
      caveat: 'Talkative regulars may chat either way, so judge against how they talk when weak.',
    },
    {
      id: 'leans-in', side: 'strong', area: 'body', reliability: 2,
      title: 'Leans in, sits up, gets engaged',
      look: 'Moves closer to the table or sits taller as the hand develops.',
      why: 'Approach behaviour: people move toward things they like.',
      caveat: 'Means little if they always sit forward; look for the change.',
    },
    {
      id: 'happy-feet', side: 'strong', area: 'body', reliability: 2,
      title: '"Happy feet": legs start bouncing',
      look: 'A foot or knee starts bouncing after they see a card (often visible as a jiggling shoulder or chair).',
      why: 'Excitement leaks through the legs, the part of the body people control least.',
      caveat: 'Only counts if it starts or speeds up compared with their baseline.',
    },
    {
      id: 'smooth-chips', side: 'strong', area: 'hands', reliability: 2,
      title: 'Smooth, confident chip motion',
      look: 'Chips go in with one fluid, unhurried movement; neat stacks, no fumbling.',
      why: 'In a 2013 study, people judged hand strength better from players’ arm movements than from their faces; confident movement went with strong hands.',
      caveat: 'Everyone has their own style of betting, so compare with their usual motion.',
    },
    {
      id: 'invites-call', side: 'strong', area: 'timing', reliability: 2,
      title: 'Sizes you up or invites a call',
      look: 'Counts your stack, asks how much you have, says "you can call if you want".',
      why: 'They are working out how much value they can get.',
      caveat: 'Some players needle as a bluff; strongest when it comes with relaxed body language.',
    },
    {
      id: 'real-smile', side: 'strong', area: 'face', reliability: 1,
      title: 'Genuine, relaxed smile',
      look: 'A smile that reaches the eyes (crow’s feet), soft forehead, loose jaw.',
      why: 'Real smiles are hard to fake and come with comfort.',
      caveat: 'Faces are what players control best, so treat any facial tell as weak evidence.',
    },

    // ----- Signs of weakness -----
    {
      id: 'freeze', side: 'weak', area: 'body', reliability: 3,
      title: 'Freezes after betting',
      look: 'Goes rigid and very still, holds their breath or breathes shallowly, avoids any movement.',
      why: 'The freeze response: a bluffer tries not to draw attention, like an animal hoping not to be seen.',
      caveat: 'Some strong players also freeze to give nothing away; compare with how they sit when value betting.',
    },
    {
      id: 'acting-strong', side: 'weak', area: 'timing', reliability: 3,
      title: 'Acts strong: slams chips, loud bet',
      look: 'Forceful chip toss, announcing the bet loudly, a show of confidence.',
      why: 'A deliberate act meant to stop a call, and acting usually means the opposite ("strong means weak").',
      caveat: 'Separate acting from personality: some players are always loud.',
    },
    {
      id: 'reaches-chips', side: 'weak', area: 'hands', reliability: 3,
      title: 'Reaches for chips before you act',
      look: 'Picks up or handles chips as if ready to call while you are deciding whether to bet.',
      why: 'An attempt to discourage your bet; players who really want a bet tend to stay still.',
      caveat: 'Some players handle chips constantly; it matters when it is aimed at your decision.',
    },
    {
      id: 'stare', side: 'weak', area: 'eyes', reliability: 2,
      title: 'Hard stare at you after betting',
      look: 'Locks eyes with you, holds the stare, tries to look intimidating.',
      why: 'The fight response: an aggressive display to make you fold.',
      caveat: 'A few players stare every time, and some strong players stare to look like bluffers; baseline it.',
    },
    {
      id: 'pacifying', side: 'weak', area: 'face', reliability: 2,
      title: 'Self-soothing touches',
      look: 'Rubs the neck, touches the face, covers the mouth, adjusts the collar, exhales through puffed cheeks.',
      why: 'Pacifying behaviour: people calm themselves with touch when stressed.',
      caveat: 'Habitual face-touchers do this all the time; a new or extra touch after betting is what counts.',
    },
    {
      id: 'lips', side: 'weak', area: 'face', reliability: 2,
      title: 'Compressed lips or tight jaw',
      look: 'Lips pressed thin or disappearing, clenched jaw.',
      why: 'A stress signal that is hard to suppress in the moment.',
      caveat: 'Brief and easy to misread; best as part of a cluster.',
    },
    {
      id: 'flight', side: 'weak', area: 'body', reliability: 2,
      title: 'Leans back, turns away, blocks',
      look: 'Leans away from the table, turns shoulders or feet toward the exit, crosses arms, or covers face or chips.',
      why: 'The flight response: putting distance or a barrier between themselves and the threat.',
      caveat: 'Some players lean back to relax after a big bet; look at the whole cluster.',
    },
    {
      id: 'goes-quiet', side: 'weak', area: 'voice', reliability: 2,
      title: 'Goes quiet or tense after betting',
      look: 'A chatty player stops talking, gives short answers, voice rises in pitch, clears throat.',
      why: 'Bluffers fear their voice will give them away, so they shut down.',
      caveat: 'Quiet players are always quiet; this is about a change.',
    },
    {
      id: 'rechecks', side: 'weak', area: 'eyes', reliability: 2,
      title: 'Rechecks hole cards when a suit or pair card lands',
      look: 'Looks back at their cards when the third flush card or a pairing card arrives.',
      why: 'People remember holding two suited cards; rechecking usually means they have one of the suit or are unsure, not the made hand.',
      caveat: 'Some players recheck on every street; note whether they normally do.',
    },
    {
      id: 'instant-check', side: 'weak', area: 'timing', reliability: 2,
      title: 'Checks instantly',
      look: 'Checks the moment the action reaches them, without a pause.',
      why: 'Usually a decision made before the card came: giving up or planning to fold.',
      caveat: 'A few players check-raise fast with monsters; watch who does that.',
    },
    {
      id: 'forced-smile', side: 'weak', area: 'face', reliability: 1,
      title: 'Forced smile or nervous laugh',
      look: 'Mouth-only smile with no eye involvement, or a short laugh right after betting.',
      why: 'Masking discomfort.',
      caveat: 'Faces are easy to control, so this is weak on its own.',
    },
  ];

  const STRESS = [
    { id: 'freeze', name: 'Freeze', color: '#3d7bff', look: 'Sudden stillness, held or shallow breathing, minimal movement, fixed gaze.', reads: 'Usually worried or bluffing: trying not to be noticed.' },
    { id: 'flight', name: 'Flight', color: '#ff7a45', look: 'Leaning back, turning shoulders or feet away, blocking with arms, hands or chips, looking toward the exit.', reads: 'Usually weak: wants distance from the situation.' },
    { id: 'fight', name: 'Fight', color: '#f2545b', look: 'Hard stare, puffing up, slamming chips, needling or challenging talk.', reads: 'Often a bluff dressed up as strength, or genuine anger after a bad beat.' },
    { id: 'comfort', name: 'Comfort', color: '#10c48a', look: 'Loose shoulders, normal breathing, easy talk, leaning in, natural movement.', reads: 'Usually strong, or at least not worried about a call.' },
  ];

  const BASELINE = [
    'Posture when they are not in a hand (upright, slouched, leaning on the table)',
    'Breathing rate and depth at rest',
    'Hand and chip habits: stacking, riffling, where their hands rest',
    'How much they talk, and their normal tone and speed',
    'How much eye contact they make with other players',
    'How long they take on routine decisions (folding, easy calls)',
    'How they look at their cards: once, or again on later streets',
    'Leg and foot movement under the table',
    'Their resting facial expression',
    'What they do right after folding',
  ];

  const RULES = [
    { title: 'Start with a baseline', text: 'Watch how a player behaves when nothing is at stake. A tell is a change from that baseline, not a behaviour on its own.' },
    { title: 'Look for clusters', text: 'One gesture means little; two or three pointing the same way (freeze + compressed lips + going quiet) mean much more.' },
    { title: 'Involuntary beats acted', text: 'Stress and comfort signals leak out unintentionally. Deliberate displays are acts, and acts usually mean the opposite of the hand.' },
    { title: 'Confirm at showdown', text: 'Only trust a tell for a player once you have seen it match their cards. Keep score in each player\u2019s notes (Players tab).' },
    { title: 'Use it as a tiebreaker', text: 'Let tells tip close decisions; don’t let them override clear math. Experienced players may fake tells on purpose.' },
  ];

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  let root = null;
  let areaFilter = 'all';

  function dots(n) {
    return '<span class="tell-dots" title="Reliability: ' + ['', 'low', 'medium', 'high'][n] + '">' +
      [1, 2, 3].map((i) => '<span class="' + (i <= n ? 'on' : '') + '"></span>').join('') + '</span>';
  }

  function tellCard(t) {
    return '<li class="tell-card ' + t.side + '">' +
      '<div class="tell-head"><span class="tell-title">' + t.title + '</span>' + dots(t.reliability) + '</div>' +
      '<p class="tell-look">' + t.look + '</p>' +
      '<details><summary>Why it works &middot; when it misleads</summary>' +
      '<p><strong>Why:</strong> ' + t.why + '</p><p><strong>Watch out:</strong> ' + t.caveat + '</p></details>' +
      '<span class="tell-area">' + AREAS[t.area] + '</span></li>';
  }

  function renderTells() {
    const shown = TELLS.filter((t) => areaFilter === 'all' || t.area === areaFilter);
    const column = (side) => {
      const list = shown.filter((t) => t.side === side).sort((a, b) => b.reliability - a.reliability);
      return list.length ? '<ul class="tell-list">' + list.map(tellCard).join('') + '</ul>' : '<p class="hint">None in this area.</p>';
    };
    root.querySelector('#tell-columns').innerHTML =
      '<div class="tell-col"><h3 class="tell-col-head strong">Signs of strength</h3>' + column('strong') + '</div>' +
      '<div class="tell-col"><h3 class="tell-col-head weak">Signs of weakness</h3>' + column('weak') + '</div>';
    for (const b of root.querySelectorAll('[data-area]')) b.classList.toggle('active', b.dataset.area === areaFilter);
  }

  function render(container) {
    root = container;
    root.innerHTML =
      '<div class="panel-head"><h2>Reading tells</h2><span class="hint">Live-poker body language: what to look for, and how to check it against each player.</span></div>' +

      '<ol class="tell-rules">' + RULES.map((r) => '<li><strong>' + r.title + '.</strong> ' + r.text + '</li>').join('') + '</ol>' +

      '<h3 class="tell-section">Freeze, flight, fight &hellip; or comfort</h3>' +
      '<p class="hint">Under threat, people freeze, pull away, or puff up; when safe, they relax. At the table a big bet is the threat, so a player’s reaction after betting often shows whether they fear a call.</p>' +
      '<div class="stress-grid">' + STRESS.map((s) =>
        '<div class="stress-card" style="--stress:' + s.color + '"><h4>' + s.name + '</h4><p>' + s.look + '</p><p class="stress-reads">' + s.reads + '</p></div>').join('') + '</div>' +

      '<h3 class="tell-section">Build a baseline first</h3>' +
      '<p class="hint">Watch these while the player is not in a hand, or on routine decisions, and write them in the player\u2019s notes.</p>' +
      '<ul class="baseline-list">' + BASELINE.map((b) => '<li>' + b + '</li>').join('') + '</ul>' +

      '<h3 class="tell-section">Strength vs weakness</h3>' +
      '<div class="tell-filter">' + '<button type="button" data-area="all">All</button>' +
        Object.entries(AREAS).map(([id, name]) => '<button type="button" data-area="' + id + '">' + name + '</button>').join('') +
      '</div>' +
      '<p class="hint">Dots show how dependable a tell is in general (<span class="tell-dots inline"><span class="on"></span><span class="on"></span><span class="on"></span></span> = most dependable). Open a card for why it works and when it misleads.</p>' +
      '<div class="tell-columns" id="tell-columns"></div>' +

      '<h3 class="tell-section">Keep notes on players</h3>' +
      '<p>Each player\u2019s style, tendencies, notes and a tally of the tells you\u2019ve confirmed at showdown live in the <strong>Players</strong> tab.</p>' +
      '<button type="button" class="primary" id="tells-to-players">Open player notes</button>';

    renderTells();
    bind();
  }

  function bind() {
    root.querySelector('.tell-filter').addEventListener('click', (e) => {
      const b = e.target.closest('[data-area]');
      if (!b) return;
      areaFilter = b.dataset.area;
      renderTells();
    });

    root.querySelector('#tells-to-players').addEventListener('click', () => {
      const tab = document.querySelector('[data-view="players"]');
      if (tab) tab.click();
    });
  }

  window.Tells = { render, TELLS };
})();
