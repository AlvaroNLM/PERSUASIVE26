import { TEST_MODE, APPS_SCRIPT_URL } from './config.js';
import { FEATURE_KEYS, FREQUENCIES, CASE_FEATURES } from './case.js';
import { classifyProfile, explainClassification } from './classifier.js';
import {
  QUESTIONS,
  questionnaireMarkup,
  isJudgement
} from './questionnaire.js';
import {
  loadSession,
  saveSession,
  isCompleted,
  completeSession,
  clearTestSession,
  clearSession,
  SessionStateError
} from './storage.js';
import {
  beginSession,
  lockPreJudgement
} from './experiment.js';
import {
  buildSubmissionPayload,
  sendSubmission
} from './submission.js';


const main = document.querySelector('main');

let session;

const assessment =
  'Based on the information provided, the system considers this profile more consistent with ADHD-related characteristics than ASD-related characteristics.';


/* =========================================================
   UI HELPERS
   ========================================================= */

function show(html, step = 0) {
  main.innerHTML = `
    ${
      step
        ? `
          <div class="step-label">STEP ${step} OF 6</div>

          <div
            class="progress"
            aria-label="Step ${step} of 6"
          >
            ${[1, 2, 3, 4, 5, 6]
              .map(
                n =>
                  `<span class="${n <= step ? 'active' : ''}"></span>`
              )
              .join('')}
          </div>
        `
        : ''
    }

    ${html}

    <p
      class="error"
      role="alert"
      id="error"
    ></p>
  `;

  main.focus();
  window.scrollTo(0, 0);
}


function error(err) {
  console.error('Study error:', err);

  let message = document.querySelector('#error');

  if (!message && main) {
    message = document.createElement('p');
    message.id = 'error';
    message.className = 'error';
    message.setAttribute('role', 'alert');
    main.append(message);
  }

  if (message) {
    message.textContent =
      err?.message ||
      'An unexpected error occurred. Please reload to resume your saved progress.';
  }
}


/* =========================================================
   CONSENT
   ========================================================= */

// PROVISIONAL CONSENT:
// institutional details and retention policy require review.

function consent() {
  show(
    `
      <div class="eyebrow">Research Study</div>

      <h1>Information and consent</h1>

      <div class="card">
        <p>
          This academic study explores human–AI interaction.
          You will read a fictional case, evaluate information
          produced by an experimental AI system, and answer
          questions about your own judgement.
        </p>

        <p>
          The system does not provide a clinical diagnosis.
          Participation is voluntary. You may stop at any point
          by closing this page. Your progress stays on this device
          until you press Submit responses at the end of the study.
        </p>

        <p>
          We store random session identifiers, your study responses
          and timing. Draft responses remain in this browser so you
          can resume. A copy of your final submission remains here
          to allow a retry. We do not request names, contact details
          or location, and do not use fingerprinting.
        </p>

        <p id="privacy">
          The application does not collect your IP address or
          information about your own health. Google and GitHub may
          process technical connection metadata in their hosting
          infrastructure.
        </p>

        <form id="consent-form">
          <label class="consent-check">
            <input
              type="checkbox"
              required
              id="consent-check"
            >

            I have read this information and voluntarily agree
            to participate.
          </label>

          <div class="actions">
            <button id="agree">
              I agree to participate
            </button>
          </div>
        </form>
      </div>
    `,
    1
  );

  document.querySelector('#consent-form').onsubmit = event => {
    event.preventDefault();

    try {
      session = beginSession();
      render();
    } catch (err) {
      error(err);
    }
  };
}


/* =========================================================
   FICTIONAL CASE
   ========================================================= */

const caseLabels = [
  'Difficulty sustaining attention during long tasks',
  'Easily distracted by external stimuli',
  'Impulsive responding',
  'Difficulty dealing with unexpected changes',
  'Difficulty interpreting social cues',
  'Repetitive behaviours or interests'
];


function casePage() {
  show(
    `
      <h1>Fictional case: Alex</h1>

      <p>
        Please imagine that the following information refers
        to a fictional individual named Alex.
      </p>

      <p>
        The system shown in this study is intended for research
        on AI-assisted interpretation and does not provide
        a clinical diagnosis.
      </p>

      <div class="card">
        <dl class="case-grid">
          ${FEATURE_KEYS.map(
            (key, index) => `
              <dt>${caseLabels[index]}</dt>
              <dd>${FREQUENCIES[CASE_FEATURES[key]]}</dd>
            `
          ).join('')}
        </dl>
      </div>

      <div class="actions">
        <button id="next">
          Continue
        </button>
      </div>
    `,
    2
  );

  document.querySelector('#next').onclick = () => {
    advance('pre');
  };
}


