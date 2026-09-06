import {
  APPS_SCRIPT_URL,
  EXPERIMENT_VERSION,
  CASE_VERSION
} from './config.js';

import {
  CASE_FEATURES,
  FEATURE_KEYS
} from './case.js';

import {
  classifyProfile,
  explainClassification,
  CLASSIFIER_VERSION
} from './classifier.js';

import {
  QUESTIONS,
  isJudgement
} from './questionnaire.js';


const featureColumns = [
  'attention',
  'distractibility',
  'impulsivity',
  'changes',
  'social_communication',
  'repetitive_behaviours'
];


/* =========================================================
   BUILD FINAL SUBMISSION
   ========================================================= */

export function buildSubmissionPayload(
  session,
  submittedAt = new Date().toISOString()
) {
  if (
    !session.pre_locked ||
    !isJudgement(session.pre_ai_judgement) ||
    !isJudgement(session.post_ai_judgement) ||
    QUESTIONS.some(
      ([key]) =>
        !isJudgement(session.answers[key])
    )
  ) {
    throw new Error(
      'Please answer every statement before submitting.'
    );
  }


  const duration =
    Math.floor(
      (
        Date.parse(submittedAt) -
        Date.parse(session.created_at)
      ) / 1000
    );


  if (
    !Number.isSafeInteger(duration) ||
    duration < 0
  ) {
    throw new Error(
      'The device clock has changed. Please correct it and try again.'
    );
  }


  const result =
    classifyProfile(CASE_FEATURES);


  return {
    submission_id:
      session.submission_id,

    participant_id:
      session.participant_id,

    session_id:
      session.session_id,

    created_at:
      session.created_at,

    submitted_at_client:
      submittedAt,

    condition:
      session.condition,

    experiment_version:
      EXPERIMENT_VERSION,

    case_version:
      CASE_VERSION,

    classifier_version:
      CLASSIFIER_VERSION,

    pre_ai_judgement:
      session.pre_ai_judgement,

    post_ai_judgement:
      session.post_ai_judgement,

    classification:
      result.classification,

    duration_seconds:
      duration,

    ...Object.fromEntries(
      FEATURE_KEYS.map(
        (key, index) => [
          `feature_${featureColumns[index]}`,
          CASE_FEATURES[key]
        ]
      )
    ),

    ...Object.fromEntries(
      QUESTIONS.map(
        ([key]) => [
          key,
          session.answers[key]
        ]
      )
    ),

    explanation_factors_json:
      JSON.stringify(
        explainClassification(
          CASE_FEATURES,
          result
        )
      ),

    test_mode:
      session.test_mode
  };
}


/* =========================================================
   SEND TO GOOGLE APPS SCRIPT
   ========================================================= */

export async function sendSubmission(payload) {
  if (!APPS_SCRIPT_URL) {
    throw new Error(
      'The study data endpoint is not configured.'
    );
  }


  const url =
    new URL(APPS_SCRIPT_URL);


  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'script.google.com' ||
    !/^\/macros\/s\/[^/]+\/exec$/.test(
      url.pathname
    )
  ) {
    throw new Error(
      'The study data endpoint is invalid. Please contact the researcher.'
    );
  }


  try {
    /*
     * text/plain avoids the CORS preflight.
     *
     * mode:no-cors means the browser cannot inspect
     * the Apps Script response, but a resolved fetch
     * confirms that the request was sent successfully
     * from the browser.
     */
    await fetch(
      url.href,
      {
        method: 'POST',

        mode: 'no-cors',

        credentials: 'omit',

        redirect: 'follow',

        referrerPolicy: 'no-referrer',

        headers: {
          'Content-Type':
            'text/plain;charset=UTF-8'
        },

        body:
          JSON.stringify(payload)
      }
    );


    return {
      status: 'unconfirmed'
    };

  } catch (error) {
    console.error(
      'Study submission request failed:',
      error
    );


    throw new Error(
      'Unable to send your responses. They remain on this device. Please check your connection and retry.'
    );
  }
}