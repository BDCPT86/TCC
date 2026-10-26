/* ══════════════════════════════════════════════════════════════════
   THE WORDING

   Byron has no set wording, so this is a starting set. Every line of it
   is editable on the admin page before the document is sent — what is
   saved is the text as it stood when the player opened the link, not
   the template, so later edits to this file never change a document
   somebody has already signed.

   Three things are deliberate:

   · Signing means "I received and read this", never "I agree". A player
     who is made to sign an admission has a grievance; a player who signs
     for receipt and writes their disagreement underneath has been heard,
     and the club still has proof of delivery.
   · Every warning says how long it stays on the record. A warning with
     no expiry is one that gets produced years later in an argument.
   · Every warning says how to appeal and to whom.

   This is a club's own disciplinary wording, not legal advice. Before
   the first one goes out it wants an eye from the committee, and it
   should match whatever the club constitution and the CSA/WPCA codes of
   conduct already say — where they conflict, those win.
   ══════════════════════════════════════════════════════════════════ */

var LEVELS = [
  {
    id: 'informal',
    label: 'Informal warning',
    title: 'RECORD OF AN INFORMAL WARNING',
    months: 6,
    /* No sanction, no formal step — this exists so that both sides have the
       same account of a conversation that has already happened. */
    body: function (d) {
      return [
        'This letter records an informal warning given to you by ' + d.issuedBy +
        ' on ' + d.incidentOn + '.',
        '',
        'WHAT WAS DISCUSSED',
        d.incidentText,
        '',
        'WHAT THIS IS',
        'This is an informal warning. It is not a formal disciplinary step, no sanction follows ' +
        'from it, and it does not count against you in any later process. It is written down only ' +
        'so that you and the club have the same account of what was said.',
        '',
        'WHAT HAPPENS NOW',
        d.expectedText || 'The club asks that the conduct described above is not repeated.',
        '',
        'This record is kept for ' + d.months + ' months and is then removed.'
      ];
    }
  },

  {
    id: 'first',
    label: 'First written warning',
    title: 'FIRST WRITTEN WARNING',
    months: 12,
    body: function (d) {
      return [
        'This is a FIRST WRITTEN WARNING issued to you by Tygerberg Cricket Club under the ' +
        'club\'s code of conduct.',
        '',
        'THE CONDUCT CONCERNED',
        'On ' + d.incidentOn + (d.incidentPlace ? ' at ' + d.incidentPlace : '') + ':',
        d.incidentText,
        d.codeRef ? '' : null,
        d.codeRef ? 'The club considers this a breach of ' + d.codeRef + '.' : null,
        '',
        'WHY YOU ARE RECEIVING THIS',
        'The club regards that conduct as unacceptable and as falling short of the standard ' +
        'expected of a member representing Tygerberg Cricket Club.',
        '',
        'WHAT IS EXPECTED OF YOU',
        d.expectedText || 'That the conduct described above stops immediately and is not repeated.',
        '',
        'IF IT HAPPENS AGAIN',
        d.consequenceText || ('A further breach of this kind while this warning is on your record ' +
        'may lead to a final written warning, a suspension, or a disciplinary hearing at which your ' +
        'membership of the club could be reconsidered.'),
        '',
        'HOW LONG THIS STAYS ON YOUR RECORD',
        'This warning remains on your record for ' + d.months + ' months from the date it is issued, ' +
        'after which it falls away and cannot be relied on against you.'
      ];
    }
  },

  {
    id: 'final',
    label: 'Final written warning',
    title: 'FINAL WRITTEN WARNING',
    months: 12,
    body: function (d) {
      return [
        'This is a FINAL WRITTEN WARNING issued to you by Tygerberg Cricket Club under the ' +
        'club\'s code of conduct. Please read it carefully — it is the last step before your ' +
        'membership of the club is put in question.',
        '',
        'THE CONDUCT CONCERNED',
        'On ' + d.incidentOn + (d.incidentPlace ? ' at ' + d.incidentPlace : '') + ':',
        d.incidentText,
        d.codeRef ? '' : null,
        d.codeRef ? 'The club considers this a breach of ' + d.codeRef + '.' : null,
        '',
        'WHAT IS EXPECTED OF YOU',
        d.expectedText || 'That the conduct described above stops immediately and is not repeated, ' +
        'and that your conduct meets the standard set out in the club\'s code of conduct at all times.',
        '',
        'IF IT HAPPENS AGAIN',
        d.consequenceText || ('Any further breach of the code of conduct while this warning is on ' +
        'your record will be referred to a disciplinary hearing, which may result in suspension or ' +
        'in your membership of the club being terminated.'),
        '',
        'HOW LONG THIS STAYS ON YOUR RECORD',
        'This warning remains on your record for ' + d.months + ' months from the date it is issued.'
      ];
    }
  },

  {
    id: 'suspension',
    label: 'Suspension',
    title: 'NOTICE OF SUSPENSION',
    months: 12,
    body: function (d) {
      var when = d.suspendMatches
        ? 'for ' + d.suspendMatches + ' match' + (Number(d.suspendMatches) === 1 ? '' : 'es')
        : (d.suspendFrom && d.suspendTo)
          ? 'from ' + d.suspendFrom + ' to ' + d.suspendTo + ' (both days included)'
          : 'with immediate effect until further notice';
      return [
        'This notice confirms that you are SUSPENDED by Tygerberg Cricket Club ' + when + '.',
        '',
        'THE CONDUCT CONCERNED',
        'On ' + d.incidentOn + (d.incidentPlace ? ' at ' + d.incidentPlace : '') + ':',
        d.incidentText,
        d.codeRef ? '' : null,
        d.codeRef ? 'The club considers this a breach of ' + d.codeRef + '.' : null,
        '',
        'WHAT THE SUSPENSION MEANS',
        d.sanctionText || ('During the suspension you may not be selected for or play in any match ' +
        'for the club, and you may not take part in club practices or represent the club in any ' +
        'capacity. You remain a member and your subscription obligations are unaffected.'),
        '',
        'AFTER THE SUSPENSION',
        d.expectedText || 'You return to full availability for selection, with this notice remaining ' +
        'on your record as set out below.',
        '',
        'HOW LONG THIS STAYS ON YOUR RECORD',
        'This notice remains on your record for ' + d.months + ' months from the date it is issued.'
      ];
    }
  },

  {
    id: 'hearing',
    label: 'Notice of a disciplinary hearing',
    title: 'NOTICE OF A DISCIPLINARY HEARING',
    months: 12,
    /* Not a warning at all — a summons. The rights listed are what makes a
       hearing a fair one, so they are not optional text. */
    body: function (d) {
      return [
        'You are required to attend a disciplinary hearing of Tygerberg Cricket Club.',
        '',
        'WHEN AND WHERE',
        (d.hearingAt || 'To be confirmed') + (d.hearingPlace ? ', at ' + d.hearingPlace : ''),
        '',
        'WHAT IS ALLEGED',
        'On ' + d.incidentOn + (d.incidentPlace ? ' at ' + d.incidentPlace : '') + ':',
        d.incidentText,
        d.codeRef ? '' : null,
        d.codeRef ? 'It is alleged that this breaches ' + d.codeRef + '.' : null,
        '',
        'YOUR RIGHTS AT THE HEARING',
        '· You may state your case and answer the allegation.',
        '· You may be accompanied by a fellow member of the club.',
        '· You may call witnesses and put documents before the hearing.',
        '· You may question the club\'s witnesses.',
        '· You will be given the outcome in writing, with reasons.',
        d.isMinor ? '· As you are under 18, a parent or guardian may attend with you.' : null,
        '',
        'IF YOU DO NOT ATTEND',
        'If you do not attend and do not give a reason the hearing accepts, it may go ahead ' +
        'in your absence and a decision may be taken without hearing from you.',
        '',
        'POSSIBLE OUTCOMES',
        d.consequenceText || ('The hearing may decide that no further action is needed, or may issue ' +
        'a written warning, a final written warning, a suspension, or terminate your membership of the club.')
      ];
    }
  }
];