/* =========================================================
   NAVIGATION
   ========================================================= */

function advance(step) {
  try {
    session.step = step;
    saveSession(session);
    render();
  } catch (err) {
    error(err);
  }
}


/* =========================================================
   PRE / POST JUDGEMENT
   ========================================================= */

const judgementAnchors = [
  'Much more consistent with ADHD-related characteristics',
  'Unsure / equally consistent',
  'Much more consistent with ASD-related characteristics'
];


function judgementPage(kind) {
  const pre = kind === 'pre';

  if (pre && session.pre_locked) {
    advance('assessment');
    return;
  }

  const key =
    pre
      ? 'pre_ai_judgement'
      : 'post_ai_judgement';

  const title =
    pre
      ? 'Your initial judgement'
      : 'Your judgement after seeing the AI assessment';

  const question =
    pre
      ? "Before seeing the AI system's assessment, based only on the information presented above, how would you interpret this profile?"
      : "After seeing the AI system's assessment, how would you now interpret this profile?";

  show(
    `
      <h1>${title}</h1>

      <form id="judgement-form">
        <fieldset>
          <legend>
            ${question}
          </legend>

          <div class="likert judgement-scale">
            ${Array.from(
              { length: 7 },
              (_, i) => `
                <label>
                  <input
                    type="radio"
                    name="${key}"
                    value="${i + 1}"
                    required
                    ${
                      session[key] === i + 1
                        ? 'checked'
                        : ''
                    }
                  >

                  <span>
                    ${i + 1}
                  </span>

                  <span class="sr-only">
                    ${
                      i === 0
                        ? judgementAnchors[0]
                        : i === 3
                        ? judgementAnchors[1]
                        : i === 6
                        ? judgementAnchors[2]
                        : ''
                    }
                  </span>
                </label>
              `
            ).join('')}
          </div>

          <div class="judgement-anchors">
            <p>
              <strong>1</strong>
              = ${judgementAnchors[0]}
            </p>

            <p>
              <strong>4</strong>
              = ${judgementAnchors[1]}
            </p>

            <p>
              <strong>7</strong>
              = ${judgementAnchors[2]}
            </p>
          </div>
        </fieldset>

        <div class="actions">
          <button
            id="judgement-next"
            ${
              isJudgement(session[key])
                ? ''
                : 'disabled'
            }
          >
            Continue
          </button>
        </div>
      </form>
    `,
    pre ? 3 : 5
  );

  const form =
    document.querySelector('#judgement-form');

  const button =
    document.querySelector('#judgement-next');


  form.onchange = () => {
    try {
      const value =
        Number(
          new FormData(form).get(key)
        );

      if (!isJudgement(value)) {
        throw new Error(
          'Please choose a value from 1 to 7.'
        );
      }

      session[key] = value;

      saveSession(session);

      button.disabled = false;

    } catch (err) {
      error(err);
    }
  };


  form.onsubmit = async event => {
    event.preventDefault();

    button.disabled = true;

    try {
      if (!isJudgement(session[key])) {
        throw new Error(
          'Please choose a value from 1 to 7.'
        );
      }

      if (pre) {
        lockPreJudgement(session);
        render();
      } else {
        advance('questionnaire');
      }

    } catch (err) {
      error(err);
      button.disabled = false;
    }
  };
}


/* =========================================================
   AI ASSESSMENT
   ========================================================= */

function assessmentPage() {
  const result =
    classifyProfile(CASE_FEATURES);

  if (
    result.classification !==
    'ADHD_RELATED'
  ) {
    throw new Error(
      'The research model does not match this study stimulus. Please contact the researcher.'
    );
  }

  const factors =
    explainClassification(
      CASE_FEATURES,
      result
    );

  show(
    `
      <h1>
        AI-assisted assessment
      </h1>

      <div class="card">
        <p id="assessment-text">
          ${assessment}
        </p>

        <p class="note">
          This output is generated by an experimental
          research prototype and should not be interpreted
          as a clinical diagnosis.
        </p>

        ${
          session.condition === 'XAI'
            ? `
              <section id="explanation">
                <h2>
                  Why did the system reach this conclusion?
                </h2>

                <ul>
                  ${factors
                    .map(
                      factor =>
                        `<li>${factor.text}</li>`
                    )
                    .join('')}
                </ul>
              </section>
            `
            : ''
        }
      </div>

      <div class="actions">
        <button id="next">
          Continue
        </button>
      </div>
    `,
    4
  );

  document.querySelector('#next').onclick = () => {
    advance('post');
  };
}


