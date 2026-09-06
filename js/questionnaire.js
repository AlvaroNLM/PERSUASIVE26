export const QUESTIONS = [
 ['a1', "I would accept the AI system's assessment."],
 ['a2', "I find the AI system's assessment convincing."],
 ['a3', "The AI system's conclusion seems reasonable to me."],
 ['a4', 'I would take this assessment into account when forming my own judgement.'],
 ['t1', "I trust the AI system's assessment."],
 ['t2', 'I consider the AI system reliable.'],
 ['tr1', 'I understand why the AI reached this assessment.'],
 ['tr2', 'The reasoning behind the assessment is clear to me.'],
 ['rp1', 'I felt free to form my own judgement independently of the AI.'],
 ['rp2', 'I felt that the system was trying to influence my judgement.'],
 ['rp3', 'The way the information was presented felt manipulative.'],
 ['u1', 'I found the information provided by the AI useful.'],
 ['mc1', 'The system clearly explained why it made this assessment.'],
];
export function questionnaireMarkup(answers) {
 return QUESTIONS.map(([id, text], i) => `<fieldset><legend><span class="question-number">${i + 1}.</span> ${text}</legend><div class="likert">${Array.from({length: 7}, (_, n) => `<label><input type="radio" name="${id}" value="${n + 1}" required ${answers[id] === n + 1 ? 'checked' : ''}><span>${n + 1}</span><span class="sr-only">${n === 0 ? 'Strongly disagree' : n === 6 ? 'Strongly agree' : ''}</span></label>`).join('')}</div><div class="scale-labels"><span>Strongly disagree</span><span>Strongly agree</span></div></fieldset>`).join('');
}