/* The closing blocks are the same whatever the level, because what makes a
   disciplinary document defensible does not change with its severity. */
function closingBlocks(d) {
  return [
    '',
    'YOUR RIGHT TO REPLY',
    'If you disagree with anything in this document, in whole or in part, write it in the box ' +
    'provided when you sign. Your reply is kept with this document and goes to the committee with it.',
    '',
    'YOUR RIGHT OF APPEAL',
    'You may appeal against this ' + (d.levelId === 'hearing' ? 'notice' : 'warning') +
    ' by writing to the club secretary within ' + d.appealDays + ' days of signing it, setting out ' +
    'why you believe it should be withdrawn or changed.',
    '',
    'WHAT SIGNING MEANS',
    'Signing below confirms only that you have received this document and have read it. ' +
    'It does not mean you agree with it.' +
    (d.isMinor ? ' As the player is under 18, a parent or guardian signs as well.' : '')
  ];
}

function buildDocument(d) {
  var lv = LEVELS.filter(function (x) { return x.id === d.levelId; })[0] || LEVELS[1];
  d.months = d.months || lv.months;
  d.appealDays = d.appealDays || 7;
  /* The heading belongs in the text. doc_text is what is stored, printed
     and signed, so a document that does not say what it is at the top is
     not a whole document — and if the heading is edited, the edit shows. */
  var lines = [lv.title, ''].concat(lv.body(d)).concat(closingBlocks(d));
  return lines
    .filter(function (l) { return l !== null; })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function levelById(id) {
  return LEVELS.filter(function (x) { return x.id === id; })[0] || null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LEVELS: LEVELS, buildDocument: buildDocument, levelById: levelById };
}