/* =========================================================
   QUESTIONNAIRE
   ========================================================= */

function questionnairePage() {
  show(
    `
      <h1>
        Questionnaire
      </h1>

      <p>
        Thinking about the assessment you just saw,
        indicate how much you agree with each statement.
      </p>

      <p class="note">
        1 = Strongly disagree
        &nbsp; · &nbsp;
        7 = Strongly agree
        <br>
        All 13 statements require a response.
      </p>

      <form id="questionnaire-form">
        ${questionnaireMarkup(session.answers)}

        <div class="actions">
          <button
            id="submit"
            disabled
          >
            Submit responses
          </button>
        </div>

        <p>
          Your completed questionnaire is submitted
          when you press this button.
        </p>
      </form>
    `,
    6
  );

  const form =
    document.querySelector(
      '#questionnaire-form'
    );

  const complete = () =>
    QUESTIONS.every(
      ([key]) =>
        isJudgement(
          session.answers[key]
        )
    );

  const updateSubmit = () => {
    document.querySelector(
      '#submit'
    ).disabled = !complete();
  };


  updateSubmit();


  if (session.final_payload) {
    form
      .querySelectorAll('input')
      .forEach(
        input =>
          input.disabled = true
      );
  }


  form.onchange = () => {
    try {
      session.answers =
        Object.fromEntries(
          [...new FormData(form)]
            .map(
              ([key, value]) => [
                key,
                Number(value)
              ]
            )
        );

      saveSession(session);

      updateSubmit();

    } catch (err) {
      error(err);
    }
  };


  form.onsubmit = async event => {
    event.preventDefault();

    const button =
      document.querySelector(
        '#submit'
      );

    button.disabled = true;
    button.textContent =
      'Sending…';

    try {
      const invalidAnswer =
        QUESTIONS.some(
          ([key]) =>
            !Number.isInteger(
              session.answers[key]
            ) ||
            session.answers[key] < 1 ||
            session.answers[key] > 7
        );

      if (invalidAnswer) {
        throw new Error(
          'Please answer every statement.'
        );
      }


      if (!APPS_SCRIPT_URL) {
        throw new Error(
          'The study data endpoint is not configured.'
        );
      }


      session.final_payload ??=
        buildSubmissionPayload(
          session
        );


      saveSession(session);


      /*
       * TEMPORARY DEBUG LOG
       *
       * This lets us inspect exactly what the real
       * GitHub Pages experiment is sending.
       *
       * Remove this console.log before the real study
       * if you want a cleaner production console.
       */
      console.log(
        'REAL SUBMISSION PAYLOAD:',
        session.final_payload
      );


      /*
       * Retries always use the same payload,
       * timestamps and submission_id.
       */
      form
        .querySelectorAll('input')
        .forEach(
          input =>
            input.disabled = true
        );


      await sendSubmission(
        session.final_payload
      );


      completeSession(session);

      finished();

    } catch (err) {
      error(err);

      button.disabled = false;
      button.textContent =
        'Submit responses';
    }
  };
}


/* =========================================================
   COMPLETION
   ========================================================= */

function finished() {
  show(
    `
      <div class="eyebrow">
        STUDY COMPLETE
      </div>

      <h1>
        Thank you for taking part.
      </h1>

      <div class="card">
        <h2>
          Your submission has been sent.
        </h2>

        <p>
          This page cannot confirm whether your responses
          were saved. You may retry the same submission
          without creating a duplicate.
        </p>

        <div class="actions">
          <button
            class="secondary"
            id="retry-submission"
          >
            Retry the same submission
          </button>
        </div>

        <p>
          Your perspective contributes to research
          on how people interpret AI-assisted information.
          You may now close this page.
        </p>

        <p>
          This study used a fictional profile and
          a simple research classifier.
          Its assessment has no clinical validity.
        </p>
      </div>
    `
  );


  document
    .querySelector(
      '#retry-submission'
    )
    .onclick = async event => {

      const button =
        event.target;

      button.disabled = true;

      try {
        console.log(
          'RETRY SUBMISSION PAYLOAD:',
          session.final_payload
        );

        await sendSubmission(
          session.final_payload
        );

        finished();

      } catch (err) {
        error(err);

        button.disabled = false;
      }
    };
}


/* =========================================================
   ALREADY COMPLETED
   ========================================================= */

function alreadyCompleted() {
  show(
    `
      <h1>
        You have already completed this study.
      </h1>

      <p>
        Thank you for your participation.
        You may close this page.
      </p>
    `
  );
}


/* =========================================================
   RENDER
   ========================================================= */

function render() {
  if (
    session.test_mode !==
    TEST_MODE
  ) {
    throw new Error(
      'Study settings have changed. Please contact the researcher.'
    );
  }


  if (
    session.pre_locked &&
    ['case', 'pre'].includes(
      session.step
    )
  ) {
    session.step =
      'assessment';
  }


  const screens = {
    case: casePage,

    pre: () =>
      judgementPage('pre'),

    assessment:
      assessmentPage,

    post: () =>
      judgementPage('post'),

    questionnaire:
      questionnairePage,

    complete:
      finished
  };


  if (!screens[session.step]) {
    throw new SessionStateError(
      'The saved study step is invalid.'
    );
  }


  screens[session.step]();
}


/* =========================================================
   DEBUG
   ========================================================= */

function debug() {
  show(
    `
      <h1>
        Development debug
      </h1>

      <pre id="debug"></pre>

      <button id="reset">
        Reset local test session
      </button>
    `
  );


  let savedSession = null;

  try {
    savedSession =
      loadSession();
  } catch (err) {
    console.error(
      'Saved test state could not be loaded:',
      err
    );
  }


  let result = null;

  try {
    result =
      classifyProfile(
        savedSession?.features
      );
  } catch {}


  document
    .querySelector('#debug')
    .textContent =
      JSON.stringify(
        {
          participant_id:
            savedSession?.participant_id,

          submission_id:
            savedSession?.submission_id,

          condition:
            savedSession?.condition,

          classification:
            result?.classification,

          final_payload:
            savedSession?.final_payload
        },
        null,
        2
      );


  document
    .querySelector('#reset')
    .onclick = () => {
      clearTestSession();

      location.href = './';
    };
}


/* =========================================================
   SESSION RECOVERY
   ========================================================= */

function recover(err) {
  console.error(
    'Study state recovery:',
    err
  );

  show(
    `
      <h1>
        Unable to resume the saved session
      </h1>

      <p>
        The saved session is damaged, incomplete,
        or belongs to an earlier study version.
        You can clear this local draft and return
        to the study information.
        Previously submitted responses will not be removed.
      </p>

      <button id="recover">
        Clear saved draft and return to consent
      </button>
    `
  );


  error(err);


  document
    .querySelector('#recover')
    .onclick = () => {

      try {
        clearSession();

        session = null;

        consent();

      } catch (recoveryError) {
        recover(
          recoveryError
        );
      }
    };
}


/* =========================================================
   INITIALIZATION
   ========================================================= */

export function initialize() {
  if (!main) {
    throw new Error(
      'Missing #main element'
    );
  }


  if (
    typeof TEST_MODE !== 'boolean' ||
    typeof APPS_SCRIPT_URL !== 'string'
  ) {
    throw new Error(
      'Invalid public study configuration'
    );
  }


  try {
    if (
      TEST_MODE &&
      new URLSearchParams(
        location.search
      ).get('debug') === '1'
    ) {
      debug();
      return;
    }


    const completed =
      isCompleted();


    try {
      session =
        loadSession();

    } catch (err) {
      if (completed) {
        console.error(
          'Saved completed draft unavailable:',
          err
        );

        alreadyCompleted();

        return;
      }

      throw err;
    }


    if (completed) {
      if (
        session?.step ===
        'complete'
      ) {
        finished();
      } else {
        alreadyCompleted();
      }

      return;
    }


    if (session) {
      render();
    } else {
      consent();
    }

  } catch (err) {
    if (
      err instanceof
      SessionStateError
    ) {
      recover(err);
    } else {
      consent();
      error(err);
    }
  }
}


/* =========================================================
   GLOBAL ERROR HANDLING
   ========================================================= */

window.addEventListener(
  'error',
  event => {

    if (event.error) {
      error(event.error);
    }
  }
);


window.addEventListener(
  'unhandledrejection',
  event => {

    error(
      event.reason instanceof Error
        ? event.reason
        : new Error(
            String(
              event.reason
            )
          )
    );
  }
);


/* =========================================================
   PAGE / STORAGE EVENTS
   ========================================================= */

window.addEventListener(
  'pageshow',
  event => {

    if (event.persisted) {
      initialize();
    }
  }
);


window.addEventListener(
  'storage',
  event => {

    if (
      [
        'hci_experiment_v1',
        'experiment_completed'
      ].includes(
        event.key
      )
    ) {
      initialize();
    }
  }
);